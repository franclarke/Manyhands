import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  selectAffectedByAmendment,
  selectAttention,
  selectBlocked,
  selectConflicts,
  selectEvidence,
  selectFreshness,
  selectHealth,
  selectInvalidatedNodes,
  selectPendingReexecution,
  selectPhase,
  selectRenderableNodeState,
  selectWavefront
} from "@/lib/run-model/selectors";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  goldenBehavioralConflict,
  goldenHappyPath,
  goldenPlanningQuestion,
  goldenSeamAmendmentBlastRadius,
  goldenVerifyAutoRepair
} from "@/lib/run-model/fixtures";
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
function pl(e: RunEvent): Record<string, unknown> {
  return e.payload;
}
function seqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return fx.events.find(predicate)!.seq;
}
function lastSeqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return [...fx.events].reverse().find(predicate)!.seq;
}

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

/** Minimal event stream: one node mid-verification, optionally gated by a decision. */
function gatedEvents(input: {
  nodeId?: string;
  decisionNodeIds?: string[];
  blocking?: boolean;
  resolved?: boolean;
}): RunEvent[] {
  const nodeId = input.nodeId ?? "build-ui";
  const base = { runId: "run-gated", actor: "system" as const };
  const events: RunEvent[] = [
    {
      ...base,
      seq: 1,
      at: "2026-06-12T00:00:00.000Z",
      type: "node.verify.iteration",
      payload: { nodeId, iteration: 1, maxIterations: 3, build: "pass", testsPass: 1, testsTotal: 1 }
    },
    {
      ...base,
      seq: 2,
      at: "2026-06-12T00:00:01.000Z",
      type: "decision.raised",
      payload: {
        decisionId: `clarify:${nodeId}`,
        kind: "clarify",
        blocking: input.blocking ?? true,
        context: {
          nodeIds: input.decisionNodeIds ?? [nodeId],
          question: "¿Cómo querés continuar?",
          options: ["Aceptar conflicto y continuar", "Abortar run"],
          gate: "merge_conflict"
        }
      }
    }
  ];
  if (input.resolved === true) {
    events.push({
      ...base,
      seq: 3,
      at: "2026-06-12T00:00:02.000Z",
      actor: "human",
      type: "decision.resolved",
      payload: { decisionId: `clarify:${nodeId}`, choice: { answer: "Aceptar conflicto y continuar" }, actor: "human" }
    });
  }
  return events;
}

describe("selectRenderableNodeState — gated derivation", () => {
  it("a verifying node referenced by a pending blocking decision renders as gated", () => {
    const m = reduceRunEvents(initialFor("run-gated"), gatedEvents({}));
    const state = selectRenderableNodeState(m, "build-ui");
    expect(state.display).toBe("gated");
    // lifecycle keeps the raw execution kind; only the painted display changes.
    expect(state.lifecycle).toBe("verifying");
  });

  it("resolving the decision restores the underlying display without extra events", () => {
    const m = reduceRunEvents(initialFor("run-gated"), gatedEvents({ resolved: true }));
    expect(selectRenderableNodeState(m, "build-ui").display).toBe("verifying");
  });

  it("a non-blocking decision does not gate the node", () => {
    const m = reduceRunEvents(initialFor("run-gated"), gatedEvents({ blocking: false }));
    expect(selectRenderableNodeState(m, "build-ui").display).toBe("verifying");
  });

  it("a decision referencing another node does not gate this one", () => {
    const m = reduceRunEvents(initialFor("run-gated"), gatedEvents({ decisionNodeIds: ["other-node"] }));
    expect(selectRenderableNodeState(m, "build-ui").display).toBe("verifying");
  });
});

// ── General ────────────────────────────────────────────────────────────────────

