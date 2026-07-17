import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-v2-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("planning V2 vertical slice", () => {
  it("persists inspection, semantic planning, compilation, critics and approval decision", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const result = await runPlanningV2({ runId: "run-v2", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => bookingBreakdown(),
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(result.lifecycle).toBe("needs_approval");
    const persisted = await events.load("run-v2");
    expect(persisted.map((event) => event.type)).toEqual([
      "run.created", "repository.inspected", "planning.completed", "graph.compiled",
      ...Array(8).fill("planning.critic_recorded"),
      "graph.revision.proposed", "decision.raised"
    ]);
    expect(Object.values(result.decisions)).toEqual([expect.objectContaining({ kind: "approve_plan", status: "pending" })]);
  });

  it("records model failure and never substitutes a lower-quality planner", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    let calls = 0;
    const result = await runPlanningV2({ runId: "run-failed", goal: "Build booking", repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      plan: async () => { calls += 1; throw new Error("selected LLM unavailable"); },
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ lifecycle: "failed", failureReason: "selected LLM unavailable" });
    expect((await events.load("run-failed")).map((event) => event.type)).toEqual(["run.created", "repository.inspected", "planning.failed"]);
  });
});
