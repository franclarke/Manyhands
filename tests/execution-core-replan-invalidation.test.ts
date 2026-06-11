import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import {
  AmendmentsEngine,
  computeTaskInvalidationClosure,
  type AgentExecutionResult,
  type IntegrationResult
} from "@manyhands/execution-core";

function node(partial: Partial<TaskNode> & Pick<TaskNode, "id" | "kind" | "depth">): TaskNode {
  return {
    parentId: null,
    title: partial.id,
    goal: `goal of ${partial.id}`,
    status: "planned",
    granularity: "auto",
    childrenIds: [],
    dependencies: [],
    ...partial
  } as TaskNode;
}

/**
 * root → A (composite → A1, A2), B (leaf, depends on A1), C (independent leaf).
 */
function graphFixture(): TaskGraph {
  return {
    id: "g",
    planId: "p",
    repo: "/repo",
    baseBranch: "main",
    baseCommit: "abc",
    featureRequest: "f",
    rootId: "root",
    createdAt: "2026-06-10T00:00:00.000Z",
    nodes: {
      root: node({ id: "root", kind: "root", depth: 0, childrenIds: ["A", "B", "C"] }),
      A: node({ id: "A", kind: "composite", depth: 1, parentId: "root", childrenIds: ["A1", "A2"] }),
      A1: node({ id: "A1", kind: "leaf", depth: 2, parentId: "A" }),
      A2: node({ id: "A2", kind: "leaf", depth: 2, parentId: "A" }),
      B: node({ id: "B", kind: "leaf", depth: 1, parentId: "root", dependencies: ["A1"] }),
      C: node({ id: "C", kind: "leaf", depth: 1, parentId: "root" })
    },
    dependencies: [{ fromTaskId: "A1", toTaskId: "B", type: "contractual", inferred: false }]
  } as unknown as TaskGraph;
}

function leafResult(taskId: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "abc",
    currentHead: "def",
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 10,
    executorTimedOut: false
  };
}

function integrationResult(compositeTaskId: string): IntegrationResult {
  return {
    compositeTaskId,
    status: "success",
    childTaskIds: [],
    cherryPicks: [],
    repairAttempted: false,
    preMergeFindings: []
  } as unknown as IntegrationResult;
}

describe("computeTaskInvalidationClosure", () => {
  it("includes the subtree, transitive dependents, and ancestor integrations", () => {
    const closure = computeTaskInvalidationClosure(graphFixture(), "A");

    expect(closure).toEqual(new Set(["A", "A1", "A2", "B", "root"]));
  });

  it("leaves independent siblings untouched", () => {
    const closure = computeTaskInvalidationClosure(graphFixture(), "A");

    expect(closure.has("C")).toBe(false);
  });

  it("invalidating a leaf pulls in its dependents and ancestors but not its siblings", () => {
    const closure = computeTaskInvalidationClosure(graphFixture(), "A1");

    expect(closure).toEqual(new Set(["A1", "B", "A", "root"]));
    expect(closure.has("A2")).toBe(false);
  });
});

describe("AmendmentsEngine.invalidateTask", () => {
  let repoRoot: string;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), "mh-replan-"));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it("filters results for the invalidated closure and keeps survivors", async () => {
    const engine = new AmendmentsEngine();
    const result = await engine.invalidateTask({
      repoRoot,
      runId: "run-1",
      graph: graphFixture(),
      taskId: "A",
      leafResults: [leafResult("A1"), leafResult("A2"), leafResult("B"), leafResult("C")],
      integrationResults: [integrationResult("A"), integrationResult("root")]
    });

    expect(result.invalidatedTaskIds).toEqual(new Set(["A", "A1", "A2", "B", "root"]));
    expect(result.leafResults.map((r) => r.taskId)).toEqual(["C"]);
    expect(result.integrationResults).toEqual([]);
  });
});
