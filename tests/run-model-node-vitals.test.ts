/**
 * PR 09 — node vital-sign tests (pure, node environment).
 *
 * The vital sign lives in `selectWorkspaceView(...).nodes[i].vital`. These tests
 * assert each work state reads correctly (running / verifying / repairing / done /
 * obsolete / blocked / conflict / amendment), that autonomous repair never becomes
 * a failure or human attention, and the invariant that a stale node is never "done".
 */
import { describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
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
function nodeOf(view: ReturnType<typeof selectWorkspaceView>, id: string) {
  return view.nodes.find((n) => n.id === id)!;
}

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

// ── verify-loop & autonomous repair ──────────────────────────────────────────────

describe("node-vitals — verify-loop / repair", () => {
  it("1. first failing verify shows a failed build/test summary, no human attention", () => {
    const m = reduceUpToSeq(goldenVerifyAutoRepair, seqOf(goldenVerifyAutoRepair, (e) => e.type === "node.verify.iteration" && pl(e).build === "fail"));
    const view = selectWorkspaceView(m);
    const email = nodeOf(view, "n-email");
    expect(email.vital.buildStatus).toBe("fail");
    expect(email.vital.testProgress).toEqual({ pass: 0, total: 2 });
    expect(email.display).not.toBe("failed");
    expect(view.frame.health).not.toBe("attention");
    expect(view.frame.attention).toEqual([]);
  });

  it("2. after repair.started: repairing (not failed), no attention", () => {
    const m = reduceUpToSeq(goldenVerifyAutoRepair, seqOf(goldenVerifyAutoRepair, (e) => e.type === "node.repair.started"));
    const view = selectWorkspaceView(m);
    const email = nodeOf(view, "n-email");
    expect(email.vital.repairActive).toBe(true);
    expect(email.vital.status).toBe("repairing");
    expect(email.vital.label).toBe("Reparando automáticamente");
    expect(email.display).not.toBe("failed");
    expect(view.frame.attention).toEqual([]);
  });

  it("3. at the end: verified/done, no conflicts, no decisions", () => {
    const view = selectWorkspaceView(reduceFixture(goldenVerifyAutoRepair));
    const email = nodeOf(view, "n-email");
    expect(email.display).toBe("done");
    expect(email.vital.status).toBe("done");
    expect(view.conflicts).toEqual([]);
    expect(view.frame.attention).toEqual([]);
  });
});

// ── supervision wavefront ─────────────────────────────────────────────────────────

describe("node-vitals — supervision", () => {
  it("4. wavefront nodes are running; off-wavefront nodes are not active", () => {
    const m = reduceUpToSeq(goldenHappyPath, lastSeqOf(goldenHappyPath, (e) => e.type === "node.execution.started"));
    const view = selectWorkspaceView(m);
    for (const id of ["n-store", "n-ui", "n-logic"]) {
      const n = nodeOf(view, id);
      expect(n.isInWavefront).toBe(true);
      expect(["running", "verifying", "repairing"]).toContain(n.vital.status);
    }
    const root = nodeOf(view, "root");
    expect(root.isInWavefront).toBe(false);
    expect(root.vital.status).toBe("idle");
  });
});

// ── conflict ──────────────────────────────────────────────────────────────────────

describe("node-vitals — conflict", () => {
  it("5. involved nodes carry a behavioral conflict summary; gate in attention", () => {
    const m = reduceUpToSeq(goldenBehavioralConflict, seqOf(goldenBehavioralConflict, (e) => e.type === "decision.raised" && pl(e).kind === "resolve_conflict"));
    const view = selectWorkspaceView(m);
    expect(nodeOf(view, "n-store").hasActiveConflict).toBe(true);
    expect(nodeOf(view, "n-store").vital.conflictSummary).toBe("behavioral");
    expect(nodeOf(view, "n-ui").vital.conflictSummary).toBe("behavioral");
    expect(view.frame.attention.some((a) => a.kind === "resolve_conflict")).toBe(true);
  });
});

// ── amendment preview vs realized invalidation ────────────────────────────────────

describe("node-vitals — amendment / blast", () => {
  const fx = goldenSeamAmendmentBlastRadius;

  it("6. amendment.proposed: affected nodes flagged (preview), not obsolete, none invalidated", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "amendment.proposed"));
    const view = selectWorkspaceView(m);
    const nApi = nodeOf(view, "n-api");
    expect(nApi.isAffectedByPendingAmendment).toBe(true);
    expect(nApi.display).not.toBe("obsolete");
    expect(nApi.vital.amendmentSummary).toContain("signature");
    expect(view.invalidatedNodes).toEqual([]);
  });

  it("7. seam.amended (signature): affected → obsolete/pending-reexec; independent preserved", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "seam.amended"));
    const view = selectWorkspaceView(m);
    const nApi = nodeOf(view, "n-api");
    expect(nApi.display).toBe("obsolete");
    expect(nApi.vital.status).toBe("obsolete");
    expect(nApi.isPendingReexecution).toBe(true);
    expect(nApi.display).not.toBe("done");
    const telemetry = nodeOf(view, "n-telemetry");
    expect(telemetry.display).toBe("done");
    expect(telemetry.freshness).toBe("fresh");
  });

  it("8. during re-execution: re-running node is running and leaves pendingReexecution", () => {
    const m = reduceUpToSeq(fx, seqOf(fx, (e) => e.type === "node.execution.started" && pl(e).nodeId === "n-api" && pl(e).reason === "stale:seam-search@2"));
    const view = selectWorkspaceView(m);
    expect(nodeOf(view, "n-api").display).toBe("running");
    expect(nodeOf(view, "n-api").vital.status).toBe("running");
    expect(view.pendingReexecution).not.toContain("n-api");
    expect(view.pendingReexecution).toContain("n-ui");
  });
});

// ── invariants & copy ─────────────────────────────────────────────────────────────

describe("node-vitals — invariants", () => {
  it.each(ALL)("9. %s never reports a stale node as done", (_name, fixture) => {
    const view = selectWorkspaceView(reduceFixture(fixture));
    for (const node of view.nodes) {
      if (node.freshness === "stale") {
        expect(node.display).not.toBe("done");
        expect(node.vital.status).not.toBe("done");
      }
    }
  });

  it("10. repair / blocked / obsolete labels are all distinct from 'Falló'", () => {
    const repairing = nodeOf(
      selectWorkspaceView(reduceUpToSeq(goldenVerifyAutoRepair, seqOf(goldenVerifyAutoRepair, (e) => e.type === "node.repair.started"))),
      "n-email"
    ).vital.label;
    const blocked = nodeOf(
      selectWorkspaceView(reduceUpToSeq(goldenPlanningQuestion, seqOf(goldenPlanningQuestion, (e) => e.type === "decision.raised" && pl(e).kind === "clarify"))),
      "n-export"
    ).vital;
    const obsolete = nodeOf(
      selectWorkspaceView(reduceUpToSeq(goldenSeamAmendmentBlastRadius, seqOf(goldenSeamAmendmentBlastRadius, (e) => e.type === "seam.amended"))),
      "n-api"
    ).vital.label;

    expect(blocked.status).toBe("blocked");
    expect(blocked.label).toBe("Bloqueado");
    expect(blocked.blockedReason).toBeDefined();
    expect(new Set([repairing, blocked.label, obsolete, "Falló"]).size).toBe(4); // all four distinct
  });
});
