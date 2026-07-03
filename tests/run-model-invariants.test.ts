/**
 * PR-U1 — consolidated cross-cutting invariants (H5).
 *
 * The agent-first model has a few invariants that must hold across EVERY layer
 * (selectors → proto-view → workspace-view → focus-view) and EVERY fixture/cut.
 * They were previously asserted piecemeal; this file is the single guard:
 *
 *   I1. stale ≠ done       — an `integrated + stale` node is "obsolete", never "done".
 *   I2. obsolete ⇔ integrated+stale, and obsolete ≠ failed (distinct displays).
 *   I3. autonomous repair never raises human attention.
 *   I4. terminal failure surfaces as "failed" + health "failing" (never done/obsolete).
 *   I5. every projection (proto/workspace/focus) is pure — never mutates the model.
 *   I6. focusing any object at any cut never throws (safe `missing` instead).
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  selectFreshness,
  selectRenderableNodeState
} from "@/lib/run-model/selectors";
import { selectProtoView } from "@/lib/run-model/proto-view";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import { buildFocusView, EVIDENCE_FOCUS_TARGET, type FocusTarget } from "@/lib/run-model/focus-view";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  goldenExecutionFailed,
  goldenSeamAmendmentBlastRadius
} from "@/lib/run-model/fixtures";
import type { RunConfig, RunFixture, RunModel } from "@/lib/run-model/types";

const STUB_CONFIG: RunConfig = {
  aggressiveness: "medium",
  planningModel: "m",
  executionSelection: { executorId: "e", model: "m" },
  repairSelection: { executorId: "e", model: "m" }
};

function reduceUpToSeq(fx: RunFixture, seq: number): RunModel {
  const initial = createInitialRunModel({ id: fx.runId, intent: "", workspaceId: "ws", config: STUB_CONFIG });
  return reduceRunEvents(initial, fx.events.filter((e) => e.seq <= seq));
}

/** A handful of cuts per fixture so partial/mid-blast states are exercised too. */
function cutsOf(fx: RunFixture): number[] {
  const n = fx.events.length;
  return [...new Set([1, Math.floor(n / 3), Math.floor(n / 2), Math.floor((2 * n) / 3), n])].filter((s) => s >= 1);
}

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

function snapshot(model: RunModel): string {
  return JSON.stringify({
    nodes: [...model.nodes.entries()],
    seams: [...model.seams.entries()],
    waves: [...model.waves.entries()],
    conflicts: [...model.conflicts.entries()],
    decisions: [...model.decisions.entries()],
    amendments: [...model.amendments.entries()],
    evidence: model.evidence,
    cursor: model.cursor
  });
}

describe("invariants — I1: stale ≠ done across every layer and cut", () => {
  it.each(ALL)("%s never paints/focuses a stale node as 'done'", (_name, fx) => {
    for (const seq of cutsOf(fx)) {
      const model = reduceUpToSeq(fx, seq);
      const proto = selectProtoView(model);
      const ws = selectWorkspaceView(model);
      for (const row of proto.nodes) {
        const stale = selectFreshness(model, row.id) === "stale";
        if (stale) expect(row.display).not.toBe("done");
      }
      for (const node of ws.nodes) {
        if (node.freshness === "stale") expect(node.display).not.toBe("done");
        const focus = buildFocusView(model, { kind: "node", id: node.id });
        if (focus.kind === "node" && focus.freshness === "stale") expect(focus.display).not.toBe("done");
      }
    }
  });
});

