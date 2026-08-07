import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTIVE_UTILITY_POLICY_VERSION, compileGraphRevision, type GraphCompilerInput } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingSnapshot, compilerDependencies, scriptedPlanner } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

/**
 * The adaptive utility policy is still measured on every productive run, and
 * the measurement still has to survive replay — but since stage 3D it no longer
 * chooses anything: the tree that compiles is the one the fixpoint produced.
 * This file fixes the surviving obligation, which is that the measurement is
 * persisted, replayable and side-effect free.
 */

let directory: string;
const authority = { operationId: "planning-op", fencingToken: 1 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-planning-adaptive-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("adaptive granularity in the productive planning pipeline", () => {
  it("persists the assessment before compilation, and replay explains the policy", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const compile = vi.fn((input: GraphCompilerInput) => compileGraphRevision(input, compilerDependencies));
    const { planner } = scriptedPlanner();

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
      recursivePlanner: planner,
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-23T01:00:00.000Z"
    });

    expect(result.failureReason).toBeUndefined();
    expect(result.lifecycle).toBe("needs_approval");

    // 1. The measurement is in the canonical journal, alongside the compiled graph.
    const persisted = await events.load("run-adaptive");
    const types = persisted.map((event) => event.type);
    expect(types).toContain("planning.granularity_strategy_selected");
    expect(types).toContain("graph.compiled");

    // 2. The compiler received the fixpoint's plan, not a policy-selected tree.
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0]![0].semanticPlan?.root.key).toBe("root");

    // 3. Replay from the journal reconstructs the policy and its assessments.
    const replayed = foldRun(persisted);
    expect(replayed.granularityStrategy?.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(replayed.granularityStrategy?.condition).toBe("C");
    expect(Object.keys(replayed.granularityStrategy!.assessments).sort())
      .toEqual(["node-api", "node-domain", "node-root", "node-ui"]);

    // 4. The snapshot projection carries the same explanation (UI surface).
    const snapshotState = await snapshots.loadOrRebuild("run-adaptive", authority);
    expect(snapshotState.granularityStrategy?.condition).toBe("C");

    // 5. The structural metrics are persisted as a diagnostic artifact keyed by
    //    run, without governing lifecycle.
    const metricsRaw = await readFile(path.join(directory, "run-adaptive.granularity-metrics.json"), "utf8");
    const metrics = JSON.parse(metricsRaw) as Record<string, unknown>;
    expect(metrics.runId).toBe("run-adaptive");
    expect(metrics.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(metrics.condition).toBe("C");
    expect((metrics.metrics as Record<string, unknown>).totalLeafCount).toBe(3);
  });
});
