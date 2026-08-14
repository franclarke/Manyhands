import { describe, expect, it } from "vitest";

import { CanonicalExecutionDriver } from "@manyhands/orchestrator-graph";

import {
  compileStage9Graph,
  stage9At,
  stage9Coordinator,
  stage9SuccessOutcome,
  type Stage9ExecuteInput
} from "./helpers/stage9-driver-harness.js";

function runInput(compiled: ReturnType<typeof compileStage9Graph>["compiled"], fixture: ReturnType<typeof compileStage9Graph>["fixture"], runId: string, maxParallel: number) {
  return {
    runId,
    graph: compiled.graph,
    contracts: compiled.contracts.taskBundles,
    repositoryContextDigest: fixture.repositoryView.digest,
    executorProfile: { id: "fake", revision: "1" },
    effectiveConfig: { maxParallel },
    availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
    target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
  };
}

describe("Stage 9 bounded parallel execution", () => {
  it("never runs more attempts at once than maxParallel allows", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-bound";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    let inFlight = 0;
    let peak = 0;

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        await Promise.resolve();
        inFlight -= 1;
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    await driver.run(runInput(compiled, fixture, runId, 1));
    expect(peak).toBe(1);
  });

  it("keeps journal appends strictly sequenced while attempts overlap", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-sequenced";
    // This coordinator throws if two appends interleave, so a concurrent writer
    // fails the test rather than silently corrupting the sequence.
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId, detectInterleaving: true });

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        await Promise.resolve();
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    const state = await driver.run(runInput(compiled, fixture, runId, 4));
    expect(state.lifecycle).not.toBe("running");
    const sequences = harness.events().map((event) => event.sequence);
    expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    expect(new Set(sequences).size).toBe(sequences.length);
  });

  it("lets a sibling finish and be recorded when another attempt fails", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-sibling";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    const finished: string[] = [];

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        if (input.node.id === "unit:a") {
          return { kind: "failure" as const, reason: "validation: focused check failed" };
        }
        // The sibling takes longer than the failure, so a driver that abandons
        // the wave on first failure loses this outcome.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        finished.push(input.node.id);
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    const state = await driver.run(runInput(compiled, fixture, runId, 2));

    expect(finished).toContain("unit:b");
    const attemptsByNode = Object.fromEntries(Object.values(state.attempts).map((attempt) => [attempt.nodeId, attempt]));
    expect(attemptsByNode["unit:a"]!.status).toBe("failed");
    expect(attemptsByNode["unit:b"]).toBeDefined();
    expect(attemptsByNode["unit:b"]!.status).not.toBe("running");
    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.contract.id)).toContain("artifact:b");
  });

  it("settles every in-flight attempt before surfacing an executor throw", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-throw";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    let siblingSettled = false;

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        if (input.node.id === "unit:a") throw new Error("executor crashed");
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        siblingSettled = true;
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    await expect(driver.run(runInput(compiled, fixture, runId, 2))).rejects.toThrow(/executor crashed/u);
    // An abandoned in-flight attempt is an unjournaled result, which is exactly
    // what the gate forbids.
    expect(siblingSettled).toBe(true);
  });

  it("reaches the same adopted artifacts serially and in parallel", async () => {
    const digests = [] as Array<Record<string, string>>;
    for (const maxParallel of [1, 4]) {
      const { fixture, compiled } = compileStage9Graph();
      const runId = `run-stage9-converge-${maxParallel}`;
      const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
      const driver = new CanonicalExecutionDriver({
        coordinator: harness.coordinator,
        now: () => stage9At,
        estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
        execute: async (input) => {
          await Promise.resolve();
          return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
            rootId: compiled.graph.rootId,
            artifactIds: Object.keys(compiled.contracts.artifacts)
          });
        }
      });
      const state = await driver.run(runInput(compiled, fixture, runId, maxParallel));
      digests.push(Object.fromEntries(Object.values(state.adoptedArtifacts)
        .map((artifact) => [artifact.contract.id, artifact.digest])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))));
    }
    expect(digests[0]).toEqual(digests[1]);
  });
});