describe("selectors — general", () => {
  it.each(ALL)("1. %s can be queried by every selector without throwing", (_name, fx) => {
    const m = reduceFixture(fx);
    expect(() => {
      selectPhase(m);
      selectHealth(m);
      selectWavefront(m);
      selectAttention(m);
      selectBlocked(m);
      selectConflicts(m);
      selectEvidence(m);
      selectInvalidatedNodes(m);
      selectPendingReexecution(m);
      for (const id of m.nodes.keys()) {
        selectFreshness(m, id);
        selectRenderableNodeState(m, id);
      }
      for (const id of m.amendments.keys()) selectAffectedByAmendment(m, id);
    }).not.toThrow();
  });

  it("2. selectors do not mutate the model", () => {
    const m = reduceFixture(goldenSeamAmendmentBlastRadius);
    const before = { nodes: m.nodes.size, seams: m.seams.size, decisions: m.decisions.size, cursor: m.cursor };
    selectPhase(m);
    selectHealth(m);
    selectWavefront(m);
    selectInvalidatedNodes(m);
    for (const id of m.nodes.keys()) selectRenderableNodeState(m, id);
    expect({ nodes: m.nodes.size, seams: m.seams.size, decisions: m.decisions.size, cursor: m.cursor }).toEqual(before);
  });

  it.each(ALL)("3. %s wavefront only contains running/verifying nodes", (_name, fx) => {
    const m = reduceFixture(fx);
    for (const id of selectWavefront(m)) {
      const kind = m.nodes.get(id)!.execution.kind;
      expect(kind === "running" || kind === "verifying").toBe(true);
    }
  });

  it.each(ALL)("4. %s attention only contains pending decisions", (_name, fx) => {
    const m = reduceFixture(fx);
    for (const d of selectAttention(m)) expect(d.status).toBe("pending");
  });

  it("5. selectEvidence is null when there is no evidence", () => {
    expect(selectEvidence(reduceFixture(goldenPlanningQuestion))).toBeNull();
  });

  it.each(ALL)("6. %s never renders a stale node as 'done'", (_name, fx) => {
    const m = reduceFixture(fx);
    for (const id of m.nodes.keys()) {
      if (selectFreshness(m, id) === "stale") {
        expect(selectRenderableNodeState(m, id).display).not.toBe("done");
      }
    }
  });
});

// ── golden-happy-path ─────────────────────────────────────────────────────────

describe("selectors — golden-happy-path", () => {
  it("after approve_plan raised: proposal + attention", () => {
    const m = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "decision.raised" && pl(e).kind === "approve_plan"));
    expect(selectPhase(m)).toBe("proposal");
    expect(selectHealth(m)).toBe("attention");
    expect(selectAttention(m).some((d) => d.kind === "approve_plan")).toBe(true);
  });

  it("after approve_plan resolved (pre-execution): foundation", () => {
    const m = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "decision.resolved" && pl(e).decisionId === "d-approve"));
    expect(selectPhase(m)).toBe("foundation");
  });

  it("during the wave: supervision + working + active wavefront", () => {
    const m = reduceUpToSeq(goldenHappyPath, lastSeqOf(goldenHappyPath, (e) => e.type === "node.execution.started"));
    expect(selectPhase(m)).toBe("supervision");
    expect(selectHealth(m)).toBe("working");
    expect(selectWavefront(m)).toEqual(["n-logic", "n-store", "n-ui"]);
  });

  it("at the end: disposition + evidence + no invalidated nodes", () => {
    const m = reduceFixture(goldenHappyPath);
    expect(selectPhase(m)).toBe("disposition");
    expect(selectEvidence(m)).not.toBeNull();
    expect(selectInvalidatedNodes(m)).toEqual([]);
  });
});

// ── golden-planning-question ────────────────────────────────────────────────

describe("selectors — golden-planning-question", () => {
  it("during clarify: proposal + attention + clarify in the channel", () => {
    const m = reduceUpToSeq(goldenPlanningQuestion, seqOf(goldenPlanningQuestion, (e) => e.type === "decision.raised" && pl(e).kind === "clarify"));
    expect(selectPhase(m)).toBe("proposal");
    expect(selectHealth(m)).toBe("attention");
    expect(selectAttention(m).some((d) => d.kind === "clarify")).toBe(true);
    expect(selectBlocked(m)).toContain("n-export");
  });

  it("after clarify resolved: clarify leaves the channel", () => {
    const m = reduceUpToSeq(goldenPlanningQuestion, seqOf(goldenPlanningQuestion, (e) => e.type === "decision.resolved" && pl(e).decisionId === "d-clarify"));
    expect(selectAttention(m).some((d) => d.kind === "clarify")).toBe(false);
  });

  it("at the end: approve_plan pending and no evidence", () => {
    const m = reduceFixture(goldenPlanningQuestion);
    expect(selectAttention(m).some((d) => d.kind === "approve_plan")).toBe(true);
    expect(selectEvidence(m)).toBeNull();
  });
});

