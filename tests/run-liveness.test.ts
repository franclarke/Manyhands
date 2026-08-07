import { describe, expect, it } from "vitest";

import { RUN_LIVENESS_VERDICTS, classifyRunLiveness } from "@/lib/server/runs/liveness";
import { RUN_STATUS_VALUES } from "@/lib/server/runs/schema";

/**
 * Stage 5 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * Today a run whose owner dies stays `running` forever unless something else
 * tries to claim it: the product depends on the experiment driver to notice,
 * which is backwards — the harness cannot be what keeps the product from
 * hanging. This is the decision the product makes for itself.
 *
 * The one thing it must never do is declare a run dead while its executor is
 * alive. A silent-but-present owner is a different verdict from an absent one,
 * and only the absent one is terminal.
 */

const MINUTE = 60_000;
const NOW = "2026-08-07T12:00:00.000Z";

function at(minutesAgo: number): string {
  return new Date(Date.parse(NOW) - minutesAgo * MINUTE).toISOString();
}

function input(overrides: Partial<Parameters<typeof classifyRunLiveness>[0]> = {}) {
  return {
    lifecycle: "running" as const,
    activeOperation: { operationId: "op-1", heartbeatAt: at(1) },
    ownerProcessPresent: true,
    staleAfterMs: 10 * MINUTE,
    now: NOW,
    ...overrides
  };
}

describe("run liveness", () => {
  it("leaves a run alone while its heartbeat is fresh", () => {
    expect(classifyRunLiveness(input()).kind).toBe("alive");
  });

  it("leaves a terminal run alone, whatever its heartbeat says", () => {
    for (const lifecycle of ["completed", "failed", "interrupted"] as const) {
      expect(classifyRunLiveness(input({ lifecycle, activeOperation: { operationId: "op-1", heartbeatAt: at(90) } })).kind)
        .toBe("terminal");
    }
  });

  /**
   * The case the stage exists for: heartbeat expired AND no process behind it.
   * Both halves are required, and the verdict carries how long it had been
   * silent so the recorded reason is attributable rather than "it stopped".
   */
  it("declares an abandoned run terminal when the heartbeat expired and the owner is gone", () => {
    const verdict = classifyRunLiveness(input({
      activeOperation: { operationId: "op-1", heartbeatAt: at(30) },
      ownerProcessPresent: false
    }));

    expect(verdict.kind).toBe("owner_absent");
    expect(verdict.kind === "owner_absent" && verdict.silentForMs).toBe(30 * MINUTE);
    expect(verdict.kind === "owner_absent" && verdict.operationId).toBe("op-1");
  });

  /**
   * Invariant 8: no false certainty. A busy executor that has not written a
   * heartbeat is still doing work, and killing its run would destroy it. This
   * is reportable, never terminal.
   */
  it("refuses to declare a run dead while its owner process is still alive", () => {
    const verdict = classifyRunLiveness(input({
      activeOperation: { operationId: "op-1", heartbeatAt: at(30) },
      ownerProcessPresent: true
    }));

    expect(verdict.kind).toBe("owner_silent");
    expect(verdict.kind === "owner_silent" && verdict.silentForMs).toBe(30 * MINUTE);
  });

  /**
   * A run that should be working and holds no operation was abandoned between
   * releasing one and claiming the next. There is no heartbeat to age, so
   * staleness cannot be the test — the absence of an owner is the whole fact.
   */
  it("declares a working run with no owner abandoned", () => {
    for (const lifecycle of ["planning", "running", "cancelling", "delivering"] as const) {
      expect(classifyRunLiveness(input({ lifecycle, activeOperation: undefined })))
        .toMatchObject({ kind: "unowned" });
    }
  });

  /**
   * A parked run has no owner BY DESIGN: it is waiting for a human, and nobody
   * is meant to be holding it. Reading that as abandonment would end exactly
   * the runs that are behaving correctly — the most expensive possible false
   * positive, since it destroys work that was only waiting to be approved.
   */
  it("leaves a run parked for a human alone, owner or not", () => {
    for (const lifecycle of ["needs_approval", "waiting_for_input", "paused", "result_ready"] as const) {
      expect(classifyRunLiveness(input({ lifecycle, activeOperation: undefined })).kind).toBe("parked");
      expect(classifyRunLiveness(input({
        lifecycle,
        activeOperation: { operationId: "op-1", heartbeatAt: at(90) },
        ownerProcessPresent: false
      })).kind).toBe("parked");
    }
  });

  it("treats a missing heartbeat on a live operation as silence, not as freshness", () => {
    const verdict = classifyRunLiveness(input({
      activeOperation: { operationId: "op-1" },
      ownerProcessPresent: false
    }));

    expect(verdict.kind).toBe("owner_absent");
  });

  /**
   * A closed taxonomy is the point: every verdict maps to exactly one recorded
   * outcome, so nothing can land in a generic bucket.
   */
  it("has a closed set of verdicts, each with a defined disposition", () => {
    expect([...RUN_LIVENESS_VERDICTS].sort())
      .toEqual(["alive", "owner_absent", "owner_silent", "parked", "terminal", "unowned"]);
  });

  /**
   * Totality, checked against the lifecycle enum itself rather than a list
   * copied beside it. A lifecycle added later defaults to "should be working",
   * so without this a new parked-by-design state would start being declared
   * abandoned the moment it shipped.
   */
  it("classifies every lifecycle the run coordinator can produce", () => {
    const unclassified = RUN_STATUS_VALUES.filter((lifecycle) =>
      !RUN_LIVENESS_VERDICTS.includes(classifyRunLiveness(input({ lifecycle, activeOperation: undefined })).kind));

    expect(unclassified).toEqual([]);
    // And each one lands somewhere deliberate: nothing is left holding the
    // default just because nobody thought about it.
    const byLifecycle = Object.fromEntries(RUN_STATUS_VALUES.map((lifecycle) =>
      [lifecycle, classifyRunLiveness(input({ lifecycle, activeOperation: undefined })).kind]));
    expect(byLifecycle).toEqual({
      planning: "unowned",
      needs_approval: "parked",
      running: "unowned",
      waiting_for_input: "parked",
      paused: "parked",
      cancelling: "unowned",
      interrupted: "terminal",
      result_ready: "parked",
      delivering: "unowned",
      completed: "terminal",
      failed: "terminal"
    });
  });

  it("refuses a clock that runs backwards rather than reporting negative silence", () => {
    expect(() => classifyRunLiveness(input({
      activeOperation: { operationId: "op-1", heartbeatAt: "2026-08-07T13:00:00.000Z" },
      ownerProcessPresent: false
    }))).toThrow(/future/iu);
  });
});
