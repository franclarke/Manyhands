import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { candidateBreakdownHash, compileGraphRevision } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-candidate-replay-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("blocked planning candidate replay", () => {
  it("skips the live planner only when source hash, snapshot, goal and acceptance input match", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const breakdown = bookingBreakdown();
    const acceptanceCriteria = ["Booking rules are represented"];
    const plan = vi.fn(async () => breakdown);

    const result = await runPlanningV2({
      runId: "candidate-valid",
      goal: "Allow visitors to create bookings",
      acceptanceCriteria,
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority,
      granularityCondition: "C",
      experimentalCandidate: {
        sourceHash: candidateBreakdownHash(breakdown),
        repositorySnapshotId: breakdown.repositorySnapshotId,
        goal: "Allow visitors to create bookings",
        acceptanceCriteria,
        breakdown
      }
    }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan,
      planCandidates: async () => { throw new Error("Candidate planning must not run during replay."); },
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-24T01:00:00.000Z"
    });

    expect(result.lifecycle).toBe("needs_approval");
    expect(plan).not.toHaveBeenCalled();
    expect(result.granularityStrategy?.candidateSourceHash).toBe(candidateBreakdownHash(breakdown));
  });

  it("rejects a candidate bound to another snapshot", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const breakdown = bookingBreakdown();

    const result = await runPlanningV2({
      runId: "candidate-invalid",
      goal: "Allow visitors to create bookings",
      acceptanceCriteria: [],
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority,
      granularityCondition: "A",
      experimentalCandidate: {
        sourceHash: candidateBreakdownHash(breakdown),
        repositorySnapshotId: "sha256:other",
        goal: "Allow visitors to create bookings",
        acceptanceCriteria: [],
        breakdown
      }
    }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => breakdown,
      planCandidates: async () => { throw new Error("Candidate planning must not run during replay."); },
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-24T01:00:00.000Z"
    });

    expect(result).toMatchObject({ lifecycle: "failed" });
    expect(result.failureReason).toMatch(/snapshot/i);
  });
});
