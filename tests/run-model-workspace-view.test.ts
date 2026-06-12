/**
 * PR 08 — workspace surface view-model tests (pure, node environment).
 *
 * `selectWorkspaceView` is the phase-adaptive projection the surface renders. These
 * tests assert the surface MATURES with the run (mode per phase), and that nodes /
 * seams / wavefront / conflicts / blast preview / invalidation / evidence project
 * correctly — including the invariant that a stale node never renders "done".
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  goldenBehavioralConflict,
  goldenExecutionFailed,
  goldenHappyPath,
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

// ── gated vital (execution gate pauses must not paint "Reparando") ──────────────

describe("workspace-view — gated node vital", () => {
  function gatedModel(): RunModel {
    return reduceRunEvents(initialFor("run-gated"), [
      {
        runId: "run-gated",
        actor: "system",
        seq: 1,
        at: "2026-06-12T00:00:00.000Z",
        type: "node.verify.iteration",
        // build:fail mid-repair — without the gate this paints "Reparando automáticamente".
        payload: { nodeId: "build-ui", iteration: 1, maxIterations: 3, build: "fail", testsPass: 0, testsTotal: 1 }
      },
      {
        runId: "run-gated",
        actor: "system",
        seq: 2,
        at: "2026-06-12T00:00:01.000Z",
        type: "decision.raised",
        payload: {
          decisionId: "clarify:build-ui",
          kind: "clarify",
          blocking: true,
          context: {
            nodeIds: ["build-ui"],
            question: "¿Cómo querés continuar?",
            options: ["Aceptar conflicto y continuar", "Abortar run"],
            gate: "merge_conflict"
          }
        }
      }
    ]);
  }

  it("paints 'Esperando decisión' instead of 'Reparando automáticamente' while gated", () => {
    const view = selectWorkspaceView(gatedModel());
    const node = view.nodes.find((n) => n.id === "build-ui")!;
    expect(node.vital.status).toBe("gated");
    expect(node.vital.label).toBe("Esperando decisión");
    expect(node.vital.repairActive).toBe(false);
    expect(node.vital.detail).toContain("esperando decisión");
  });
});

// ── golden-happy-path phases ────────────────────────────────────────────────────

describe("workspace-view — golden-happy-path", () => {
  it("1. proposal: nodes as hypothesis, draft seam, approve_plan pending", () => {
    const m = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "decision.raised" && pl(e).kind === "approve_plan"));
    const view = selectWorkspaceView(m);
    expect(view.mode).toBe("proposal");
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.seams.some((s) => s.state === "draft")).toBe(true);
    expect(view.frame.attention.some((a) => a.kind === "approve_plan")).toBe(true);
    expect(view.emphasis.showApprovePlanCallout).toBe(true);
  });

  it("2. foundation: seam frozen and the wave is planned", () => {
    const m = reduceUpToSeq(goldenHappyPath, seqOf(goldenHappyPath, (e) => e.type === "wave.planned"));
    const view = selectWorkspaceView(m);
    expect(view.mode).toBe("foundation");
    expect(view.seams.find((s) => s.id === "seam-counter")!.state).toBe("frozen");
    expect(view.waves.some((w) => w.id === "w1")).toBe(true);
  });

  it("3. supervision: wavefront highlights the active nodes, health working", () => {
    const m = reduceUpToSeq(goldenHappyPath, lastSeqOf(goldenHappyPath, (e) => e.type === "node.execution.started"));
    const view = selectWorkspaceView(m);
    expect(view.mode).toBe("supervision");
    expect(view.health).toBe("working");
    expect(view.wavefront).toEqual(["n-logic", "n-store", "n-ui"]);
    for (const id of ["n-logic", "n-store", "n-ui"]) {
      expect(view.nodes.find((n) => n.id === id)!.isInWavefront).toBe(true);
    }
    expect(view.emphasis.showWavefront).toBe(true);
  });
});

// ── golden-verify-auto-repair ────────────────────────────────────────────────────

describe("workspace-view — golden-verify-auto-repair", () => {
  it("4. autonomous repair stays supervision/working (never attention/reconciliation)", () => {
    const m = reduceUpToSeq(goldenVerifyAutoRepair, seqOf(goldenVerifyAutoRepair, (e) => e.type === "node.repair.started"));
    const view = selectWorkspaceView(m);
    const email = view.nodes.find((n) => n.id === "n-email")!;
    expect(["running", "verifying"]).toContain(email.display);
    expect(view.frame.attention).toEqual([]);
    expect(view.mode).toBe("supervision");
    expect(view.mode).not.toBe("reconciliation");
  });
});

// ── golden-behavioral-conflict ────────────────────────────────────────────────────

describe("workspace-view — golden-behavioral-conflict", () => {
  it("5. reconciliation: behavioral conflict active, involved nodes flagged, gate in attention", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict"));
    const view = selectWorkspaceView(m);
    expect(view.mode).toBe("reconciliation");
    expect(view.conflicts.some((c) => c.dimension === "behavioral")).toBe(true);
    expect(view.nodes.find((n) => n.id === "n-store")!.hasActiveConflict).toBe(true);
    expect(view.nodes.find((n) => n.id === "n-ui")!.hasActiveConflict).toBe(true);
    expect(view.frame.attention.some((a) => a.kind === "resolve_conflict")).toBe(true);
    expect(view.emphasis.showConflicts).toBe(true);
  });

  it("6. a CONTRACT amendment marks the seam amended without invalidating consumers", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "seam.amended"));
    const view = selectWorkspaceView(m);
    const seam = view.seams.find((s) => s.id === "seam-store")!;
    expect(seam.state).toBe("amended");
    expect(seam.lastChangeKind).toBe("contract");
    expect(view.invalidatedNodes).toEqual([]);
  });
});

// ── golden-seam-amendment-blast-radius ────────────────────────────────────────────

describe("workspace-view — golden-seam-amendment-blast-radius", () => {
  const fx = goldenSeamAmendmentBlastRadius;

  it("7. amendment.proposed shows a blast preview without realized invalidation", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "amendment.proposed"));
    const view = selectWorkspaceView(m);
    expect(view.affectedByPendingAmendment.sort()).toEqual(["c-results", "n-api", "n-search", "n-ui", "root"]);
    expect(view.invalidatedNodes).toEqual([]);
    expect(view.blastPreview.active).toBe(true);
  });

  it("8. seam.amended (signature) invalidates affected consumers; independent stays; stale ≠ done", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "seam.amended"));
    const view = selectWorkspaceView(m);
    expect(view.invalidatedNodes).toEqual(expect.arrayContaining(["n-api", "n-ui", "c-results", "root"]));
    expect(view.invalidatedNodes).not.toContain("n-telemetry");
    const nApi = view.nodes.find((n) => n.id === "n-api")!;
    expect(nApi.display).toBe("obsolete");
    expect(nApi.display).not.toBe("done");
    expect(view.blastPreview.active).toBe(false); // realized, not a preview anymore
  });

  it("9. at the end: nothing stale, independent node done, evidence trace, disposition", () => {
    const view = selectWorkspaceView(reduceFixture(fx));
    expect(view.invalidatedNodes).toEqual([]);
    expect(view.nodes.find((n) => n.id === "n-telemetry")!.display).toBe("done");
    expect(view.evidence?.invalidationTrace?.[0]?.preserved).toEqual(["n-telemetry"]);
    expect(view.mode).toBe("disposition");
    expect(view.emphasis.showEvidenceProtagonist).toBe(true);
  });
});

// ── invariant ─────────────────────────────────────────────────────────────────────

describe("workspace-view — invariant", () => {
  it.each(ALL)("10. %s never renders a stale node as 'done'", (_name, fixture) => {
    const view = selectWorkspaceView(reduceFixture(fixture));
    for (const node of view.nodes) {
      if (node.freshness === "stale") expect(node.display).not.toBe("done");
    }
  });

  it("10b. mid blast-radius (stale present) still never renders 'done'", () => {
    const m = reduceUpToSeq(goldenSeamAmendmentBlastRadius, seqOf(goldenSeamAmendmentBlastRadius, (e) => e.type === "seam.amended"));
    const view = selectWorkspaceView(m);
    const stale = view.nodes.filter((n) => n.freshness === "stale");
    expect(stale.length).toBeGreaterThan(0);
    for (const node of stale) expect(node.display).not.toBe("done");
  });
});

// ── golden-execution-failed (PR-U1 hardening, H4) ─────────────────────────────────

describe("workspace-view — golden-execution-failed", () => {
  it("11. terminal failure: failed node, health failing, sibling done, no human attention", () => {
    const view = selectWorkspaceView(reduceFixture(goldenExecutionFailed));
    expect(view.health).toBe("failing");
    const validate = view.nodes.find((n) => n.id === "n-validate")!;
    expect(validate.display).toBe("failed");
    expect(validate.vital.status).toBe("failed");
    expect(view.nodes.find((n) => n.id === "n-parse")!.display).toBe("done");
    // Autonomous repair (node.repair.started) never escalates to the human.
    expect(view.frame.attention).toEqual([]);
    // A failed run never reaches Disposition: no evidence protagonist.
    expect(view.evidence).toBeNull();
    expect(view.emphasis.showEvidenceProtagonist).toBe(false);
  });

  it("11b. while autonomously repairing, the failing leaf stays supervision/working (not attention)", () => {
    const m = reduceUpToSeq(goldenExecutionFailed, seqOf(goldenExecutionFailed, (e) => e.type === "node.repair.started"));
    const view = selectWorkspaceView(m);
    const validate = view.nodes.find((n) => n.id === "n-validate")!;
    expect(["running", "verifying"]).toContain(validate.display);
    expect(view.mode).toBe("supervision");
    expect(view.frame.attention).toEqual([]);
  });
});
