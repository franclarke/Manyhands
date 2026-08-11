import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GRANULARITY_POLICY_VERSION, compileGraphRevision, type GraphCompilerInput } from "@manyhands/decomposer";
import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { bookingSnapshot, compilerDependencies, scriptedPlanner } from "./helpers/target-planning-fixtures";
import { runPlanningV2 } from "@/lib/server/runs/v2/planning-host";

/**
 * The granularity policy on the productive planning path.
 *
 * Two obligations, and the second only became real when the policy started to
 * govern: the decision has to survive replay with the reasons that carried it,
 * and the tree it selects has to be the tree that compiles.
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

    // 2. The compiler received the tree the policy selected. Here it keeps the
    //    planner's cut, so the two coincide; the test below makes them differ.
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile.mock.calls[0]![0].semanticPlan?.root.key).toBe("root");

    // 3. Replay from the journal reconstructs the policy and its assessments.
    const replayed = foldRun(persisted);
    expect(replayed.granularityStrategy?.policyVersion).toBe(GRANULARITY_POLICY_VERSION);
    expect(replayed.granularityStrategy?.condition).toBe("C");
    expect(Object.keys(replayed.granularityStrategy!.assessments).sort())
      .toEqual(["node-api", "node-domain", "node-root", "node-ui"]);

    // The metrics describe the tree that actually compiled, which is what the
    // policy selected. Reading them from its input would over-report the moment
    // it collapses anything.
    const compiledLeaves = Object.values(compile.mock.results[0]!.value.graph.nodes)
      .filter((node) => (node as { kind: string }).kind === "leaf").length;
    expect(compiledLeaves).toBe(3);
    expect(replayed.granularityStrategy!.metrics.totalLeafCount).toBe(compiledLeaves);

    // 4. The snapshot projection carries the same explanation (UI surface).
    const snapshotState = await snapshots.loadOrRebuild("run-adaptive", authority);
    expect(snapshotState.granularityStrategy?.condition).toBe("C");

    // 5. The structural metrics are persisted as a diagnostic artifact keyed by
    //    run, without governing lifecycle.
    const metricsRaw = await readFile(path.join(directory, "run-adaptive.granularity-metrics.json"), "utf8");
    const metrics = JSON.parse(metricsRaw) as Record<string, unknown>;
    expect(metrics.runId).toBe("run-adaptive");
    expect(metrics.policyVersion).toBe(GRANULARITY_POLICY_VERSION);
    expect(metrics.condition).toBe("C");
    expect((metrics.metrics as Record<string, unknown>).totalLeafCount).toBe(3);
  });

  /**
   * D13, and a precondition of stage 7: depth reached is the headline number the
   * measurement cells report, and it is read from this event. It must describe
   * the tree that ran.
   *
   * The test above pins the equality on a fixture where the policy leaves the
   * fixpoint's cut alone, so it cannot see a divergence. Condition A makes one
   * deterministic instead of fitted: it collapses the root to a single leaf by
   * definition. Now that the policy governs, the collapse is what compiles and
   * what executes, so the journal must report one leaf — and the candidate tree
   * it also records must still show the three the planner proposed, or the
   * decision becomes unauditable.
   */
  it("compiles the tree the policy selected, and records both it and the input", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const compile = vi.fn((input: GraphCompilerInput) => compileGraphRevision(input, compilerDependencies));
    const { planner } = scriptedPlanner();

    await runPlanningV2({
      runId: "run-condition-a",
      goal: "Build booking",
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority,
      granularityCondition: "A"
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      recursivePlanner: planner,
      compile,
      nodeIdFor: (key) => compilerDependencies.idFor("node", key),
      now: () => "2026-07-23T01:00:00.000Z"
    });

    const replayed = foldRun(await events.load("run-condition-a"));
    // The policy did collapse: without this the test would pass for the wrong
    // reason, on a run where the two trees never diverged at all.
    expect(replayed.granularityStrategy!.assessments["node-root"]?.selected).toBe("leaf");

    const compiledNodes = Object.values(compile.mock.results[0]!.value.graph.nodes) as Array<{ kind: string }>;
    expect(compiledNodes.filter((node) => node.kind === "leaf")).toHaveLength(1);

    expect(replayed.granularityStrategy!.metrics.totalLeafCount).toBe(1);
    expect(replayed.granularityStrategy!.metrics.maxGraphDepth).toBe(0);

    // The input survives alongside the outcome: without the tree the policy was
    // given, a collapse cannot be told from a planner that only ever proposed
    // one unit, and the decision stops being auditable after the fact.
    const recorded = (await events.load("run-condition-a"))
      .find((entry) => entry.type === "planning.granularity_strategy_selected");
    const candidateRoot = (recorded!.payload as {
      candidateTree: { root: { children?: unknown[] } };
    }).candidateTree.root;
    expect(candidateRoot.children).toHaveLength(3);

    // The journal event and the diagnostic artifact describe the same run, so
    // they must describe the same tree. They read from different variables
    // today, which is how the divergence stayed invisible.
    const artifact = JSON.parse(
      await readFile(path.join(directory, "run-condition-a.granularity-metrics.json"), "utf8")
    ) as { metrics: Record<string, unknown> };
    expect(artifact.metrics).toEqual(replayed.granularityStrategy!.metrics);
  });
});
