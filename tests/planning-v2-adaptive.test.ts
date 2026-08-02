import { ADAPTIVE_UTILITY_POLICY_VERSION, PILOT_UTILITY_POLICY, createPlanningEnvelope } from "@manyhands/decomposer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileGraphRevision, type GraphCompilerInput } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingCandidate, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
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
      planCandidates: async (_input, envelope) => [1, 2, 3].map((index) => bookingCandidate(envelope, `candidate-${index}`)),
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-23T01:00:00.000Z"
    });

    expect(result.failureReason).toBeUndefined();
    expect(result.lifecycle).toBe("needs_approval");

    // 1. The event is persisted in the canonical journal.
    const persisted = await events.load("run-adaptive");
    const types = persisted.map((event) => event.type);
    expect(types).toContain("planning.candidates_evaluated");
    expect(types.indexOf("planning.candidates_evaluated")).toBeLessThan(types.indexOf("planning.completed"));
    expect(types.indexOf("planning.candidates_evaluated")).toBeLessThan(types.indexOf("graph.compiled"));

    // 2. The Graph Compiler consumed the selected breakdown (same canonical
    //    WorkUnit tree type — no parallel model).
    expect(compile).toHaveBeenCalledTimes(1);
    const compiledBreakdown = compile.mock.calls[0]![0].breakdown;
    expect(compiledBreakdown.root.key).toBe("booking");
    expect(compile.mock.calls[0]![0]).toMatchObject({
      planningEnvelope: expect.objectContaining({ repositorySnapshotId: bookingSnapshot().snapshotId }),
      candidatePlan: expect.objectContaining({
        candidateId: expect.any(String),
        acceptanceOwnership: expect.any(Array),
        seamSpecifications: expect.any(Array),
        contractObligations: expect.any(Array),
        leafValidations: expect.any(Array)
      })
    });

    // 3. Replay from the journal reconstructs the strategy and candidate tree.
    const replayed = foldRun(persisted);
    expect(replayed.planningCandidates?.policy?.version).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(replayed.planningCandidates?.policy?.condition).toBe("C");

    // 4. The snapshot projection carries the same explanation (UI surface).
    const snapshotState = await snapshots.loadOrRebuild("run-adaptive", authority);
    expect(snapshotState.planningCandidates?.policy?.condition).toBe("C");

    // 5. The structural thesis metrics are persisted as a diagnostic artifact
    //    keyed by run, without governing lifecycle.
    const metricsRaw = await readFile(path.join(directory, "run-adaptive.granularity-metrics.json"), "utf8");
    const metrics = JSON.parse(metricsRaw) as Record<string, unknown>;
    expect(metrics.runId).toBe("run-adaptive");
    expect(metrics.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(metrics.condition).toBe("C");
    expect((metrics.metrics as Record<string, unknown>).totalLeafCount).toBe(3);
  });

  it("records bounded replan without calling the LLM again when every candidate exceeds the measured context budget", async () => {
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
    const plan = vi.fn(async () => semanticSplit);
    const planCandidates = vi.fn(async (_input, envelope) => [1, 2, 3].map((index) =>
      bookingCandidate(envelope, `oversized-${index}`, structuredClone(firstCandidate))
    ));

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
      planCandidates,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-24T01:00:00.000Z"
    });

    expect(result.failureReason).toBeUndefined();
    expect(result.lifecycle).toBe("planning");
    expect(plan).not.toHaveBeenCalled();
    expect(planCandidates).toHaveBeenCalledOnce();
    expect(result.planningCandidates?.selection).toMatchObject({
      kind: "replan_required",
      reason: expect.stringContaining("did not contain enough")
    });
    await runPlanningV2({
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
      planCandidates,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-24T01:00:00.000Z"
    });
    expect(planCandidates).toHaveBeenCalledOnce();
  });

  it("replays A, B and C over identical frozen typed candidates without invoking the planner", async () => {
    const goal = "Build booking";
    const frozenEnvelope = createPlanningEnvelope({
      policyVersion: PILOT_UTILITY_POLICY.policyVersion,
      goal,
      repositorySnapshot: bookingSnapshot(),
      maxLeafContextTokens: PILOT_UTILITY_POLICY.maxLeafContextTokens,
      maxLeafScopePaths: PILOT_UTILITY_POLICY.maxLeafScopePaths
    });
    const frozenCandidates = [1, 2, 3].map((index) => bookingCandidate(frozenEnvelope, `frozen-${index}`));
    const planCandidates = vi.fn(async () => { throw new Error("Frozen replay must not invoke the planner."); });
    const hashesByCondition: string[][] = [];

    for (const condition of ["A", "B", "C"] as const) {
      const events = new JsonlRunEventStore({ directory });
      const snapshots = new RunSnapshotStore({ directory, events });
      const runId = `frozen-${condition}`;
      const result = await runPlanningV2({
        runId,
        goal,
        repoPath: "C:/repo/booking",
        targetFingerprint: "target-1",
        baseCommit: "1".repeat(40),
        authority,
        granularityCondition: condition,
        frozenCandidates
      }, {
        events,
        snapshots,
        inspect: async () => bookingSnapshot(),
        plan: async () => bookingBreakdown(),
        planCandidates,
        compile: (input) => compileGraphRevision(input, compilerDependencies),
        now: () => "2026-07-24T01:00:00.000Z"
      });
      expect(result.lifecycle).toBe("needs_approval");
      expect(result.planningCandidates?.policy?.condition).toBe(condition);
      hashesByCondition.push(result.planningCandidates!.candidates.map((candidate) => candidate.candidateHash));
    }

    expect(planCandidates).not.toHaveBeenCalled();
    expect(hashesByCondition[1]).toEqual(hashesByCondition[0]);
    expect(hashesByCondition[2]).toEqual(hashesByCondition[0]);
  });
});
