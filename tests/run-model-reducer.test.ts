import { describe, expect, it } from "vitest";
import {
  createInitialRunModel,
  reduceRunEvent,
  reduceRunEvents
} from "@/lib/run-model/reducer";
import { createRunStore } from "@/lib/run-model/store";
import {
  GOLDEN_FIXTURES,
  GOLDEN_FIXTURE_NAMES,
  goldenBehavioralConflict,
  goldenHappyPath,
  goldenPlanningQuestion,
  goldenSeamAmendmentBlastRadius,
  goldenVerifyAutoRepair
} from "@/lib/run-model/fixtures";
import type {
  Amendment,
  Conflict,
  Decision,
  Node,
  RunConfig,
  RunEvent,
  RunFixture,
  RunModel,
  Seam
} from "@/lib/run-model/types";

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

const ALL: Array<[string, RunFixture]> = GOLDEN_FIXTURE_NAMES.map((name) => [name, GOLDEN_FIXTURES[name]]);

// ── General fold behavior ─────────────────────────────────────────────────────

describe("reducer — general", () => {
  it("1. createInitialRunModel is empty with cursor 0", () => {
    const m = initialFor("r");
    expect(m.cursor).toBe(0);
    expect(m.nodes.size).toBe(0);
    expect(m.seams.size).toBe(0);
    expect(m.waves.size).toBe(0);
    expect(m.schedulingWaves.size).toBe(0);
    expect(m.conflicts.size).toBe(0);
    expect(m.decisions.size).toBe(0);
    expect(m.amendments.size).toBe(0);
    expect(m.evidence).toBeUndefined();
  });

  it.each(ALL)("2. reduces %s without throwing", (_name, fx) => {
    expect(() => reduceFixture(fx)).not.toThrow();
  });

  it.each(ALL)("3. %s ends with cursor === last seq", (_name, fx) => {
    const m = reduceFixture(fx);
    expect(m.cursor).toBe(fx.events[fx.events.length - 1]!.seq);
  });

  it.each(ALL)("4. %s is idempotent on re-application", (_name, fx) => {
    const once = reduceFixture(fx);
    const twice = reduceRunEvents(once, fx.events);
    expect(twice).toBe(once); // every event has seq <= cursor → ignored, same ref
  });

  it("5. an unknown event type advances cursor but changes nothing else", () => {
    const base = reduceFixture(goldenHappyPath);
    const unknown: RunEvent = {
      seq: base.cursor + 1,
      at: "2026-06-05T01:00:00.000Z",
      runId: goldenHappyPath.runId,
      actor: "system",
      type: "some.future.v2.event",
      payload: { whatever: true }
    };
    const next = reduceRunEvent(base, unknown);
    expect(next.cursor).toBe(base.cursor + 1);
    expect(next.nodes.size).toBe(base.nodes.size);
    expect(next.seams.size).toBe(base.seams.size);
    expect(next.decisions.size).toBe(base.decisions.size);
    expect(next.evidence).toBe(base.evidence);
  });

  it("6. events with seq <= cursor are ignored (same reference)", () => {
    const base = reduceFixture(goldenHappyPath);
    const stale: RunEvent = { ...goldenHappyPath.events[0]!, seq: 1 };
    expect(reduceRunEvent(base, stale)).toBe(base);
  });

  it("7. node.cli.output advances the cursor without changing entity state", () => {
    const base = reduceFixture(goldenHappyPath);
    const output: RunEvent = {
      seq: base.cursor + 1,
      at: "2026-06-08T00:00:00.000Z",
      runId: goldenHappyPath.runId,
      actor: "agent",
      type: "node.cli.output",
      payload: { nodeId: "n-store", stream: "stdout", chunk: "visible output\n" }
    };
    const next = reduceRunEvent(base, output);
    expect(next.cursor).toBe(base.cursor + 1);
    expect(next.nodes).toBe(base.nodes);
    expect(next.seams).toBe(base.seams);
    expect(next.evidence).toBe(base.evidence);
  });

  it("8. run.status.changed updates run control state", () => {
    const base = initialFor("r-status");
    const paused = reduceRunEvent(base, {
      seq: 1,
      at: "2026-06-16T00:00:00.000Z",
      runId: "r-status",
      actor: "human",
      type: "run.status.changed",
      payload: {
        status: "paused",
        version: 2,
        pendingHumanAction: "none",
        updatedAt: "2026-06-16T00:00:00.000Z",
        pausedDuring: "running"
      }
    });
    expect(paused.run.control).toMatchObject({
      status: "paused",
      version: 2,
      pendingHumanAction: "none",
      pausedDuring: "running"
    });

    const running = reduceRunEvent(paused, {
      seq: 2,
      at: "2026-06-16T00:00:01.000Z",
      runId: "r-status",
      actor: "human",
      type: "run.status.changed",
      payload: {
        status: "running",
        version: 3,
        pendingHumanAction: "none",
        updatedAt: "2026-06-16T00:00:01.000Z"
      }
    });
    expect(running.run.control.status).toBe("running");
    expect(running.run.control.pausedDuring).toBeUndefined();
  });

  it("9. run.scheduling.wave_selected records the scheduling audit by wave index", () => {
    const base = initialFor("r-scheduling");
    const next = reduceRunEvent(base, {
      seq: 1,
      at: "2026-06-30T00:00:00.000Z",
      runId: "r-scheduling",
      actor: "system",
      type: "run.scheduling.wave_selected",
      payload: {
        version: 1,
        source: "run-executor",
        waveIndex: 0,
        policy: "risk_aware",
        readyTaskIds: ["task-a", "task-b"],
        selectedTaskIds: ["task-a"],
        blockedTaskIds: ["task-b"],
        blockedReasons: [
          { taskId: "task-b", reason: "overlapping scope", relatedTaskIds: ["task-a"], riskLevel: "high" }
        ],
        riskSummary: { low: 0, medium: 0, high: 1, blocking: 0 },
        fallbacks: [],
        warnings: []
      }
    });

    expect(next.cursor).toBe(1);
    expect(next.schedulingWaves.get(0)).toMatchObject({
      waveIndex: 0,
      policy: "risk_aware",
      selectedTaskIds: ["task-a"],
      blockedTaskIds: ["task-b"]
    });
    expect(next.schedulingWaves.get(0)?.blockedReasons[0]?.relatedTaskIds).toEqual(["task-a"]);
  });

  it.each(ALL)("10. %s model has no derived fields", (_name, fx) => {
    const keys = Object.keys(reduceFixture(fx));
    for (const forbidden of ["phase", "health", "wavefront", "attention", "freshness", "invalidatedNodes", "affectedByAmendment", "renderableNodeState"]) {
      expect(keys).not.toContain(forbidden);
    }
  });
});

