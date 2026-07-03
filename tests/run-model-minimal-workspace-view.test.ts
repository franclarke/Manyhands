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
  it("keeps an empty proposal graph canvas-ready before the first node arrives", () => {
    const view = selectMinimalWorkspaceView(initialFor("empty-run"));
    expect(view.stage).toBe("intent");
    expect(view.graph.nodes).toEqual([]);
    expect(view.graph.edges).toEqual([]);
  });

  it("projects generating planning nodes as planning vitals", () => {
    const events: RunEvent[] = [
      {
        seq: 1,
        at: "2026-06-08T00:00:00.000Z",
        runId: "live-planning",
        actor: "system",
        type: "plan.node.proposed",
        payload: { nodeId: "root", parentId: null, role: "root", title: "Root", goal: "Plan", depth: 0 }
      },
      {
        seq: 2,
        at: "2026-06-08T00:00:01.000Z",
        runId: "live-planning",
        actor: "system",
        type: "plan.node.status",
        payload: { nodeId: "root", state: "generating", maxAttempts: 3 }
      }
    ];
    const view = selectMinimalWorkspaceView(reduceRunEvents(initialFor("live-planning"), events));

    expect(view.graph.nodes).toHaveLength(1);
    expect(view.graph.nodes[0]?.vital.status).toBe("planning");
    expect(view.graph.nodes[0]?.vital.label).toBe("Generando");
    expect(view.graph.nodes[0]?.vital.detail).toBe("intento 1/3");
  });

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
