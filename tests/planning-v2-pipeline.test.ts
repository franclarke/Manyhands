import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecursivePlanner, compileGraphRevision } from "@manyhands/decomposer";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingCut, bookingSnapshot, compilerDependencies, scriptedPlanner } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

/**
 * The productive planning slice, end to end over the journal.
 *
 * Stage 3F of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`
 * retired the candidate-set protocol this file used to exercise. What survives
 * here are the guarantees that outlived it: what the planner is given, what a
 * failure records, and that units become durable while planning is still
 * running.
 */

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };
const BASE = { repoPath: "C:/repo/booking", targetFingerprint: "target-1", baseCommit: "1".repeat(40), authority, goal: "Build booking" };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-v2-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("planning V2 vertical slice", () => {
  it("grounds the package manifest when repository scripts form part of the command surface", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const { planner, seen } = scriptedPlanner();

    await runPlanningV2({ ...BASE, runId: "run-manifest-grounding" }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.evidence).toContainEqual(expect.objectContaining({ kind: "path", reference: "package.json" }));
  });

  it("records model failure and never substitutes a lower-quality planner", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    let calls = 0;
    const planner = new RecursivePlanner({
      model: { proposeCut: async () => { calls += 1; throw new Error("selected LLM unavailable"); } },
      budget: { maxScopePaths: 2 },
      maxAttemptsPerUnit: 1
    });

    const result = await runPlanningV2({ ...BASE, runId: "run-failed" }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(calls).toBe(1);
    expect(result).toMatchObject({ lifecycle: "failed" });
    expect(result.failureReason).toContain("selected LLM unavailable");
    expect((await events.load("run-failed")).map((event) => event.type)).toContain("planning.failed");
    expect((await events.load("run-failed")).map((event) => event.type)).not.toContain("graph.compiled");
  });

  it("fails the run when the compiler rejects the plan, without pretending a graph exists", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const { planner } = scriptedPlanner();

    const result = await runPlanningV2({ ...BASE, runId: "run-compile-failed" }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile: () => { throw new Error("Compiled plan review failed: artifact_cycle"); },
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(result).toMatchObject({ lifecycle: "failed", failureReason: "Compiled plan review failed: artifact_cycle" });
    const types = (await events.load("run-compile-failed")).map((event) => event.type);
    expect(types).toContain("planning.node_discovered");
    expect(types).toContain("planning.failed");
    expect(types).not.toContain("graph.compiled");
  });

  it("persists planning nodes before the planner completes", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    let releaseChildren!: () => void;
    const barrier = new Promise<void>((resolve) => { releaseChildren = resolve; });
    let rootPersisted!: () => void;
    const rootDiscovered = new Promise<void>((resolve) => { rootPersisted = resolve; });

    const planner = new RecursivePlanner({
      model: {
        async proposeCut(request) {
          if (request.unit.key !== "root") throw new Error(`no scripted cut for ${request.unit.key}`);
          // The root resolves as a composite the moment its cut is accepted;
          // its children are still unplanned when the journal already knows it.
          void Promise.resolve().then(() => { rootPersisted(); });
          await barrier;
          return JSON.stringify(bookingCut().root);
        }
      },
      budget: { maxScopePaths: 2 },
      maxAttemptsPerUnit: 1
    });

    const running = runPlanningV2({ ...BASE, runId: "run-progress" }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile: (input) => compileGraphRevision(input, compilerDependencies),
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-17T01:00:00.000Z"
    });

    await rootDiscovered;
    expect((await events.load("run-progress")).map((event) => event.type)).toEqual([
      "run.created",
      "repository.inspected"
    ]);
    releaseChildren();
    await expect(running).resolves.toMatchObject({ lifecycle: "needs_approval" });
    const discovered = (await events.load("run-progress"))
      .filter((event) => event.type === "planning.node_discovered")
      .map((event) => (event.payload as { node: { key: string } }).node.key);
    expect(discovered).toEqual(["root", "domain", "api", "ui"]);
  });

  it("compiles from the SemanticPlan the fixpoint produced, never from a breakdown", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const { planner } = scriptedPlanner();
    const compile = vi.fn((input: Parameters<typeof compileGraphRevision>[0]) => compileGraphRevision(input, compilerDependencies));

    const result = await runPlanningV2({ ...BASE, runId: "run-semantic-input" }, {
      events, snapshots,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile,
      now: () => "2026-07-17T01:00:00.000Z"
    });

    expect(result.lifecycle).toBe("needs_approval");
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0]![0].semanticPlan).toBeDefined();
    expect(compile.mock.calls[0]![0].breakdown).toBeUndefined();
    expect(Object.values(result.decisions)).toEqual([expect.objectContaining({ kind: "approve_plan", status: "pending" })]);
  });
});