// ── golden-happy-path ─────────────────────────────────────────────────────────

describe("reducer — golden-happy-path", () => {
  const m = reduceFixture(goldenHappyPath);

  it("has the planned nodes", () => {
    expect([...m.nodes.keys()].sort()).toEqual(["n-logic", "n-store", "n-ui", "root"]);
  });

  it("froze the seam at revision 1", () => {
    const seam = m.seams.get("seam-counter") as Seam;
    expect(seam.state).toBe("frozen");
    expect(seam.revision).toBe(1);
    expect(seam.signature.frozen).toBeDefined();
  });

  it("planned, opened and closed the wave", () => {
    const wave = m.waves.get("w1")!;
    expect(wave.nodeIds).toContain("n-store");
    expect(wave.opened).toBe(true);
    expect(wave.closed).toBe(true);
  });

  it("integrated all leaves and the root", () => {
    for (const id of ["n-store", "n-ui", "n-logic", "root"]) {
      expect((m.nodes.get(id) as Node).execution.kind).toBe("integrated");
    }
  });

  it("records builtAgainst on a leaf", () => {
    expect((m.nodes.get("n-store") as Node).builtAgainst).toEqual([{ seamId: "seam-counter", revision: 1 }]);
  });

  it("has evidence and both gates resolved", () => {
    expect(m.evidence).toBeDefined();
    expect((m.decisions.get("d-approve") as Decision).status).toBe("resolved");
    expect((m.decisions.get("d-merge") as Decision).status).toBe("resolved");
  });
});

// ── golden-planning-question ────────────────────────────────────────────────

describe("reducer — golden-planning-question", () => {
  const m = reduceFixture(goldenPlanningQuestion);

  it("has a clarify decision resolved with an answer", () => {
    const clarify = m.decisions.get("d-clarify") as Decision;
    expect(clarify.kind).toBe("clarify");
    expect(clarify.status).toBe("resolved");
    expect(clarify.resolution?.choice).toEqual({ answer: "CSV" });
  });

  it("leaves approve_plan pending", () => {
    expect((m.decisions.get("d-approve") as Decision).status).toBe("pending");
  });

  it("has no evidence and no node in execution", () => {
    expect(m.evidence).toBeUndefined();
    for (const node of m.nodes.values()) {
      expect(node.execution.kind).toBe("idle");
    }
  });
});

// ── golden-verify-auto-repair ────────────────────────────────────────────────

describe("reducer — golden-verify-auto-repair", () => {
  const m = reduceFixture(goldenVerifyAutoRepair);

  it("integrates the node after repair", () => {
    expect((m.nodes.get("n-email") as Node).execution.kind).toBe("integrated");
  });

  it("raises no decisions and detects no conflicts", () => {
    expect(m.decisions.size).toBe(0);
    expect(m.conflicts.size).toBe(0);
  });
});

