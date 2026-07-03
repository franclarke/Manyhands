import { describe, expect, it } from "vitest";
import { pathToFileURL } from "node:url";
import path from "node:path";

const rendererUrl = pathToFileURL(path.resolve("scripts/manyhands-dev-renderer.mjs")).href;

async function loadRenderer(): Promise<{
  buildMonitorModel: (input: Record<string, unknown>) => any;
  chooseRun: (runs: any[], explicitRunId?: string) => any;
  renderDashboard: (input: any, options?: Record<string, unknown>) => string;
  summarizeEvent: (event: any) => { text: string; tone: string } | null;
}> {
  return (await import(rendererUrl)) as any;
}

const baseRun = {
  id: "run-1",
  title: "Agregar magic links con tests",
  userPrompt: "Agregar magic links con tests",
  status: "running",
  href: "/runs/run-1"
};

function event(seq: number, type: string, payload: Record<string, unknown>, actor = "system") {
  return {
    seq,
    at: `2026-06-19T12:00:${String(seq).padStart(2, "0")}Z`,
    runId: "run-1",
    actor,
    type,
    payload
  };
}

describe("manyhands dev console renderer", () => {
  it("selects the latest active run before completed history", async () => {
    const { chooseRun } = await loadRenderer();
    const selected = chooseRun(
      [
        { id: "old", status: "completed" },
        { id: "active", status: "running" }
      ],
      undefined
    );

    expect(selected.id).toBe("active");
  });

  it("renders pending decisions as attention instead of loose logs", async () => {
    const { buildMonitorModel, renderDashboard } = await loadRenderer();
    const model = buildMonitorModel({
      run: baseRun,
      events: [
        event(1, "run.created", { intent: baseRun.userPrompt, workspaceId: "ws" }),
        event(2, "plan.ready", { rootId: "root", nodeCount: 3, seamCount: 1, criticFindings: [] }),
        event(3, "decision.raised", {
          decisionId: "approve_plan",
          kind: "approve_plan",
          blocking: true,
          context: {}
        })
      ],
      process: { status: "running", lines: ["ready - local http://localhost:3000"] }
    });

    expect(model.health).toBe("attention");
    expect(model.pendingDecisions).toHaveLength(1);
    const rendered = renderDashboard(model, { width: 100, height: 30 });
    expect(rendered).toContain("Attention");
    expect(rendered).toContain("[BLOCK] approve_plan");
  });

  it("derives wavefront from node lifecycle events and suppresses stdout noise from the main timeline", async () => {
    const { buildMonitorModel, renderDashboard, summarizeEvent } = await loadRenderer();
    const stdoutEvent = event(
      5,
      "node.cli.output",
      { nodeId: "auth", stream: "stdout", chunk: "installing packages and lots of noisy output" },
      "agent"
    );
    const model = buildMonitorModel({
      run: baseRun,
      events: [
        event(1, "plan.node.proposed", {
          nodeId: "root",
          parentId: null,
          role: "root",
          title: "Magic links",
          goal: "Coordinar feature",
          depth: 0
        }),
        event(2, "plan.node.proposed", {
          nodeId: "auth",
          parentId: "root",
          role: "leaf",
          title: "Auth Backend",
          goal: "Implementar backend",
          depth: 1
        }),
        event(3, "node.execution.started", { nodeId: "auth", agent: "claude-code-cli", model: "sonnet" }, "agent"),
        event(4, "node.verify.iteration", {
          nodeId: "auth",
          iteration: 2,
          maxIterations: 3,
          build: "pass",
          testsPass: 6,
          testsTotal: 9
        }),
        stdoutEvent
      ],
      process: { status: "running", lines: ["ready - local http://localhost:3000"] }
    });

    expect(model.health).toBe("working");
    expect(model.activeNodes.map((node: any) => node.id)).toEqual(["auth"]);
    expect(summarizeEvent(stdoutEvent)).toBeNull();
    const rendered = renderDashboard(model, { width: 110, height: 32 });
    expect(rendered).toContain("[TEST] Auth Backend");
    expect(rendered).toContain("tests 6/9");
    expect(rendered).not.toContain("installing packages");
  });
});
