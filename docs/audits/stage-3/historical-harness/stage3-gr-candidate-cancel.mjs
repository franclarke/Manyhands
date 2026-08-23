import puppeteer from "puppeteer-core";

const evidenceRoot = "C:/mh-stage3-gr-4e495abd";
const runId = process.env.STAGE3_RUN_ID;
if (!runId) throw new Error("STAGE3_RUN_ID is required.");
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  defaultViewport: { width: 1440, height: 1050 }
});

try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:3357/runs/${encodeURIComponent(runId)}`, {
    waitUntil: "domcontentloaded"
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await page.screenshot({ path: `${evidenceRoot}/browser-recovered.png`, fullPage: true });

  const cancelled = await page.evaluate(async (id) => {
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "complete candidate-attributed GR gate" })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(`cancel ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }, runId);

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const lifecycle = await page.evaluate(async (id) => {
      const response = await fetch(`/api/runs/${encodeURIComponent(id)}`);
      return (await response.json()).run.lifecycle;
    }, runId);
    if (lifecycle === "interrupted") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await page.screenshot({ path: `${evidenceRoot}/browser-cancelled.png`, fullPage: true });
  process.stdout.write(`${JSON.stringify({ runId, lifecycle: cancelled.run.lifecycle })}\n`);
} finally {
  await browser.close();
}
