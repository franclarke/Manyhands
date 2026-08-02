import { ADAPTIVE_UTILITY_POLICY_VERSION } from "@manyhands/decomposer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileGraphRevision, type GraphCompilerInput } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

/**
 * Vertical slice for gate G3: the productive planning pipeline must invoke the
 * adaptive C policy between the semantic Planner and the Graph Compiler,
 * persist the candidate tree as a domain event, and survive replay.
 */

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-adaptive-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("adaptive granularity in the productive planning pipeline", () => {
  it("persists C's candidate tree between plan() and compile(), and replay explains the strategy", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const compile = vi.fn((input: GraphCompilerInput) => compileGraphRevision(input, compilerDependencies));

    const result = await runPlanningV2({
      runId: "run-adaptive",
      goal: "Build booking",
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority,
      granularityCondition: "C"
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-23T01:00:00.000Z"
    });

    expect(result.failureReason).toBeUndefined();
    expect(result.lifecycle).toBe("needs_approval");

    // 1. The event is persisted in the canonical journal.
    const persisted = await events.load("run-adaptive");
    const types = persisted.map((event) => event.type);
    expect(types).toContain("planning.granularity_strategy_selected");
    expect(types.indexOf("planning.granularity_strategy_selected")).toBeLessThan(types.indexOf("planning.completed"));
    expect(types.indexOf("planning.granularity_strategy_selected")).toBeLessThan(types.indexOf("graph.compiled"));
    const strategyEvent = persisted.find((event) => event.type === "planning.granularity_strategy_selected");
    expect(strategyEvent?.type === "planning.granularity_strategy_selected" ? strategyEvent.payload.candidateTree?.root : undefined).toBeDefined();

    // 2. The Graph Compiler consumed the selected breakdown (same canonical
    //    WorkUnit tree type — no parallel model).
    expect(compile).toHaveBeenCalledTimes(1);
    const compiledBreakdown = compile.mock.calls[0]![0].breakdown;
    expect(compiledBreakdown.root.key).toBe("booking");

    // 3. Replay from the journal reconstructs the strategy and candidate tree.
    const replayed = foldRun(persisted);
    expect(replayed.granularityStrategy?.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(replayed.granularityStrategy?.condition).toBe("C");

    // 4. The snapshot projection carries the same explanation (UI surface).
    const snapshotState = await snapshots.loadOrRebuild("run-adaptive", authority);
    expect(snapshotState.granularityStrategy?.condition).toBe("C");

    // 5. The structural thesis metrics are persisted as a diagnostic artifact
    //    keyed by run, without governing lifecycle.
    const metricsRaw = await readFile(path.join(directory, "run-adaptive.granularity-metrics.json"), "utf8");
    const metrics = JSON.parse(metricsRaw) as Record<string, unknown>;
    expect(metrics.runId).toBe("run-adaptive");
    expect(metrics.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(metrics.condition).toBe("C");
    expect((metrics.metrics as Record<string, unknown>).totalLeafCount).toBe(3);
  });

  it("selects a compiler-valid semantic candidate instead of failing on the first proposal", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const rejected = planningCandidate("candidate-rejected");
    const viable = planningCandidate("candidate-viable");
    const plan = vi.fn(async () => {
      throw new Error("single-candidate planning should not run when planCandidates is available");
    });
    const planCandidates = vi.fn(async () => [rejected, viable]);
    const compile = vi.fn((input: GraphCompilerInput) => {
      if (input.breakdown.breakdownId === "candidate-rejected") {
        throw new Error("Compiled plan review failed: contested_planned_output");
      }
      return compileGraphRevision(input, compilerDependencies);
    });

    const result = await runPlanningV2({
      runId: "run-candidate-selection",
      goal: "Build booking",
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      plan,
      planCandidates,
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-08-02T16:00:00.000Z"
    });

    expect(result.failureReason).toBeUndefined();
    expect(result.lifecycle).toBe("needs_approval");
    expect(plan).not.toHaveBeenCalled();
    expect(planCandidates).toHaveBeenCalledTimes(1);
    expect(planCandidates.mock.calls[0]?.[0].planningEnvelope).toMatchObject({
      candidateBudget: { minimum: 2, maximum: 3 },
      requirements: { requireCompilerApproval: true }
    });
    expect(compile).toHaveBeenCalledTimes(2);
    const completed = (await events.load("run-candidate-selection"))
      .find((event) => event.type === "planning.completed");
    expect(completed?.type === "planning.completed"
      ? (completed.payload.breakdown as { breakdownId?: string }).breakdownId
      : undefined).toBe("candidate-viable");
    const strategy = (await events.load("run-candidate-selection"))
      .find((event) => event.type === "planning.granularity_strategy_selected");
    expect(strategy?.type === "planning.granularity_strategy_selected"
      ? strategy.payload.candidateEvaluations
      : undefined).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: "candidate-rejected", eligible: false, score: expect.any(Number) }),
      expect.objectContaining({ candidateId: "candidate-viable", eligible: true, score: expect.any(Number) })
    ]));
    const metrics = JSON.parse(await readFile(path.join(directory, "run-candidate-selection.granularity-metrics.json"), "utf8")) as Record<string, unknown>;
    expect(metrics.candidateEvaluations).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: "candidate-rejected", eligible: false }),
      expect.objectContaining({ candidateId: "candidate-viable", eligible: true })
    ]));
  });

  it("performs one semantic replan when a C leaf exceeds the measured context budget", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const semanticSplit = bookingBreakdown();
    const firstCandidate = {
      ...semanticSplit,
      candidateArtifacts: [],
      candidateSeams: [],
      root: {
        key: "booking",
        kind: "leaf" as const,
        title: "Booking creation",
        objective: "Deliver booking creation",
        concerns: ["domain", "api", "ui"],
        expectedOutcomes: ["A working booking flow"],
        acceptanceIntentIds: ["domain-ready", "api-ready", "ui-ready"],
        evidenceIds: ["domain-path", "api-path", "ui-path"]
      }
    };
    const measuredSnapshot = bookingSnapshot();
    for (const file of measuredSnapshot.index?.files ?? []) {
      file.byteSize = 40_000;
      file.lineCount = 1_000;
    }
    const plan = vi.fn()
      .mockResolvedValueOnce(firstCandidate)
      .mockResolvedValueOnce(semanticSplit);

    const result = await runPlanningV2({
      runId: "run-c2-replan",
      goal: "Build booking",
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority
    }, {
      events,
      snapshots,
      inspect: async () => measuredSnapshot,
      plan,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-24T01:00:00.000Z"
    });

    expect(result.failureReason).toBeUndefined();
    expect(result.lifecycle).toBe("needs_approval");
    expect(plan).toHaveBeenCalledTimes(2);
    expect(plan.mock.calls[1]?.[0].granularityFeedback).toMatchObject({
      reason: "leaf_context_infeasible"
    });
    expect(result.granularityStrategy?.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
  });
});

function planningCandidate(breakdownId: string) {
  const breakdown = bookingBreakdown();
  breakdown.breakdownId = breakdownId;
  breakdown.acceptanceOwnership = breakdown.acceptanceIntents.map((intent) => ({
    intentId: intent.id,
    ownerUnitKey: intent.id === "domain-ready" ? "domain" : intent.id === "api-ready" ? "api" : "ui",
    role: "local",
    rationale: "The leaf owns the observable behavior."
  }));
  breakdown.seamSpecifications = [{
    seamId: "booking-shape",
    delivery: "contract_only",
    compatibility: "All participants bind the same exact contract revision.",
    validation: "Integration tests exercise producer and both consumers."
  }];
  return breakdown;
}
