import { describe, expect, it } from "vitest";

import { CanonicalExecutionDriver } from "@manyhands/orchestrator-graph";

import {
  compileStage9Graph,
  stage9At,
  stage9Coordinator,
  stage9SuccessOutcome,
  type Stage9ExecuteInput
} from "./helpers/stage9-driver-harness.js";

/**
 * Stage 9 characterization. Each test names the productive behaviour the gate
 * requires and fails against the pre-Stage-9 route for a stated reason.
 */
describe("Stage 9 productive boundary", () => {
  it("executes a ready wave concurrently", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-concurrency";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });
    const intervals: Array<{ nodeId: string; enteredAt: number; exitedAt: number }> = [];

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        const enteredAt = counter();
        // Yield twice so a serial loop cannot produce overlapping intervals and
        // a concurrent one always does.
        await Promise.resolve();
        await Promise.resolve();
        const exitedAt = counter();
        intervals.push({ nodeId: input.node.id, enteredAt, exitedAt });
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 2 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    const leaves = intervals.filter(({ nodeId }) => nodeId === "unit:a" || nodeId === "unit:b");
    expect(leaves).toHaveLength(2);
    const [first, second] = [...leaves].sort((left, right) => left.enteredAt - right.enteredAt);
    expect(second!.enteredAt).toBeLessThan(first!.exitedAt);
  });

  it("refuses a composite candidate that writes a child-owned resource", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-ownership";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
        rootId: compiled.graph.rootId,
        artifactIds: Object.keys(compiled.contracts.artifacts),
        // The composite reaches into a resource `unit:a` owns with `modify`.
        ...(input.node.id === compiled.graph.rootId
          ? { changedFiles: ["src/app/wire.ts", "src/a.ts"] }
          : {})
      })
    });

    const state = await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 2 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    const rootAttempts = Object.values(state.attempts).filter((attempt) => attempt.nodeId === compiled.graph.rootId);
    expect(rootAttempts).not.toHaveLength(0);
    expect(rootAttempts.every((attempt) => attempt.status !== "succeeded")).toBe(true);
    expect(rootAttempts.some((attempt) => (attempt.failureReason ?? "").includes("ownership_violation"))).toBe(true);
    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.contract.id)).not.toContain("artifact:root");
  });

  it("routes a child defect to that child instead of raising a conflict on the composite", async () => {
    const { fixture, compiled } = compileStage9Graph();
    const runId = "run-stage9-routing";
    const harness = stage9Coordinator({ runId, graphId: compiled.graph.graphId });

    const driver = new CanonicalExecutionDriver({
      coordinator: harness.coordinator,
      now: () => stage9At,
      estimateIntegrationRisk: () => ({ score: 0, evidenceRefs: [] }),
      execute: async (input) => {
        if (input.node.id === compiled.graph.rootId) {
          return {
            kind: "failure" as const,
            reason: "child_defect: artifact:a does not satisfy seam:a-root."
          };
        }
        return stage9SuccessOutcome(input as unknown as Stage9ExecuteInput, {
          rootId: compiled.graph.rootId,
          artifactIds: Object.keys(compiled.contracts.artifacts)
        });
      }
    });

    const state = await driver.run({
      runId,
      graph: compiled.graph,
      contracts: compiled.contracts.taskBundles,
      repositoryContextDigest: fixture.repositoryView.digest,
      executorProfile: { id: "fake", revision: "1" },
      effectiveConfig: { maxParallel: 2 },
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: fixture.repositoryView.model.baseCommit }
    });

    const pending = Object.values(state.decisions).filter((decision) => decision.status === "pending");
    expect(pending).toHaveLength(1);
    // The lowest authority that can fix a defective child artifact is the child,
    // so the child is the repair target. The blocked scope is a different
    // question and covers both: the composite's result cannot stand either.
    expect(pending[0]!.repairTargetNodeId).toBe("unit:a");
    expect(pending[0]!.affectedNodeIds).toEqual(["unit:a", "unit:root"]);
  });
});

let tick = 0;
function counter(): number {
  tick += 1;
  return tick;
}
