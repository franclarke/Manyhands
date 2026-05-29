import { beforeAll, describe, expect, it } from "vitest";
import { runBenchmarkMockFlow, type RunSnapshot } from "@manyhands/core";
import { buildRunSummary } from "@/lib/run-summary";

describe("run-summary", () => {
  let snapshot: RunSnapshot;

  beforeAll(async () => {
    const result = await runBenchmarkMockFlow({
      manifestPath: "benchmarks/mock-v0/benchmark.json",
      featureIds: ["passwordless-login"],
      configurationIds: ["B3"],
      createdAt: "1970-01-01T00:00:00.000Z"
    });
    const first = result.snapshots[0];
    if (!first) {
      throw new Error("Benchmark flow did not produce a snapshot");
    }
    snapshot = first;
  });

  it("derives pre-execution structure from the real DAG", () => {
    const nodes = Object.values(snapshot.graphSnapshot.nodes);
    const leaves = nodes.filter((node) => node.kind === "leaf");
    const { pre } = buildRunSummary(snapshot);

    expect(pre.leafCount).toBe(leaves.length);
    expect(pre.compositeCount).toBe(nodes.length - leaves.length);
    expect(pre.dependencyCount).toBe(snapshot.graphSnapshot.dependencies.length);
    expect(pre.depth).toBe(nodes.reduce((max, node) => Math.max(max, node.depth), 0));
    expect(pre.maxLeafDepth).toBeLessThanOrEqual(pre.depth);
    expect(pre.avgLeafDepth).toBeGreaterThanOrEqual(0);
    expect(pre.avgAcceptanceCriteriaPerLeaf).toBeGreaterThanOrEqual(0);
  });

  it("keeps integration metrics pending and bounds execution rates", () => {
    const { post } = buildRunSummary(snapshot);

    expect(post.integrationPending).toBe(true);

    if (post.executed) {
      expect(post.leafSuccessRate).toBeGreaterThanOrEqual(0);
      expect(post.leafSuccessRate).toBeLessThanOrEqual(1);
      expect(post.testsPassedRate).toBeGreaterThanOrEqual(0);
      expect(post.testsPassedRate).toBeLessThanOrEqual(1);
      expect(post.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(post.totalCostUsd).toBeGreaterThanOrEqual(0);
    } else {
      expect(post.leafSuccessRate).toBeUndefined();
    }
  });

  it("returns an empty-but-valid summary when there are no run results", () => {
    const emptySnapshot: RunSnapshot = { ...snapshot, agentRunResults: [] };
    const { post } = buildRunSummary(emptySnapshot);

    expect(post.executed).toBe(false);
    expect(post.integrationPending).toBe(true);
    expect(post.totalCostUsd).toBeUndefined();
  });
});
