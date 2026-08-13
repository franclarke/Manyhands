import puppeteer from "puppeteer-core";

const evidenceRoot = "C:/mh-stage3-gr-4e495abd";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 1050 }
});

try {
  const left = await browser.newPage();
  const right = await browser.newPage();
  await Promise.all([
    left.goto("http://127.0.0.1:3357/", { waitUntil: "networkidle0" }),
    right.goto("http://127.0.0.1:3358/", { waitUntil: "networkidle0" })
  ]);

  const workspace = await left.evaluate(async () => {
    const response = await fetch("/api/workspaces");
    const body = await response.json();
    if (!response.ok) throw new Error(`workspace ${response.status}: ${JSON.stringify(body)}`);
    return body.workspaces.find((workspace) => workspace.repoPath);
  });
  if (!workspace) throw new Error("No runnable Git workspace is configured.");

  const create = (page) => page.evaluate(async (workspaceId) => {
    const response = await fetch("/api/runs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "stage3-gr-4e495abd-concurrent-create"
      },
      body: JSON.stringify({
        workspaceId,
        userPrompt: "Verify daemon productive ownership on candidate 4e495abd",
        acceptanceCriteria: ["survive browser and service restarts", "cancel every descendant"],
        planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
        executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
        repairSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" }
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`create ${response.status}: ${JSON.stringify(body)}`);
    return { status: response.status, body };
  }, workspace.id);
  const [createdLeft, createdRight] = await Promise.all([create(left), create(right)]);
  const runId = createdLeft.body.run.runId;
  if (createdRight.body.run.runId !== runId) throw new Error("Concurrent creates returned different run ids.");

  const waitProjection = async (page, predicate) => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      const response = await page.evaluate(async (id) => {
        const result = await fetch(`/api/runs/${encodeURIComponent(id)}`);
        return { status: result.status, body: await result.json() };
      }, runId);
      if (response.status === 200 && predicate(response.body.run)) return response.body.run;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Projection did not converge.");
  };

  const approval = await waitProjection(left, (run) => run.lifecycle === "needs_approval");
  await left.goto(`http://127.0.0.1:3357/runs/${encodeURIComponent(runId)}`, { waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await left.screenshot({ path: `${evidenceRoot}/browser-approval.png`, fullPage: true });
  const decisionId = `approve-plan:${approval.graphId}:r${approval.graphRevision}`;
  const approved = await left.evaluate(async ({ id, decision }) => {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}/decisions/${encodeURIComponent(decision)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ optionId: "approve" })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`approve ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }, { id: runId, decision: decisionId });
  await waitProjection(left, (run) => run.lifecycle === "running");
  await left.reload({ waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await left.screenshot({ path: `${evidenceRoot}/browser-running.png`, fullPage: true });

  process.stdout.write(`${JSON.stringify({
    workspaceId: workspace.id,
    runId,
    decisionId,
    leftStatus: createdLeft.status,
    rightStatus: createdRight.status,
    approvedSequence: approved.run.eventSequence
  })}\n`);
} finally {
  await browser.close();
}
