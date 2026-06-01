import type { TaskGraph } from "@manyhands/task-graph";
import { describe, expect, it } from "vitest";
import {
  computeGranularityVector,
  type AgentExecutionResult,
  type IntegrationResult
} from "@manyhands/execution-core";

function graphWith(leafIds: string[]): TaskGraph {
  return {
    id: "graph-1",
    planId: "plan-1",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "Build it.",
    rootId: "root",
    createdAt: "2026-05-28T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate.",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: leafIds,
        dependencies: []
      },
      ...Object.fromEntries(
        leafIds.map((taskId) => [
          taskId,
          {
            id: taskId,
            parentId: "root",
            kind: "leaf" as const,
            title: taskId,
            goal: `Do ${taskId}.`,
            status: "planned" as const,
            granularity: "fine" as const,
            depth: 1,
            childrenIds: [],
            dependencies: [],
            acceptanceCriteria: ["criterion one", "criterion two"]
          }
        ])
      )
    }
  };
}

function leafResult(taskId: string, overrides: Partial<AgentExecutionResult> = {}): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "BASE",
    currentHead: `${taskId}_SHA`,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [`src/${taskId}.ts`],
    commitSha: `${taskId}_SHA`,
    scopeCheck: { passed: true, violations: [] },
    executorExitCode: 0,
    executorDurationMs: 100,
    executorTimedOut: false,
    ...overrides
  };
}

describe("computeGranularityVector", () => {
  it("derives pre-execution structure metrics from the graph", () => {
    const vector = computeGranularityVector({
      graph: graphWith(["a", "b", "c"]),
      leafResults: [leafResult("a"), leafResult("b"), leafResult("c")],
      totalDurationMs: 5000
    });

    expect(vector.leafCount).toBe(3);
    expect(vector.compositeCount).toBe(1);
    expect(vector.depth).toBe(1);
    expect(vector.maxLeafDepth).toBe(1);
    expect(vector.avgLeafDepth).toBe(1);
    expect(vector.avgAcceptanceCriteriaPerLeaf).toBe(2);
  });

  it("computes leaf success rate and counts violations and unexpected commits", () => {
    const vector = computeGranularityVector({
      graph: graphWith(["a", "b", "c", "d"]),
      leafResults: [
        leafResult("a"),
        leafResult("b", { status: "scope_violation", commitSha: undefined }),
        leafResult("c", { agentCommittedUnexpectedly: true }),
        leafResult("d")
      ],
      totalDurationMs: 1000
    });

    expect(vector.leafSuccessRate).toBeCloseTo(0.75);
    expect(vector.scopeViolationCount).toBe(1);
    expect(vector.unexpectedCommitCount).toBe(1);
  });

  it("counts changed lines from diffs and sums optional cost", () => {
    const vector = computeGranularityVector({
      graph: graphWith(["a"]),
      leafResults: [
        leafResult("a", {
          diff: "diff --git a/x b/x\n--- a/x\n+++ b/x\n+added line\n-removed line\n context",
          costUsd: 0.02
        })
      ],
      totalDurationMs: 100
    });

    expect(vector.linesChanged).toBe(2);
    expect(vector.totalCostUsd).toBeCloseTo(0.02);
  });

  it("treats integrations with conflicts and reports integration success rate", () => {
    const integration: IntegrationResult = {
      compositeTaskId: "root",
      status: "executor_repair_success",
      childResults: [leafResult("a"), leafResult("b")],
      integrationCommitSha: "INT_SHA",
      repairAttempted: true
    };

    const vector = computeGranularityVector({
      graph: graphWith(["a", "b"]),
      leafResults: [leafResult("a"), leafResult("b")],
      integrationResults: [integration],
      totalDurationMs: 2000
    });

    expect(vector.integrationSuccessRate).toBe(1);
    expect(vector.conflictRate).toBeGreaterThan(0);
  });

  it("uses vacuous success when there are no integrations", () => {
    const vector = computeGranularityVector({
      graph: graphWith(["a"]),
      leafResults: [leafResult("a")],
      totalDurationMs: 100
    });

    expect(vector.integrationSuccessRate).toBe(1);
    expect(vector.conflictRate).toBe(0);
    expect(vector.totalCostUsd).toBeUndefined();
  });
});
