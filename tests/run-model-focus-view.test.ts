/**
 * PR-U1 — focus view-model tests (pure, node environment).
 *
 * `buildFocusView(model, target)` is the polymorphic deep-on-demand projection the
 * focus panel renders. These tests assert each focus kind (node / seam / conflict /
 * decision / evidence) projects the right depth from the model, that missing /
 * not-yet targets degrade safely (never throw), that focusing never mutates the
 * model, and the cross-cutting invariant that a stale node never focuses as "done".
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  buildFocusView,
  formatFocusTarget,
  parseFocusTarget,
  EVIDENCE_FOCUS_TARGET,
  type FocusTarget
} from "@/lib/run-model/focus-view";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  goldenBehavioralConflict,
  goldenHappyPath,
  goldenPlanningQuestion,
  goldenSeamAmendmentBlastRadius
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
function seqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return fx.events.find(predicate)!.seq;
}
function pl(e: RunEvent): Record<string, unknown> {
  return e.payload;
}

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

// ── 1–2. Node focus ───────────────────────────────────────────────────────────────

describe("focus-view — node focus", () => {
  it("1. returns a node focus for an existing node", () => {
    const view = buildFocusView(reduceFixture(goldenHappyPath), { kind: "node", id: "n-store" });
    expect(view.kind).toBe("node");
    if (view.kind !== "node") return;
    expect(view.id).toBe("n-store");
    expect(view.title).toBe("CounterStore");
    expect(view.role).toBe("leaf");
    expect(view.depth).toBe(1);
    expect(view.parent?.id).toBe("root");
  });

  it("2. includes display, freshness, full vital, builtAgainst, changedFiles, commit and produces/consumes", () => {
    const view = buildFocusView(reduceFixture(goldenHappyPath), { kind: "node", id: "n-store" });
    if (view.kind !== "node") throw new Error("expected node focus");
    expect(view.display).toBe("done");
    expect(view.freshness).toBe("fresh");
    expect(view.vital.status).toBe("done");
    expect(view.vital.label).toBeTruthy();
    expect(view.builtAgainst).toEqual([{ seamId: "seam-counter", revision: 1 }]);
    expect(view.producedRevision).toEqual({ seamId: "seam-counter", revision: 1 });
    expect(view.changedFiles).toEqual(["src/counter/store.ts"]);
    expect(view.commit).toBe("s1");
    expect(view.produces.map((s) => s.id)).toContain("seam-counter");
    expect(view.produces.find((s) => s.id === "seam-counter")?.state).toBe("frozen");
    const ui = buildFocusView(reduceFixture(goldenHappyPath), { kind: "node", id: "n-ui" });
    if (ui.kind !== "node") throw new Error("expected node focus");
    expect(ui.consumes.map((s) => s.id)).toContain("seam-counter");
  });

  it("2b. node focus exposes resolvable diff/log artifact refs", () => {
    const view = buildFocusView(reduceFixture(goldenHappyPath), { kind: "node", id: "n-store" });
    if (view.kind !== "node") throw new Error("expected node focus");
    expect(view.refs.length).toBeGreaterThanOrEqual(2);
    for (const ref of view.refs) {
      expect(ref.available).toBe(true);
      expect(ref.ref).toMatch(/:\/\/runs\/.+\/node\/n-store/);
    }
  });
});

// ── 3. Seam focus ─────────────────────────────────────────────────────────────────

describe("focus-view — seam focus", () => {
  it("3. includes revision, state, producer, consumers, signature and contract", () => {
    // happy-path: producer/consumers/signature
    const happy = buildFocusView(reduceFixture(goldenHappyPath), { kind: "seam", id: "seam-counter" });
    if (happy.kind !== "seam") throw new Error("expected seam focus");
    expect(happy.state).toBe("frozen");
    expect(happy.revision).toBe(1);
    expect(happy.producerNodeId).toBe("n-store");
    expect(happy.consumerNodeIds).toEqual(["n-ui", "n-logic"]);
    expect(happy.consumers.map((c) => c.id)).toEqual(["n-ui", "n-logic"]);
    expect(happy.signatureFrozen).toContain("inc():void");
    expect(happy.parallelismNote).toMatch(/paralelo/i);

    // behavioral-conflict: contract + lastChangeKind after a contract amendment
    const conflict = buildFocusView(reduceFixture(goldenBehavioralConflict), { kind: "seam", id: "seam-store" });
    if (conflict.kind !== "seam") throw new Error("expected seam focus");
    expect(conflict.state).toBe("amended");
    expect(conflict.revision).toBe(2);
    expect(conflict.contract).toEqual({ "duration.unit": "ms" });
    expect(conflict.lastChangeKind).toBe("contract");
  });
});

// ── 4. Conflict focus ─────────────────────────────────────────────────────────────

describe("focus-view — conflict focus", () => {
  it("4. golden-behavioral-conflict: behavioral dimension, diagnosisRef, associated decision, judgement copy", () => {
    const seq = seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict");
    const view = buildFocusView(reduceUpToSeq(goldenBehavioralConflict, seq), { kind: "conflict", id: "cf-unit" });
    if (view.kind !== "conflict") throw new Error("expected conflict focus");
    expect(view.dimension).toBe("behavioral");
    expect(view.status).toBe("detected");
    expect(view.autoResolvable).toBe(false);
    expect(view.diagnosisRef.available).toBe(true);
    expect(view.diagnosisRef.ref).toContain("diag");
    expect(view.decision?.id).toBe("d-conflict");
    expect(view.decision?.kind).toBe("resolve_conflict");
    expect(view.judgementNote).toMatch(/conductual|juicio/i);
  });

  it("4b. once resolved, conflict focus carries the resolution", () => {
    const view = buildFocusView(reduceFixture(goldenBehavioralConflict), { kind: "conflict", id: "cf-unit" });
    if (view.kind !== "conflict") throw new Error("expected conflict focus");
    expect(view.status).toBe("resolved");
    expect(view.resolution?.by).toBe("human");
    expect(view.resolution?.resolutionId).toBe("canonical-ms-fix-store");
  });
});

// ── 5–6. Decision focus ───────────────────────────────────────────────────────────

describe("focus-view — decision focus", () => {
  it("5. clarify: question/options while pending (with action), and choice once resolved", () => {
    // pending: up to the clarify decision.raised
    const raisedSeq = seqOf(goldenPlanningQuestion, (e) => e.type === "decision.raised" && pl(e).kind === "clarify");
    const pending = buildFocusView(reduceUpToSeq(goldenPlanningQuestion, raisedSeq), { kind: "decision", id: "d-clarify" });
    if (pending.kind !== "decision") throw new Error("expected decision focus");
    expect(pending.decisionKind).toBe("clarify");
    expect(pending.status).toBe("pending");
    expect(pending.question).toBe("¿Formato de exportación?");
    expect(pending.options).toEqual(["CSV", "PDF"]);
    expect(pending.choice).toBeUndefined();
    expect(pending.pendingAction?.label).toBeTruthy();

    // resolved: full reduce
    const resolved = buildFocusView(reduceFixture(goldenPlanningQuestion), { kind: "decision", id: "d-clarify" });
    if (resolved.kind !== "decision") throw new Error("expected decision focus");
    expect(resolved.status).toBe("resolved");
    expect(resolved.choice).toEqual({ answer: "CSV" });
    expect(resolved.pendingAction).toBeUndefined();
  });

  it("6. approve_amendment: embeds amendment, affected nodes and the seam", () => {
    const seq = seqOf(goldenSeamAmendmentBlastRadius, (e) => e.type === "decision.raised" && pl(e).kind === "approve_amendment");
    const view = buildFocusView(reduceUpToSeq(goldenSeamAmendmentBlastRadius, seq), { kind: "decision", id: "d-amend" });
    if (view.kind !== "decision") throw new Error("expected decision focus");
    expect(view.decisionKind).toBe("approve_amendment");
    expect(view.blocking).toBe(true);
    expect(view.amendment?.id).toBe("am-pag");
    expect(view.amendment?.changeKind).toBe("signature");
    expect(view.affectedNodeIds.sort()).toEqual(["c-results", "n-api", "n-search", "n-ui", "root"]);
    expect(view.seam?.id).toBe("seam-search");
  });
});

// ── 7–8. Evidence focus ───────────────────────────────────────────────────────────

describe("focus-view — evidence focus", () => {
  it("7. golden-happy-path: tests, diffRef, narrativeRef, integrationCommit and the approve_merge relation", () => {
    const view = buildFocusView(reduceFixture(goldenHappyPath), EVIDENCE_FOCUS_TARGET);
    if (view.kind !== "evidence") throw new Error("expected evidence focus");
    expect(view.tests).toEqual({ pass: 8, total: 8 });
    expect(view.aggregateDiffRef.ref).toBe("blob://golden-happy-path/diff");
    expect(view.aggregateDiffRef.available).toBe(true);
    expect(view.narrativeRef.ref).toBe("blob://golden-happy-path/narrative");
    expect(view.integrationCommit).toBe("r1");
    expect(view.approveMergeDecision?.id).toBe("d-merge");
    expect(view.approveMergeDecision?.status).toBe("resolved");
    expect(view.acceptanceCopy).toMatch(/aceptado/i);
  });

  it("8. golden-seam-amendment-blast-radius: invalidationTrace with reExecuted/reIntegrated/preserved", () => {
    const view = buildFocusView(reduceFixture(goldenSeamAmendmentBlastRadius), EVIDENCE_FOCUS_TARGET);
    if (view.kind !== "evidence") throw new Error("expected evidence focus");
    expect(view.invalidationTrace?.[0]?.seamId).toBe("seam-search");
    expect(view.reExecuted).toEqual(expect.arrayContaining(["n-search", "n-api", "n-ui"]));
    expect(view.reIntegrated).toEqual(expect.arrayContaining(["c-results", "root"]));
    expect(view.preserved).toEqual(["n-telemetry"]);
  });
});

// ── 9–10. Safe degradation ────────────────────────────────────────────────────────

describe("focus-view — safe degradation", () => {
  it("9. a non-existent target returns a missing view (never throws)", () => {
    const model = reduceFixture(goldenHappyPath);
    for (const target of [
      { kind: "node", id: "does-not-exist" },
      { kind: "seam", id: "nope" },
      { kind: "conflict", id: "nope" },
      { kind: "decision", id: "nope" }
    ] as FocusTarget[]) {
      const view = buildFocusView(model, target);
      expect(view.kind).toBe("missing");
      if (view.kind === "missing") expect(view.message).toBeTruthy();
    }
  });

  it("10. a not-yet-available target (evidence before disposition) returns a missing view", () => {
    // Early cut: planning only — no evidence, conflict/decision not raised yet.
    const early = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "plan.started"));
    const evidence = buildFocusView(early, EVIDENCE_FOCUS_TARGET);
    expect(evidence.kind).toBe("missing");
    // A conflict that only appears much later is also safely missing in an early cut.
    const conflict = buildFocusView(early, { kind: "conflict", id: "cf-unit" });
    expect(conflict.kind).toBe("missing");
  });
});

// ── 11. Purity ────────────────────────────────────────────────────────────────────

describe("focus-view — purity", () => {
  it("11. focusing never mutates the RunModel", () => {
    const model = reduceFixture(goldenSeamAmendmentBlastRadius);
    const before = JSON.stringify({
      nodes: [...model.nodes.entries()],
      seams: [...model.seams.entries()],
      conflicts: [...model.conflicts.entries()],
      decisions: [...model.decisions.entries()],
      amendments: [...model.amendments.entries()],
      evidence: model.evidence,
      cursor: model.cursor
    });
    for (const target of [
      { kind: "node", id: "n-api" },
      { kind: "seam", id: "seam-search" },
      { kind: "decision", id: "d-amend" },
      EVIDENCE_FOCUS_TARGET
    ] as FocusTarget[]) {
      buildFocusView(model, target);
    }
    const after = JSON.stringify({
      nodes: [...model.nodes.entries()],
      seams: [...model.seams.entries()],
      conflicts: [...model.conflicts.entries()],
      decisions: [...model.decisions.entries()],
      amendments: [...model.amendments.entries()],
      evidence: model.evidence,
      cursor: model.cursor
    });
    expect(after).toBe(before);
  });
});

// ── 12–13. stale/obsolete invariants ──────────────────────────────────────────────

describe("focus-view — stale/obsolete invariants", () => {
  it("12. no node focus ever renders a stale node as 'done' (all fixtures, all cuts)", () => {
    for (const [, fx] of ALL) {
      // sample a few cuts so a mid-blast (stale-present) state is exercised
      const cuts = [Math.floor(fx.events.length / 2), fx.events.length];
      for (const upTo of cuts) {
        const model = reduceUpToSeq(fx, upTo);
        for (const ws of selectWorkspaceView(model).nodes) {
          const view = buildFocusView(model, { kind: "node", id: ws.id });
          if (view.kind === "node" && view.freshness === "stale") {
            expect(view.display).not.toBe("done");
          }
        }
      }
    }
  });

  it("13. an obsolete node focuses as obsolete + pending reexecution (never failed nor done)", () => {
    const seq = seqOf(goldenSeamAmendmentBlastRadius, (e) => e.type === "seam.amended");
    const model = reduceUpToSeq(goldenSeamAmendmentBlastRadius, seq);
    const view = buildFocusView(model, { kind: "node", id: "n-api" });
    if (view.kind !== "node") throw new Error("expected node focus");
    expect(view.display).toBe("obsolete");
    expect(view.display).not.toBe("failed");
    expect(view.display).not.toBe("done");
    expect(view.freshness).toBe("stale");
    expect(view.isInvalidated).toBe(true);
    expect(view.isPendingReexecution).toBe(true);
    expect(view.vital.status).toBe("obsolete");
  });
});

// ── 14. Target parse/format helpers ───────────────────────────────────────────────

describe("focus-view — focus target helpers", () => {
  it("14. parse/format round-trip for every kind", () => {
    const targets: FocusTarget[] = [
      { kind: "node", id: "n-api" },
      { kind: "seam", id: "seam-search" },
      { kind: "conflict", id: "cf-unit" },
      { kind: "decision", id: "d-amend" },
      { kind: "evidence", id: "final" }
    ];
    for (const t of targets) {
      expect(parseFocusTarget(formatFocusTarget(t))).toEqual(t);
    }
  });

  it("14b. parseFocusTarget rejects malformed input", () => {
    for (const bad of ["", "node", "node:", ":id", "unknown:x", "  ", null, undefined]) {
      expect(parseFocusTarget(bad)).toBeNull();
    }
  });

  it("14c. parseFocusTarget tolerates ids containing extra colons and whitespace", () => {
    expect(parseFocusTarget(" node:n-api ")).toEqual({ kind: "node", id: "n-api" });
    expect(parseFocusTarget("seam:a:b")).toEqual({ kind: "seam", id: "a:b" });
  });
});
