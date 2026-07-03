/**
 * PR 07 — decision channel tests.
 *
 * Node environment (no jsdom/RTL): the testable truth is the PURE channel
 * projection (`buildDecisionChannelView`) plus the fixture-resolution helpers
 * (`findDecisionResolutionEvent` / `advanceFixtureToDecisionResolution`) that the
 * player uses to "resolve" a decision by fast-forwarding to an EXISTING
 * `decision.resolved` — never an invented event.
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  advanceFixtureToDecisionResolution,
  buildDecisionChannelView,
  findDecisionResolutionEvent,
  formatDecisionKind
} from "@/lib/run-model/decision-channel-view";
import {
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
/** Playback index after applying every event with `seq <= cutSeq`. */
function idxAtSeq(fx: RunFixture, cutSeq: number): number {
  return fx.events.filter((e) => e.seq <= cutSeq).length;
}

// ── Projection per kind ───────────────────────────────────────────────────────

describe("decision-channel — projection", () => {
  it("1. golden-happy-path surfaces approve_plan after plan.ready", () => {
    const m = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "decision.raised" && pl(e).kind === "approve_plan"));
    const view = buildDecisionChannelView(m);
    expect(view.empty).toBe(false);
    const item = view.items.find((i) => i.kind === "approve_plan");
    expect(item).toBeDefined();
    expect(item!.blocking).toBe(true);
    expect(item!.primaryActionLabel).toBe("Aprobar plan");
  });

  it("3. golden-planning-question surfaces clarify with question + options", () => {
    const m = reduceUpToSeq(goldenPlanningQuestion, seqOf(goldenPlanningQuestion, (e) => e.type === "decision.raised" && pl(e).kind === "clarify"));
    const view = buildDecisionChannelView(m);
    const item = view.items.find((i) => i.kind === "clarify")!;
    expect(item.question).toBe("¿Formato de exportación?");
    expect(item.options).toEqual(["CSV", "PDF"]);
    expect(item.affectedNodeIds).toContain("n-export");
    // the fixtured answer is available at the resolution event
    const fromIndex = idxAtSeq(goldenPlanningQuestion, seqOf(goldenPlanningQuestion, (e) => e.type === "decision.raised" && pl(e).kind === "clarify"));
    const found = findDecisionResolutionEvent(goldenPlanningQuestion.events, fromIndex, "d-clarify")!;
    expect((pl(found.event) as { choice?: { answer?: string } }).choice?.answer).toBe("CSV");
  });

  it("3b. a clarify decision with context.gate is labeled as an execution gate, not a planner question", () => {
    const m = reduceRunEvents(initialFor("run-gate"), [
      {
        seq: 1,
        at: "2026-06-12T00:00:00.000Z",
        runId: "run-gate",
        actor: "system",
        type: "decision.raised",
        payload: {
          decisionId: "clarify:build-ui",
          kind: "clarify",
          blocking: true,
          context: {
            nodeIds: ["build-ui"],
            question: "La integración falló. ¿Cómo querés continuar?",
            options: ["Aceptar conflicto y continuar", "Abortar run"],
            gate: "merge_conflict"
          }
        }
      }
    ]);
    const view = buildDecisionChannelView(m);
    const item = view.items.find((i) => i.id === "clarify:build-ui")!;
    expect(item.label).toBe("Gate de ejecución");
    expect(item.primaryActionLabel).toBe("Elegir opción");
    expect(item.options).toEqual(["Aceptar conflicto y continuar", "Abortar run"]);
    // a plain planner clarify keeps the original copy
    expect(formatDecisionKind("clarify")).toBe("Aclaración");
  });

  it("5. golden-behavioral-conflict surfaces resolve_conflict with behavioral dimension + diagnosisRef", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict"));
    const view = buildDecisionChannelView(m);
    const item = view.items.find((i) => i.kind === "resolve_conflict")!;
    expect(item.conflict).toBeDefined();
    expect(item.conflict!.dimension).toBe("behavioral");
    expect(item.conflict!.diagnosisRef.length).toBeGreaterThan(0);
    expect(item.conflict!.nodeIds).toEqual(["n-store", "n-ui"]);
  });

  it("6. golden-seam-amendment-blast-radius surfaces approve_amendment with signature changeKind + affects", () => {
    const m = reduceUpToSeq(goldenSeamAmendmentBlastRadius, seqOf(goldenSeamAmendmentBlastRadius, (e) => e.type === "decision.raised" && pl(e).kind === "approve_amendment"));
    const view = buildDecisionChannelView(m);
    const item = view.items.find((i) => i.kind === "approve_amendment")!;
    expect(item.amendment).toBeDefined();
    expect(item.amendment!.changeKind).toBe("signature");
    expect(item.amendment!.affects).toEqual(expect.arrayContaining(["n-search", "n-api", "n-ui", "c-results", "root"]));
    expect(item.seam?.name).toBe("SearchService");
  });

  it("+ golden-happy-path surfaces approve_merge with evidence (the fifth kind)", () => {
    const m = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "decision.raised" && pl(e).kind === "approve_merge"));
    const view = buildDecisionChannelView(m);
    const item = view.items.find((i) => i.kind === "approve_merge")!;
    expect(item.evidence).toBeDefined();
    expect(item.evidence!.tests).toEqual({ pass: 8, total: 8 });
    expect(item.primaryActionLabel).toBe("Aceptar resultado");
  });

  it("formatDecisionKind labels all five kinds", () => {
    expect(formatDecisionKind("approve_plan")).toBe("Aprobar plan");
    expect(formatDecisionKind("clarify")).toBe("Aclaración");
    expect(formatDecisionKind("resolve_conflict")).toBe("Resolver conflicto");
    expect(formatDecisionKind("approve_amendment")).toBe("Aprobar enmienda");
    expect(formatDecisionKind("approve_merge")).toBe("Aprobar merge");
  });
});

