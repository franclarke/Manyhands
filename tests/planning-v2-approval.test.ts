import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies, scriptedPlanner } from "./helpers/target-planning-fixtures";
import { approvePlanningV2, revisePlanningV2, runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-approval-v2-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("planning V2 revision approval", () => {
  it("uses revision CAS and requires a new revision-specific approval after an edit", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const journal = { events, snapshots, now: () => "2026-07-17T01:00:00.000Z" };
    const { planner } = scriptedPlanner();
    const planned = await runPlanningV2({ runId: "run-v2", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      ...journal,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile: (input) => compileGraphRevision(input, compilerDependencies)
    });
    const approved = await approvePlanningV2("run-v2", authority, 1, planned.sequence, journal);
    expect(approved).toMatchObject({ lifecycle: "running", approvedGraphRevision: 1 });

    // A hand-built revision stands in for a plan edit; its identity must match
    // the run's graph, which is what the CAS below is checking.
    const revision = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    revision.graph = { ...revision.graph, graphId: approved.graphId!, revision: 2 };
    const revised = await revisePlanningV2("run-v2", authority, 1, approved.sequence, revision, journal);
    expect(revised).toMatchObject({ lifecycle: "needs_approval", graphRevision: 2, approvedGraphRevision: 1 });
    expect(Object.values(revised.decisions).filter((decision) => decision.status === "pending")).toEqual([
      expect.objectContaining({ id: `approve-plan:${approved.graphId!}:r2` })
    ]);
    await expect(revisePlanningV2("run-v2", authority, 1, revised.sequence, revision, journal)).rejects.toThrow(/revision conflict/i);
  });
});