// ── golden-behavioral-conflict ────────────────────────────────────────────────

describe("reducer — golden-behavioral-conflict", () => {
  const m = reduceFixture(goldenBehavioralConflict);

  it("resolves the behavioral conflict only via conflict.resolved", () => {
    const c = m.conflicts.get("cf-unit") as Conflict;
    expect(c.dimension).toBe("behavioral");
    expect(c.status).toBe("resolved");
    expect(c.resolution?.by).toBe("human");
  });

  it("has resolve_conflict resolved with a structured resolutionId", () => {
    const d = m.decisions.get("d-conflict") as Decision;
    expect(d.kind).toBe("resolve_conflict");
    expect(d.status).toBe("resolved");
    expect(d.resolution?.choice).toEqual({ resolutionId: "canonical-ms-fix-store" });
  });

  it("amends the seam contract to revision 2", () => {
    const seam = m.seams.get("seam-store") as Seam;
    expect(seam.revision).toBe(2);
    expect(seam.state).toBe("amended");
    expect(seam.contract).toEqual({ "duration.unit": "ms" });
  });

  it("leaves the affected node integrated against revision 2", () => {
    const node = m.nodes.get("n-store") as Node;
    expect(node.execution.kind).toBe("integrated");
    expect(node.builtAgainst).toEqual([{ seamId: "seam-store", revision: 2 }]);
  });

  it("has evidence", () => {
    expect(m.evidence).toBeDefined();
  });

  it("does NOT resolve the conflict before conflict.resolved", () => {
    const resolvedSeq = goldenBehavioralConflict.events.find((e) => e.type === "conflict.resolved")!.seq;
    const before = reduceRunEvents(initialFor(goldenBehavioralConflict.runId), goldenBehavioralConflict.events.filter((e) => e.seq < resolvedSeq));
    expect((before.conflicts.get("cf-unit") as Conflict).status).not.toBe("resolved");
  });
});

// ── golden-seam-amendment-blast-radius ────────────────────────────────────────

describe("reducer — golden-seam-amendment-blast-radius", () => {
  const m = reduceFixture(goldenSeamAmendmentBlastRadius);

  it("has a signature amendment that ends applied", () => {
    const a = m.amendments.get("am-pag") as Amendment;
    expect(a.changeKind).toBe("signature");
    expect(a.status).toBe("applied");
  });

  it("marks the amendment proposed before amendment.applied", () => {
    const appliedSeq = goldenSeamAmendmentBlastRadius.events.find((e) => e.type === "amendment.applied")!.seq;
    const before = reduceRunEvents(initialFor(goldenSeamAmendmentBlastRadius.runId), goldenSeamAmendmentBlastRadius.events.filter((e) => e.seq < appliedSeq));
    expect((before.amendments.get("am-pag") as Amendment).status).toBe("proposed");
  });

  it("amends the seam signature to revision 2", () => {
    const seam = m.seams.get("seam-search") as Seam;
    expect(seam.revision).toBe(2);
    expect(seam.state).toBe("amended");
    expect(seam.signature.frozen).toContain("nextCursor");
  });

  it("re-executes the affected consumers against revision 2", () => {
    for (const id of ["n-api", "n-ui"]) {
      const node = m.nodes.get(id) as Node;
      expect(node.execution.kind).toBe("integrated");
      expect(node.builtAgainst).toEqual([{ seamId: "seam-search", revision: 2 }]);
    }
  });

  it("never re-executes the unaffected node (commit unchanged)", () => {
    const telemetry = m.nodes.get("n-telemetry") as Node;
    expect(telemetry.execution).toEqual({ kind: "integrated", commit: "p3" });
    expect(telemetry.builtAgainst).toEqual([]);
  });

  it("has evidence with an invalidationTrace", () => {
    expect(m.evidence?.invalidationTrace?.[0]?.preserved).toEqual(["n-telemetry"]);
  });
});

// ── store (minimal) ───────────────────────────────────────────────────────────

describe("run store", () => {
  it("applies events and notifies subscribers only on change", () => {
    const store = createRunStore(initialFor(goldenHappyPath.runId));
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });

    store.applyMany(goldenHappyPath.events);
    expect(store.getSnapshot().cursor).toBe(goldenHappyPath.events[goldenHappyPath.events.length - 1]!.seq);
    expect(notifications).toBe(1); // applyMany emits once

    const before = store.getSnapshot();
    store.applyMany(goldenHappyPath.events); // all stale → no change
    expect(store.getSnapshot()).toBe(before);
    expect(notifications).toBe(1);

    unsubscribe();
  });
});