// ── Empty state = success ───────────────────────────────────────────────────────

describe("decision-channel — empty state", () => {
  it("7. with nothing pending, returns success copy and no items", () => {
    const view = buildDecisionChannelView(reduceFixture(goldenHappyPath));
    expect(view.empty).toBe(true);
    expect(view.items).toEqual([]);
    expect(view.emptyCopy).toMatch(/nada requiere tu atención/i);
  });

  it("4. after resolving clarify, the channel no longer shows it", () => {
    const m = reduceUpToSeq(goldenPlanningQuestion, seqOf(goldenPlanningQuestion, (e) => e.type === "decision.resolved" && pl(e).decisionId === "d-clarify"));
    const view = buildDecisionChannelView(m);
    expect(view.items.some((i) => i.kind === "clarify")).toBe(false);
  });
});

// ── Simulated resolution via fixtures (no invented events) ────────────────────────

describe("decision-channel — fixture resolution", () => {
  it("2. resolving approve_plan fast-forwards to its decision.resolved", () => {
    const cut = seqOf(goldenHappyPath, (e) => e.type === "decision.raised" && pl(e).kind === "approve_plan");
    const fromIndex = idxAtSeq(goldenHappyPath, cut);
    const plan = advanceFixtureToDecisionResolution(goldenHappyPath.events, fromIndex, "d-approve");
    expect(plan).not.toBeNull();
    expect(plan!.resolution.event.type).toBe("decision.resolved");
    expect(pl(plan!.resolution.event).decisionId).toBe("d-approve");
    // last applied event IS the resolution; index points just past it
    expect(plan!.apply[plan!.apply.length - 1]).toBe(plan!.resolution.event);
    expect(plan!.nextIndex).toBe(plan!.resolution.index + 1);
  });

  it("8. a pending decision with no future resolution does not crash (returns null)", () => {
    const m = reduceFixture(goldenPlanningQuestion); // ends with approve_plan pending
    const view = buildDecisionChannelView(m);
    expect(view.items.some((i) => i.kind === "approve_plan")).toBe(true);
    const fromIndex = goldenPlanningQuestion.events.length;
    expect(findDecisionResolutionEvent(goldenPlanningQuestion.events, fromIndex, "d-approve")).toBeNull();
    expect(advanceFixtureToDecisionResolution(goldenPlanningQuestion.events, fromIndex, "d-approve")).toBeNull();
  });

  it("9. buildDecisionChannelView does not mutate the model", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict"));
    const before = { nodes: m.nodes.size, conflicts: m.conflicts.size, decisions: m.decisions.size, cursor: m.cursor };
    buildDecisionChannelView(m);
    expect({ nodes: m.nodes.size, conflicts: m.conflicts.size, decisions: m.decisions.size, cursor: m.cursor }).toEqual(before);
  });

  it("10. resolution applies ONLY existing fixture events (no invented seq)", () => {
    const cut = seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict");
    const fromIndex = idxAtSeq(goldenBehavioralConflict, cut);
    const plan = advanceFixtureToDecisionResolution(goldenBehavioralConflict.events, fromIndex, "d-conflict")!;
    // every applied event is the exact same reference that exists in the fixture,
    // and sits at its original index (so no `seq` was invented or shifted).
    plan.apply.forEach((event, offset) => {
      const originalIndex = fromIndex + offset;
      expect(event).toBe(goldenBehavioralConflict.events[originalIndex]);
      expect(event.seq).toBe(originalIndex + 1);
    });
    expect(pl(plan.resolution.event).decisionId).toBe("d-conflict");
  });
});
