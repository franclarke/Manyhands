/**
 * PR 06 — proto render projection tests.
 *
 * The repo's vitest runs in the `node` environment (no jsdom / React Testing
 * Library; the include glob is `tests/**\/*.test.ts`). So the testable truth of
 * the prototype is its PURE projection — `selectProtoView` — which is exactly the
 * object the `.tsx` shell renders (the components are a thin map over it). These
 * tests assert what the prototype paints: frame (intent/phase/health), the node
 * surface, the wavefront, the attention summary, conflicts, and the invariant
 * that a stale node is never painted "done". The React shell + playback hook are
 * exercised manually via `/runs/proto/<fixture>` (documented in the PR notes).
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectProtoView } from "@/lib/run-model/proto-view";
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
function seqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return fx.events.find(predicate)!.seq;
}
function lastSeqOf(fx: RunFixture, predicate: (e: RunEvent) => boolean): number {
  return [...fx.events].reverse().find(predicate)!.seq;
}
function pl(e: RunEvent): Record<string, unknown> {
  return e.payload;
}

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

// ── General ────────────────────────────────────────────────────────────────────

describe("proto-view — general", () => {
  it.each(ALL)("1. projects %s without throwing and renders every node", (_name, fx) => {
    const m = reduceFixture(fx);
    const view = selectProtoView(m);
    expect(view.nodes.map((n) => n.id).sort()).toEqual([...m.nodes.keys()].sort());
    // Columns are a partition of nodes: same count, no loss.
    const inColumns = view.columns.reduce((acc, c) => acc + c.nodes.length, 0);
    expect(inColumns).toBe(view.nodes.length);
  });

  it.each(ALL)("2. %s never paints a stale node as 'done'", (_name, fx) => {
    const view = selectProtoView(reduceFixture(fx));
    for (const row of view.nodes) {
      if (row.obsolete) {
        expect(row.display).toBe("obsolete");
        expect(row.done).toBe(false);
      }
      if (row.display === "done") expect(row.obsolete).toBe(false);
    }
  });

  it.each(ALL)("3. projecting %s does not mutate the model", (_name, fx) => {
    const m = reduceFixture(fx);
    const before = { nodes: m.nodes.size, seams: m.seams.size, decisions: m.decisions.size, cursor: m.cursor };
    selectProtoView(m, { fixtureName: _name });
    expect({ nodes: m.nodes.size, seams: m.seams.size, decisions: m.decisions.size, cursor: m.cursor }).toEqual(before);
  });
});

// ── golden-happy-path ─────────────────────────────────────────────────────────

describe("proto-view — golden-happy-path", () => {
  it("at the end: frame shows intent/phase/health, evidence, and a clear attention", () => {
    const view = selectProtoView(reduceFixture(goldenHappyPath));
    expect(view.frame.intent).toMatch(/contador/i);
    expect(view.frame.phase).toBe("disposition");
    expect(view.frame.health).toBe("settled");
    expect(view.frame.hasEvidence).toBe(true);
    expect(view.frame.nodeCount).toBe(4);
    expect(view.frame.attentionClear).toBe(true);
    expect(view.frame.attentionSummary).toMatch(/nada requiere tu atención/i);
    // root is the only depth-0 node (column layout).
    const depth0 = view.columns.find((c) => c.depth === 0)!;
    expect(depth0.nodes.map((n) => n.id)).toEqual(["root"]);
  });

  it("during the wave: supervision + working + active wavefront flagged on rows", () => {
    const m = reduceUpToSeq(goldenHappyPath, lastSeqOf(goldenHappyPath, (e) => e.type === "node.execution.started"));
    const view = selectProtoView(m);
    expect(view.frame.phase).toBe("supervision");
    expect(view.frame.health).toBe("working");
    expect(view.frame.wavefrontCount).toBe(3);
    const onWavefront = view.nodes.filter((n) => n.onWavefront).map((n) => n.id).sort();
    expect(onWavefront).toEqual(["n-logic", "n-store", "n-ui"]);
    // Working, not a void: success-first attention copy mentions the agents.
    expect(view.frame.attentionSummary).toMatch(/agentes? trabajando/i);
  });
});

// ── golden-planning-question ────────────────────────────────────────────────

describe("proto-view — golden-planning-question", () => {
  it("during clarify: a pending clarify decision surfaces and its node is blocked", () => {
    const m = reduceUpToSeq(
      goldenPlanningQuestion,
      seqOf(goldenPlanningQuestion, (e) => e.type === "decision.raised" && pl(e).kind === "clarify")
    );
    const view = selectProtoView(m);
    expect(view.frame.attentionClear).toBe(false);
    expect(view.frame.pendingDecisionCount).toBeGreaterThan(0);
    expect(view.frame.attention.some((a) => a.kind === "clarify")).toBe(true);
    expect(view.debug.blockedNodeIds).toContain("n-export");
  });
});

// ── golden-verify-auto-repair ────────────────────────────────────────────────

describe("proto-view — golden-verify-auto-repair", () => {
  it("during repair: working, nothing requires attention, node on the wavefront", () => {
    const m = reduceUpToSeq(goldenVerifyAutoRepair, seqOf(goldenVerifyAutoRepair, (e) => e.type === "node.repair.started"));
    const view = selectProtoView(m);
    expect(view.frame.health).toBe("working");
    expect(view.frame.attentionClear).toBe(true);
    expect(view.nodes.some((n) => n.id === "n-email" && n.onWavefront)).toBe(true);
  });
});

// ── golden-behavioral-conflict ────────────────────────────────────────────────

describe("proto-view — golden-behavioral-conflict", () => {
  it("after resolve_conflict raised: a behavioral conflict is active in the summary", () => {
    const m = reduceUpToSeq(
      goldenBehavioralConflict,
      seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict")
    );
    const view = selectProtoView(m);
    expect(view.frame.health).toBe("attention");
    expect(view.frame.activeConflictCount).toBeGreaterThan(0);
    expect(view.conflicts.some((c) => c.dimension === "behavioral")).toBe(true);
  });
});

// ── golden-seam-amendment-blast-radius ────────────────────────────────────────

describe("proto-view — golden-seam-amendment-blast-radius", () => {
  const fx = goldenSeamAmendmentBlastRadius;

  it("after seam.amended: an affected consumer renders 'obsolete' (never 'done')", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "seam.amended"));
    const view = selectProtoView(m);
    const nApi = view.nodes.find((n) => n.id === "n-api")!;
    expect(nApi.display).toBe("obsolete");
    expect(nApi.done).toBe(false);
    expect(view.nodes.some((n) => n.affectedByAmendment)).toBe(true);
    expect(view.debug.invalidatedNodes).toEqual(expect.arrayContaining(["n-api", "n-ui"]));
  });

  it("at the end: nothing obsolete and the independent node is done", () => {
    const view = selectProtoView(reduceFixture(fx));
    expect(view.nodes.some((n) => n.obsolete)).toBe(false);
    const telemetry = view.nodes.find((n) => n.id === "n-telemetry")!;
    expect(telemetry.display).toBe("done");
  });
});

// ── debug passthrough ───────────────────────────────────────────────────────────

describe("proto-view — debug panel", () => {
  it("carries fixtureName + last applied event + cursor", () => {
    const m = reduceFixture(goldenHappyPath);
    const last = goldenHappyPath.events[goldenHappyPath.events.length - 1]!;
    const view = selectProtoView(m, { fixtureName: "golden-happy-path", lastEvent: { type: last.type, seq: last.seq } });
    expect(view.debug.fixtureName).toBe("golden-happy-path");
    expect(view.debug.lastEventType).toBe(last.type);
    expect(view.debug.lastEventSeq).toBe(last.seq);
    expect(view.debug.cursor).toBe(last.seq);
  });
});