// ── golden-verify-auto-repair ────────────────────────────────────────────────

describe("selectors — golden-verify-auto-repair", () => {
  it("during failure/repair: working, no attention, node in wavefront", () => {
    const m = reduceUpToSeq(goldenVerifyAutoRepair, seqOf(goldenVerifyAutoRepair, (e) => e.type === "node.repair.started"));
    expect(selectHealth(m)).toBe("working");
    expect(selectAttention(m)).toEqual([]);
    expect(selectWavefront(m)).toContain("n-email");
  });

  it("at the end: node done, no conflicts, no decisions", () => {
    const m = reduceFixture(goldenVerifyAutoRepair);
    expect(selectRenderableNodeState(m, "n-email").display).toBe("done");
    expect(selectConflicts(m)).toEqual([]);
    expect(selectAttention(m)).toEqual([]);
  });
});

// ── golden-behavioral-conflict ────────────────────────────────────────────────

describe("selectors — golden-behavioral-conflict", () => {
  it("after conflict + resolve_conflict raised: attention + behavioral conflict active", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict"));
    expect(selectHealth(m)).toBe("attention");
    expect(selectAttention(m).some((d) => d.kind === "resolve_conflict")).toBe(true);
    expect(selectConflicts(m).some((c) => c.dimension === "behavioral")).toBe(true);
  });

  it("after decision.resolved but before conflict.resolved: conflict still active", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "decision.resolved" && pl(e).decisionId === "d-conflict"));
    expect(selectConflicts(m).some((c) => c.id === "cf-unit")).toBe(true);
  });

  it("a contract amendment does NOT invalidate consumers", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "seam.amended"));
    expect(selectInvalidatedNodes(m)).toEqual([]);
  });

  it("at the end: conflict resolved (inactive), evidence present, nothing stale", () => {
    const m = reduceFixture(goldenBehavioralConflict);
    expect(selectConflicts(m)).toEqual([]);
    expect(selectEvidence(m)).not.toBeNull();
    expect(selectInvalidatedNodes(m)).toEqual([]);
  });
});

// ── golden-seam-amendment-blast-radius ────────────────────────────────────────

describe("selectors — golden-seam-amendment-blast-radius", () => {
  const fx = goldenSeamAmendmentBlastRadius;

  it("after approve_amendment raised: projected blast, no real invalidation, attention", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "decision.raised" && pl(e).kind === "approve_amendment"));
    expect(selectAffectedByAmendment(m, "am-pag").sort()).toEqual(["c-results", "n-api", "n-search", "n-ui", "root"]);
    expect(selectInvalidatedNodes(m)).toEqual([]);
    expect(selectHealth(m)).toBe("attention");
  });

  it("after decision.resolved but before seam.amended: still no real invalidation", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "decision.resolved" && pl(e).decisionId === "d-amend"));
    expect(selectInvalidatedNodes(m)).toEqual([]);
  });

  it("after seam.amended (signature, rev2): consumers + composites invalidated, independent preserved", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "seam.amended"));
    const invalid = selectInvalidatedNodes(m);
    expect(invalid).toEqual(expect.arrayContaining(["n-api", "n-ui", "c-results", "root"]));
    expect(invalid).not.toContain("n-telemetry");
    // affected consumers were integrated against rev1 → render obsolete (not done)
    expect(selectRenderableNodeState(m, "n-api").display).toBe("obsolete");
  });

  it("during re-execution: only affected nodes are pending re-execution / on the wavefront", () => {
    // Right after the producer re-runs and applies, before the consumers re-run.
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "amendment.applied"));
    const pending = selectPendingReexecution(m);
    expect(pending).toEqual(expect.arrayContaining(["n-api", "n-ui"]));
    expect(pending).not.toContain("n-telemetry");
  });

  it("at the end: nothing stale, independent node still done, evidence has invalidationTrace", () => {
    const m = reduceFixture(fx);
    expect(selectInvalidatedNodes(m)).toEqual([]);
    expect(selectRenderableNodeState(m, "n-telemetry").display).toBe("done");
    expect(selectEvidence(m)?.invalidationTrace?.[0]?.preserved).toEqual(["n-telemetry"]);
  });
});
