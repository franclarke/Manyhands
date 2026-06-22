/**
 * C3 — focus node: explicit dependencies + execution timing (derived, honest).
 *
 * The node inspector used to be a flat key-value list with no upstream
 * dependencies and no duration. C3 adds both as DERIVED, never-invented data:
 *  - `dependencies`: the upstream task nodes this one depends on, derived from the
 *    seams it consumes (`consumes → seam.producerNodeId → node`). Deduped, self
 *    excluded. Pure model derivation — no events needed.
 *  - `timing`: execution duration derived from the event log
 *    (`node.execution.started` → terminal `node.verify.passed` / `node.execution.failed`).
 *    Started-but-not-finished reads as `running` with no fabricated number; a node
 *    that never started has no timing at all (the panel shows "—").
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { buildFocusView } from "@/lib/run-model/focus-view";
import { goldenHappyPath } from "@/lib/run-model/fixtures";
import type { RunConfig, RunEvent, RunFixture, RunModel } from "@/lib/run-model/types";

const STUB_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function reduceFixture(fx: RunFixture): RunModel {
  return reduceRunEvents(
    createInitialRunModel({ id: fx.runId, intent: "", workspaceId: "ws", config: STUB_CONFIG }),
    fx.events
  );
}

function evt(seq: number, at: string, type: RunEvent["type"], payload: Record<string, unknown>): RunEvent {
  return { seq, at, runId: goldenHappyPath.runId, actor: "agent", type, payload } as RunEvent;
}

function nodeView(model: RunModel, id: string, events?: RunEvent[]) {
  const view = buildFocusView(model, { kind: "node", id }, events !== undefined ? { events } : {});
  if (view.kind !== "node") throw new Error("expected node focus");
  return view;
}

// ── Dependencies (pure model derivation) ────────────────────────────────────────

describe("focus-view — explicit node dependencies", () => {
  it("derives upstream task nodes from the seams the node consumes", () => {
    // n-ui consumes seam-counter, whose producer is n-store ("CounterStore").
    const view = nodeView(reduceFixture(goldenHappyPath), "n-ui");
    expect(view.dependencies).toEqual([{ id: "n-store", title: "CounterStore" }]);
  });

  it("is empty for a node that consumes nothing (a pure producer leaf)", () => {
    const view = nodeView(reduceFixture(goldenHappyPath), "n-store");
    expect(view.dependencies).toEqual([]);
  });

  it("never lists the node itself as its own dependency", () => {
    const view = nodeView(reduceFixture(goldenHappyPath), "n-ui");
    expect(view.dependencies.map((d) => d.id)).not.toContain("n-ui");
  });
});

// ── Timing (derived from events, never fabricated) ──────────────────────────────

describe("focus-view — node execution timing", () => {
  // `options.events` is an INDEPENDENT input from the model — these pass a controlled
  // minimal event set so timing derives solely from it (the fixture's own lifecycle
  // events would otherwise mix in). The model only supplies the node's existence.
  const model = reduceFixture(goldenHappyPath);

  it("computes duration from started → terminal (verify.passed)", () => {
    const events: RunEvent[] = [
      evt(1, "2026-06-08T00:00:00.000Z", "node.execution.started", { nodeId: "n-store", agent: "a", model: "m" }),
      evt(2, "2026-06-08T00:00:05.000Z", "node.verify.passed", {
        nodeId: "n-store",
        commit: "x",
        changedFiles: [],
        builtAgainst: []
      })
    ];
    expect(nodeView(model, "n-store", events).timing).toEqual({
      startedAt: "2026-06-08T00:00:00.000Z",
      finishedAt: "2026-06-08T00:00:05.000Z",
      durationMs: 5_000,
      running: false
    });
  });

  it("computes duration from started → terminal (execution.failed)", () => {
    const events: RunEvent[] = [
      evt(1, "2026-06-08T00:00:00.000Z", "node.execution.started", { nodeId: "n-store", agent: "a", model: "m" }),
      evt(2, "2026-06-08T00:00:03.000Z", "node.execution.failed", { nodeId: "n-store", cause: "boom" })
    ];
    const view = nodeView(model, "n-store", events);
    expect(view.timing?.durationMs).toBe(3_000);
    expect(view.timing?.running).toBe(false);
  });

  it("marks a started-but-unfinished node as running with no fabricated duration", () => {
    const events: RunEvent[] = [
      evt(1, "2026-06-08T00:00:00.000Z", "node.execution.started", { nodeId: "n-store", agent: "a", model: "m" })
    ];
    const view = nodeView(model, "n-store", events);
    expect(view.timing).toEqual({ startedAt: "2026-06-08T00:00:00.000Z", running: true });
    expect(view.timing?.durationMs).toBeUndefined();
  });

  it("ignores another node's lifecycle events (no cross-contamination)", () => {
    const events: RunEvent[] = [
      evt(1, "2026-06-08T00:00:00.000Z", "node.execution.started", { nodeId: "n-ui", agent: "a", model: "m" }),
      evt(2, "2026-06-08T00:00:09.000Z", "node.verify.passed", { nodeId: "n-ui", commit: "x", changedFiles: [], builtAgainst: [] })
    ];
    expect(nodeView(model, "n-store", events).timing).toBeUndefined();
  });

  it("has no timing at all when the node never started (panel shows —)", () => {
    expect(nodeView(model, "n-store", []).timing).toBeUndefined();
  });

  it("spans the first start to the last terminal across a re-execution", () => {
    const events: RunEvent[] = [
      evt(1, "2026-06-08T00:00:00.000Z", "node.execution.started", { nodeId: "n-store", agent: "a", model: "m" }),
      evt(2, "2026-06-08T00:00:02.000Z", "node.execution.failed", { nodeId: "n-store", cause: "flake" }),
      evt(3, "2026-06-08T00:00:04.000Z", "node.execution.started", { nodeId: "n-store", agent: "a", model: "m", reason: "repair" }),
      evt(4, "2026-06-08T00:00:10.000Z", "node.verify.passed", { nodeId: "n-store", commit: "x", changedFiles: [], builtAgainst: [] })
    ];
    const view = nodeView(model, "n-store", events);
    expect(view.timing?.durationMs).toBe(10_000);
    expect(view.timing?.running).toBe(false);
  });
});
