import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compileGraphRevision, type PlanningEnvelope, type WorkBreakdownPlannerInput } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingCandidate, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-v2-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("planning V2 vertical slice", () => {
  it("grounds the package manifest when repository scripts form part of the command surface", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    let evidence: WorkBreakdownPlannerInput["repositorySnapshot"]["evidence"] = [];
    const plan = vi.fn(async () => bookingBreakdown());
    const planCandidates = vi.fn(async (input: WorkBreakdownPlannerInput, envelope: PlanningEnvelope, count: number) => {
      evidence = input.repositorySnapshot.evidence;
      return Array.from({ length: count }, (_, index) => bookingCandidate(envelope, `candidate-${index + 1}`));
    });

    await runPlanningV2({ runId: "run-manifest-grounding", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan,
      planCandidates,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(plan).not.toHaveBeenCalled();
    expect(planCandidates).toHaveBeenCalledOnce();
    expect(planCandidates).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ candidateBudget: { minimum: 2, maximum: 3 } }),
      3,
      expect.any(Object)
    );
    expect(evidence).toContainEqual(expect.objectContaining({ kind: "path", reference: "package.json" }));
    expect(planCandidates.mock.calls[0]?.[0].granularityBrief).toMatchObject({
      candidateCount: 3,
      hardGates: ["acceptance_owner", "cross_leaf_materialization", "local_validation", "compiler_approvable"],
      repositorySignals: { snapshotId: bookingSnapshot().snapshotId }
    });
  });

  it("persists inspection, semantic planning, compilation, critics and approval decision", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const result = await runPlanningV2({ runId: "run-v2", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      planCandidates: async (_input, envelope) => candidateSet(envelope),
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(result.lifecycle).toBe("needs_approval");
    const persisted = await events.load("run-v2");
    expect(persisted.map((event) => event.type)).toEqual([
      "run.created", "repository.inspected", "planning.envelope_created", "planning.candidates_evaluated", "planning.granularity_strategy_selected", "planning.completed", "graph.compiled",
      ...Array(8).fill("planning.critic_recorded"),
      "graph.revision.proposed", "decision.raised"
    ]);
    const strategy = persisted.find((event) => event.type === "planning.granularity_strategy_selected");
    expect(strategy).toMatchObject({
      type: "planning.granularity_strategy_selected",
      payload: {
        candidateTree: {
          root: bookingBreakdown().root,
          candidateArtifacts: bookingBreakdown().candidateArtifacts,
          candidateSeams: bookingBreakdown().candidateSeams
        }
      }
    });
    const envelope = persisted.find((event) => event.type === "planning.envelope_created");
    expect(envelope).toMatchObject({
      type: "planning.envelope_created",
      payload: {
        policyVersion: expect.any(String),
        repositorySnapshotId: bookingSnapshot().snapshotId,
        candidateBudget: { minimum: 2, maximum: 3 },
        requirements: {
          requireExplicitAcceptanceOwnership: true,
          requireCompleteSeamSpecifications: true,
          requireObservableLeafValidation: true
        }
      }
    });
    expect(Object.values(result.decisions)).toEqual([expect.objectContaining({ kind: "approve_plan", status: "pending" })]);
  });

  it("records model failure and never substitutes a lower-quality planner", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    let calls = 0;
    const result = await runPlanningV2({ runId: "run-failed", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      planCandidates: async () => { calls += 1; throw new Error("selected LLM unavailable"); },
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ lifecycle: "failed", failureReason: "selected LLM unavailable" });
    expect((await events.load("run-failed")).map((event) => event.type)).toEqual(["run.created", "repository.inspected", "planning.envelope_created", "planning.failed"]);
  });

  it("persists the selected candidate when compiler review rejects it", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });

    const result = await runPlanningV2({ runId: "run-compile-failed", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      planCandidates: async (_input, envelope) => candidateSet(envelope),
      compile: () => { throw new Error("Compiled plan review failed: artifact_cycle"); },
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(result).toMatchObject({ lifecycle: "failed", failureReason: "Compiled plan review failed: artifact_cycle" });
    const persisted = await events.load("run-compile-failed");
    expect(persisted.map((event) => event.type)).toEqual([
      "run.created", "repository.inspected", "planning.envelope_created", "planning.candidates_evaluated", "planning.granularity_strategy_selected", "planning.failed"
    ]);
    const strategy = persisted.find((event) => event.type === "planning.granularity_strategy_selected");
    expect(strategy).toMatchObject({
      type: "planning.granularity_strategy_selected",
      payload: { candidateTree: { root: bookingBreakdown().root } }
    });
  });

  it("persists planning nodes before the planner completes", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    let releasePlan!: () => void;
    const planBarrier = new Promise<void>((resolve) => { releasePlan = resolve; });
    let discoveryPersisted!: () => void;
    const discovery = new Promise<void>((resolve) => { discoveryPersisted = resolve; });

    const running = runPlanningV2({ runId: "run-progress", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      planCandidates: async (_input, envelope, _count, observer) => {
        if (observer) {
          await observer.onAttemptStarted({ attempt: 1 });
          await observer.onUnitDiscovered({
            attempt: 1,
            unit: {
              key: "booking",
              parentKey: null,
              kind: "composite",
              title: "Booking creation",
              objective: "Deliver booking creation",
              siblingIndex: 0,
              siblingCount: 1
            }
          });
        }
        discoveryPersisted();
        await planBarrier;
        return candidateSet(envelope);
      },
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    await discovery;
    expect((await events.load("run-progress")).map((event) => event.type)).toEqual([
      "run.created",
      "repository.inspected",
      "planning.envelope_created",
      "planning.attempt_started",
      "planning.node_discovered"
    ]);
    releasePlan();
    await expect(running).resolves.toMatchObject({ lifecycle: "needs_approval" });
  });

  it("turns consequential planning questions into durable decisions instead of failing the run", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const breakdown = bookingBreakdown();
    breakdown.questions.push({
      id: "storage-policy",
      question: "Which persistence policy should the app use?",
      reason: "It changes observable durability and implementation scope.",
      impact: "architecture",
      options: ["JSON file", "SQLite"],
      evidenceIds: []
    });
    const compile = vi.fn((input) => compileGraphRevision(input, compilerDependencies));

    const result = await runPlanningV2({
      runId: "run-clarification",
      goal: "Build booking",
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => breakdown,
      planCandidates: async (_input, envelope) => candidateSet(envelope, breakdown),
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(result.lifecycle).toBe("planning");
    expect(result.failureReason).toBeUndefined();
    expect(Object.values(result.decisions)).toEqual([
      expect.objectContaining({ kind: "clarify_goal", status: "pending", affectedNodeIds: ["node-booking"] })
    ]);
    expect(compile).not.toHaveBeenCalled();
    expect((await events.load("run-clarification")).map((event) => event.type)).toEqual([
      "run.created",
      "repository.inspected",
      "planning.envelope_created",
      "planning.candidates_evaluated",
      "planning.completed",
      "decision.raised"
    ]);
  });
});

function candidateSet(envelope: PlanningEnvelope, breakdown = bookingBreakdown()) {
  return [1, 2, 3].map((index) => bookingCandidate(envelope, `candidate-${index}`, structuredClone(breakdown)));
}
