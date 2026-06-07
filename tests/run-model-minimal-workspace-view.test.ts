import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectMinimalWorkspaceView } from "@/lib/run-model/minimal-workspace-view";
import { goldenBehavioralConflict, goldenHappyPath } from "@/lib/run-model/fixtures";
import type { RunConfig, RunEvent, RunFixture, RunModel } from "@/lib/run-model/types";

const STUB_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function initialFor(runId: string): RunModel {
  return createInitialRunModel({ id: runId, intent: "", workspaceId: "ws", config: STUB_CONFIG });
}

function reduceFixture(fx: RunFixture): RunModel {
  return reduceRunEvents(initialFor(fx.runId), fx.events);
}

function reduceUpToSeq(fx: RunFixture, seq: number): RunModel {
  return reduceRunEvents(initialFor(fx.runId), fx.events.filter((e) => e.seq <= seq));
}

function seqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return fx.events.find(predicate)!.seq;
}

function lastSeqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return [...fx.events].reverse().find(predicate)!.seq;
}

function pl(e: RunEvent): Record<string, unknown> {
  return e.payload;
}

describe("minimal-workspace-view", () => {
  it("maps approve-plan proposal to a graph-first plan stage with one primary decision", () => {
    const model = reduceUpToSeq(
      goldenHappyPath,
      seqOf(goldenHappyPath, (e) => e.type === "decision.raised" && pl(e).kind === "approve_plan")
    );
    const view = selectMinimalWorkspaceView(model);
    expect(view.stage).toBe("proposal");
    expect(view.graph.nodes.length).toBeGreaterThan(0);
    expect(view.primaryAttention?.kind).toBe("approve_plan");
    expect(view.statusLine).toMatch(/Aprobar plan|plan/i);
  });

  it("maps active parallel execution to running and preserves wavefront as derived graph state", () => {
    const model = reduceUpToSeq(goldenHappyPath, lastSeqOf(goldenHappyPath, (e) => e.type === "node.execution.started"));
    const view = selectMinimalWorkspaceView(model);
    expect(view.stage).toBe("running");
    expect(view.graph.wavefront).toEqual(["n-logic", "n-store", "n-ui"]);
    expect(view.primaryAttention).toBeNull();
  });

  it("maps final evidence to review without losing graph context", () => {
    const view = selectMinimalWorkspaceView(reduceFixture(goldenHappyPath));
    expect(view.stage).toBe("review");
    expect(view.reviewEvidence?.tests).toEqual({ pass: 8, total: 8 });
    expect(view.graph.nodes.length).toBeGreaterThan(0);
  });

  it("keeps behavioral conflict as primary attention instead of exposing all conflicts as panels", () => {
    const model = reduceUpToSeq(
      goldenBehavioralConflict,
      seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict")
    );
    const view = selectMinimalWorkspaceView(model);
    expect(view.stage).toBe("running");
    expect(view.primaryAttention?.kind).toBe("resolve_conflict");
    expect(view.pendingAttentionCount).toBe(1);
  });
});