describe("invariants — I2: obsolete ⇔ integrated+stale, and obsolete ≠ failed", () => {
  it("the blast-radius mid-cut has obsolete nodes that are integrated+stale and not failed", () => {
    const seq = goldenSeamAmendmentBlastRadius.events.find((e) => e.type === "seam.amended")!.seq;
    const model = reduceUpToSeq(goldenSeamAmendmentBlastRadius, seq);
    const obsolete = selectWorkspaceView(model).nodes.filter((n) => n.display === "obsolete");
    expect(obsolete.length).toBeGreaterThan(0);
    for (const node of obsolete) {
      const rs = selectRenderableNodeState(model, node.id);
      expect(rs.obsolete).toBe(true);
      expect(rs.lifecycle).toBe("integrated");
      expect(rs.freshness).toBe("stale");
      expect(node.display).not.toBe("failed");
      expect(node.display).not.toBe("done");
    }
  });
});

describe("invariants — I3 & I4: autonomous repair vs terminal failure (golden-execution-failed)", () => {
  it("I3. autonomous repair never raises human attention", () => {
    const fx = goldenExecutionFailed;
    const repairSeq = fx.events.find((e) => e.type === "node.repair.started")!.seq;
    const model = reduceUpToSeq(fx, repairSeq);
    const view = selectWorkspaceView(model);
    expect(view.frame.attention).toEqual([]);
    expect(view.mode).not.toBe("reconciliation");
  });

  it("I4. a terminal failure focuses as 'failed' (never done/obsolete) and health is 'failing'", () => {
    const model = reduceUpToSeq(goldenExecutionFailed, goldenExecutionFailed.events.length);
    const view = selectWorkspaceView(model);
    expect(view.health).toBe("failing");
    const focus = buildFocusView(model, { kind: "node", id: "n-validate" });
    if (focus.kind !== "node") throw new Error("expected node focus");
    expect(focus.display).toBe("failed");
    expect(focus.display).not.toBe("done");
    expect(focus.display).not.toBe("obsolete");
    expect(focus.freshness).toBe("fresh");
    expect(focus.vital.status).toBe("failed");
    // A failed run never reaches Disposition: evidence focus degrades safely.
    expect(buildFocusView(model, EVIDENCE_FOCUS_TARGET).kind).toBe("missing");
  });
});

describe("invariants — I5: projections never mutate the model", () => {
  it.each(ALL)("%s — proto/workspace/focus leave the model untouched", (_name, fx) => {
    const model = reduceUpToSeq(fx, fx.events.length);
    const before = snapshot(model);
    selectProtoView(model);
    selectWorkspaceView(model);
    const targets: FocusTarget[] = [
      ...[...model.nodes.keys()].map((id) => ({ kind: "node", id }) as FocusTarget),
      ...[...model.seams.keys()].map((id) => ({ kind: "seam", id }) as FocusTarget),
      ...[...model.conflicts.keys()].map((id) => ({ kind: "conflict", id }) as FocusTarget),
      ...[...model.decisions.keys()].map((id) => ({ kind: "decision", id }) as FocusTarget),
      EVIDENCE_FOCUS_TARGET
    ];
    for (const t of targets) buildFocusView(model, t);
    expect(snapshot(model)).toBe(before);
  });
});

describe("invariants — I6: focusing any object at any cut never throws", () => {
  it.each(ALL)("%s — every kind resolves to a view (real or missing) without throwing", (_name, fx) => {
    for (const seq of cutsOf(fx)) {
      const model = reduceUpToSeq(fx, seq);
      const kinds = ["node", "seam", "conflict", "decision", "evidence"] as const;
      for (const kind of kinds) {
        // a definitely-absent id → safe missing
        expect(() => buildFocusView(model, { kind, id: "__nope__" })).not.toThrow();
      }
      // and every real entity present at this cut
      for (const id of model.nodes.keys()) expect(buildFocusView(model, { kind: "node", id }).kind).not.toBe("missing");
      for (const id of model.seams.keys()) expect(buildFocusView(model, { kind: "seam", id }).kind).not.toBe("missing");
      for (const id of model.conflicts.keys()) expect(buildFocusView(model, { kind: "conflict", id }).kind).not.toBe("missing");
      for (const id of model.decisions.keys()) expect(buildFocusView(model, { kind: "decision", id }).kind).not.toBe("missing");
    }
  });
});
