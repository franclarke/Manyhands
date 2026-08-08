import { describe, expect, it } from "vitest";

import { RunEventSchema, observeRunParallelism, type RunEvent } from "@manyhands/run-coordinator";

/**
 * Stage 7 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md` measures
 * "parallelism available against parallelism executed". Nothing derived it, so
 * this is the instrument, and it is written BEFORE the series is frozen: a
 * derivation authored after seeing the runs is a derivation fitted to them.
 *
 * The question it answers is the one the redesign put at stake. If availability
 * never exceeds what ran, the decomposition is what limited the run — the graph
 * had no independent work to offer. If it does exceed it, the cap did, and the
 * limit is a configured number rather than a property of the plan. Those two
 * adverse results have different causes and must not be reported as one.
 */

let sequence = 0;
const event = (type: string, payload: Record<string, unknown>): RunEvent =>
  RunEventSchema.parse({
    eventId: `e${++sequence}`,
    runId: "run-1",
    sequence,
    occurredAt: `2026-08-07T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    type,
    payload
  });

const explanation = (nodeId: string, ready: boolean, deferred?: boolean) => ({
  nodeId,
  ready,
  reasons: ready ? [] : [{ code: "missing_artifact" }],
  ...(deferred !== undefined ? { deferred } : {})
});

const observed = (input: {
  readyNodeIds: string[];
  explanations: Array<ReturnType<typeof explanation>>;
  maxParallel?: number;
}): RunEvent =>
  event("readiness.observed", {
    readyNodeIds: input.readyNodeIds,
    pendingDecisionIds: [],
    explanations: input.explanations,
    effectiveConfig: { maxParallel: input.maxParallel ?? 4 }
  });

const started = (attemptId: string, nodeId: string): RunEvent =>
  event("attempt.started", {
    attemptId,
    nodeId,
    inputFingerprint: "fp-1",
    executorProfile: { id: "executor", revision: "1" }
  });

const finished = (attemptId: string, nodeId: string): RunEvent =>
  event("attempt.candidate_created", {
    attemptId,
    nodeId,
    candidateCommit: "c".repeat(40),
    outputDigest: "sha256:digest",
    changedFiles: ["src/a.ts"]
  });

describe("parallelism available against parallelism executed", () => {
  it("counts what could have run alongside what was already running", () => {
    const summary = observeRunParallelism([
      observed({ readyNodeIds: ["a", "b"], explanations: [explanation("a", true), explanation("b", true), explanation("c", false)] })
    ]);

    expect(summary.observations).toHaveLength(1);
    expect(summary.observations[0]).toMatchObject({ running: 0, eligible: 2, available: 2, executed: 2 });
  });

  /**
   * An attempt is running from `attempt.started` until it produces a candidate,
   * fails, is discarded or goes stale. Reading concurrency from the scheduler's
   * `activeResourceNodeIds` instead would be wrong: that set is a union that
   * also carries externally held resources, which are not work in flight.
   */
  it("carries the attempts still in flight into the next observation", () => {
    const summary = observeRunParallelism([
      observed({ readyNodeIds: ["a"], explanations: [explanation("a", true)] }),
      started("attempt-a", "a"),
      observed({ readyNodeIds: ["b"], explanations: [explanation("a", false), explanation("b", true)] })
    ]);

    expect(summary.observations[1]).toMatchObject({ running: 1, eligible: 1, available: 2, executed: 2 });
  });

  it("stops counting an attempt once it settles", () => {
    const summary = observeRunParallelism([
      started("attempt-a", "a"),
      finished("attempt-a", "a"),
      observed({ readyNodeIds: ["b"], explanations: [explanation("b", true)] })
    ]);

    expect(summary.observations[0]!.running).toBe(0);
  });

  /**
   * A node held back by a conflict constraint is `ready` — the selector marks it
   * `deferred` after readiness is decided. It is not available parallelism: the
   * constraint says it genuinely cannot run beside what is running. Counting it
   * would overstate what the decomposition offered, which is precisely the
   * number the thesis is claiming.
   */
  it("does not count a node a conflict constraint deferred", () => {
    const summary = observeRunParallelism([
      observed({ readyNodeIds: ["a"], explanations: [explanation("a", true), explanation("b", true, true)] })
    ]);

    expect(summary.observations[0]).toMatchObject({ eligible: 1, available: 1 });
  });

  /**
   * The distinction the stage exists to make. Six nodes eligible under a cap of
   * two is a graph that offered parallelism the configuration refused.
   */
  it("names the cap as the limit when more was eligible than could be dispatched", () => {
    const summary = observeRunParallelism([
      observed({
        readyNodeIds: ["a", "b"],
        explanations: ["a", "b", "c", "d", "e", "f"].map((nodeId) => explanation(nodeId, true)),
        maxParallel: 2
      })
    ]);

    expect(summary.observations[0]).toMatchObject({ available: 6, executed: 2, capBinding: true });
    expect(summary.capBindingObservations).toBe(1);
    expect(summary.maxParallel).toBe(2);
  });

  it("does not blame the cap when the graph offered no more work", () => {
    const summary = observeRunParallelism([
      observed({ readyNodeIds: ["a"], explanations: [explanation("a", true), explanation("b", false)], maxParallel: 4 })
    ]);

    expect(summary.observations[0]!.capBinding).toBe(false);
    expect(summary.capBindingObservations).toBe(0);
  });

  it("reports the peak of each across the whole run", () => {
    const summary = observeRunParallelism([
      observed({ readyNodeIds: ["a", "b"], explanations: [explanation("a", true), explanation("b", true), explanation("c", true), explanation("d", true)], maxParallel: 2 }),
      started("attempt-a", "a"),
      started("attempt-b", "b"),
      observed({ readyNodeIds: [], explanations: [explanation("c", false), explanation("d", false)], maxParallel: 2 })
    ]);

    expect(summary.peakAvailable).toBe(4);
    expect(summary.peakExecuted).toBe(2);
  });

  /**
   * A run whose journal carries no explanations cannot answer the question. It
   * must say so rather than report zero — a measurement that reads "no
   * parallelism was available" when it means "nothing was recorded" is the same
   * class of error as a `verified` with no evidence.
   */
  it("refuses to report availability it never observed", () => {
    const summary = observeRunParallelism([
      event("readiness.observed", { readyNodeIds: ["a"], pendingDecisionIds: [] })
    ]);

    expect(summary.observations).toHaveLength(0);
    expect(summary.unobservedReadinessCount).toBe(1);
    expect(summary.peakAvailable).toBeUndefined();
  });

  it("is empty, not zero, for a run that never scheduled anything", () => {
    const summary = observeRunParallelism([]);

    expect(summary.observations).toEqual([]);
    expect(summary.peakAvailable).toBeUndefined();
    expect(summary.peakExecuted).toBeUndefined();
    expect(summary.maxParallel).toBeUndefined();
  });
});
