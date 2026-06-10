/**
 * U-B — Timeline / audit-trail view-model (pure, node environment).
 *
 * The timeline is the chronological projection of the raw event log: it serves the
 * audit trail and per-node history. Proven over the golden fixtures and, via the
 * SSE adapter, over a bridged live history (same `RunEvent[]` shape).
 */
import { describe, expect, it } from "vitest";
import { buildTimelineView, timelineCategoryOf } from "@/lib/run-model/timeline-view";
import { adaptStreamHistory } from "@/lib/run-model/sse-adapter";
import { goldenHappyPath, goldenPlanningFallback } from "@/lib/run-model/fixtures";
import type { RunEvent } from "@/lib/run-model/types";
import type { StreamEvent } from "@/lib/server/runs/events";

describe("timeline — category mapping", () => {
  it("1. maps types to stable, payload-free categories", () => {
    expect(timelineCategoryOf("run.created")).toBe("framing");
    expect(timelineCategoryOf("plan.node.status")).toBe("proposal");
    expect(timelineCategoryOf("seam.frozen")).toBe("foundation");
    expect(timelineCategoryOf("node.verify.passed")).toBe("supervision");
    expect(timelineCategoryOf("integration.completed")).toBe("reconciliation");
    expect(timelineCategoryOf("run.metrics.ready")).toBe("disposition");
    expect(timelineCategoryOf("decision.raised")).toBe("decision");
    expect(timelineCategoryOf("totally.unknown")).toBe("other");
  });
});

describe("timeline — golden-happy-path", () => {
  const view = buildTimelineView(goldenHappyPath.events);

  it("2. preserves log order (monotonic seq) and covers every event", () => {
    expect(view.count).toBe(goldenHappyPath.events.length);
    const seqs = view.entries.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("3. spans framing → disposition", () => {
    const cats = new Set(view.entries.map((e) => e.category));
    for (const c of ["framing", "proposal", "foundation", "supervision", "reconciliation", "disposition"]) {
      expect(cats.has(c as never)).toBe(true);
    }
  });

  it("4. surfaces metrics, evidence and a successful completion as good tone", () => {
    expect(view.entries.some((e) => e.type === "run.metrics.ready")).toBe(true);
    expect(view.entries.find((e) => e.type === "run.completed")!.tone).toBe("good");
    expect(view.entries.find((e) => e.type === "node.verify.passed")!.tone).toBe("good");
  });

  it("5. per-node filtering keeps only that node's history", () => {
    const storeOnly = buildTimelineView(goldenHappyPath.events, { nodeId: "n-store" });
    expect(storeOnly.count).toBeGreaterThanOrEqual(3);
    expect(storeOnly.entries.every((e) => e.nodeId === "n-store")).toBe(true);
    expect(storeOnly.entries.some((e) => e.type === "node.verify.passed")).toBe(true);
  });
});

describe("timeline — planning telemetry & decisions", () => {
  it("6. planning retry/fallback surface as warn; recovery as info", () => {
    const view = buildTimelineView(goldenPlanningFallback.events);
    const statuses = view.entries.filter((e) => e.type === "plan.node.status");
    expect(statuses.find((e) => e.detail?.includes("missing_json"))?.tone).toBe("warn"); // retrying
    expect(statuses.some((e) => e.tone === "info")).toBe(true); // generated recovery
  });

  it("7. decisions are tagged as human-attention tone", () => {
    const view = buildTimelineView(goldenHappyPath.events);
    expect(view.entries.filter((e) => e.type.startsWith("decision.")).every((e) => e.tone === "human")).toBe(true);
  });
});

describe("timeline — robustness", () => {
  it("8. unknown event types still appear (forward-compat audit)", () => {
    const events: RunEvent[] = [{ seq: 1, at: "t", runId: "r", actor: "system", type: "totally.unknown", payload: {} }];
    const view = buildTimelineView(events);
    expect(view.count).toBe(1);
    expect(view.entries[0]!.title).toBe("totally.unknown");
    expect(view.entries[0]!.category).toBe("other");
  });

  it("9. is pure — does not mutate the input array", () => {
    const input = [...goldenHappyPath.events];
    buildTimelineView(input);
    expect(input).toEqual(goldenHappyPath.events);
  });

  it("10. works over a bridged live history (adapter → timeline)", () => {
    const stream: StreamEvent[] = [
      { kind: "planning.node.started", at: "t", nodeId: "root", title: "R", goal: "g", depth: 0 },
      { kind: "agent.run.started", at: "t", taskId: "root" },
      { kind: "agent.run.completed", at: "t", taskId: "root", success: true }
    ];
    const view = buildTimelineView(adaptStreamHistory(stream, "run-x"));
    expect(view.count).toBe(3);
    expect(view.entries.map((e) => e.type)).toEqual(["plan.node.proposed", "node.execution.started", "node.verify.passed"]);
  });

  it("11. surfaces node console chunks as per-node supervision audit", () => {
    const events: RunEvent[] = [
      {
        seq: 1,
        at: "2026-06-08T00:00:00.000Z",
        runId: "run-x",
        actor: "agent",
        type: "node.cli.output",
        payload: { nodeId: "leaf-a", stream: "stderr", chunk: "visible warning\n" }
      }
    ];
    const view = buildTimelineView(events, { nodeId: "leaf-a" });

    expect(view.entries[0]).toMatchObject({
      type: "node.cli.output",
      category: "supervision",
      title: "Consola stderr",
      detail: "visible warning",
      nodeId: "leaf-a",
      tone: "warn"
    });
  });
});
