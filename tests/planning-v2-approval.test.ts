import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingCandidate, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { approvePlanningV2, revisePlanningV2, runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-approval-v2-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("planning V2 revision approval", () => {
  it("uses revision CAS and requires a new revision-specific approval after an edit", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const dependencies = { events, snapshots, inspect: async () => bookingSnapshot(), plan: async () => bookingBreakdown(), planCandidates: async (_input: unknown, envelope: Parameters<typeof bookingCandidate>[0]) => [1, 2, 3].map((index) => bookingCandidate(envelope, `candidate-${index}`)), compile: (input: Parameters<typeof compileGraphRevision>[0]) => compileGraphRevision(input, compilerDependencies), now: () => "2026-07-17T01:00:00.000Z" };
    const planned = await runPlanningV2({ runId: "run-v2", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, dependencies);
    const approved = await approvePlanningV2("run-v2", authority, 1, planned.sequence, dependencies);
    expect(approved).toMatchObject({ lifecycle: "running", approvedGraphRevision: 1 });

    const revision = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    revision.graph = { ...revision.graph, revision: 2 };
    const revised = await revisePlanningV2("run-v2", authority, 1, approved.sequence, revision, dependencies);
    expect(revised).toMatchObject({ lifecycle: "needs_approval", graphRevision: 2, approvedGraphRevision: 1 });
    expect(Object.values(revised.decisions).filter((decision) => decision.status === "pending")).toEqual([
      expect.objectContaining({ id: "approve-plan:graph-booking-breakdown:r2" })
    ]);
    await expect(revisePlanningV2("run-v2", authority, 1, revised.sequence, revision, dependencies)).rejects.toThrow(/revision conflict/i);
  });
});
