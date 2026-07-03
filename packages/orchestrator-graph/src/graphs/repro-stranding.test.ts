/**
 * Regression (F-004): accept_failing on a leaf that HAS a dependent must NOT
 * silently strand the dependent. `dependencySatisfied` now mirrors `childSettled`
 * so an accepted-failing producer unblocks its task dependents (execution), not
 * only its composite parent (integration). leaf-c (depends on leaf-a) must run.
 */
import { describe, it, expect } from "vitest";
import { Command } from "@langchain/langgraph";
import { buildExecutionGraph, executionRecursionLimit } from "./execution-graph.js";
import type { RunState } from "../state.js";
import type { LeafExecutionInput } from "../nodes/execution-nodes.js";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";

function makeNode(partial: Partial<TaskNode> & { id: string; kind: TaskNode["kind"] }): TaskNode {
  return {
    parentId: null,
    title: partial.id,
    goal: `goal of ${partial.id}`,
    status: "planned",
    granularity: "auto",
    depth: 0,
    childrenIds: [],
    dependencies: [],
    ...partial
  };
}

function makeGraph(): TaskGraph {
  return {
    id: "graph-1",
    planId: "plan-1",
    repo: "C:/tmp/repo",
    baseBranch: "main",
    baseCommit: "base-sha",
    featureRequest: "test feature",
    rootId: "root",
    createdAt: new Date().toISOString(),
    nodes: {
      root: makeNode({ id: "root", kind: "root", childrenIds: ["leaf-a", "leaf-b", "leaf-c"] }),
      "leaf-a": makeNode({ id: "leaf-a", kind: "leaf", parentId: "root", depth: 1 }),
      "leaf-b": makeNode({ id: "leaf-b", kind: "leaf", parentId: "root", depth: 1 }),
      "leaf-c": makeNode({ id: "leaf-c", kind: "leaf", parentId: "root", depth: 1 })
    },
    dependencies: [{ fromTaskId: "leaf-a", toTaskId: "leaf-c", type: "logical", inferred: false }]
  };
}

function leafResult(taskId: string, status: AgentExecutionResult["status"] = "success"): AgentExecutionResult {
  return {
    taskId,
    status,
    baseHead: "base-sha",
    currentHead: `head-${taskId}`,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [`src/${taskId}.ts`],
    ...(status === "success" ? { commitSha: `commit-${taskId}` } : {}),
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: status === "success" ? 0 : 1,
    executorDurationMs: 5,
    executorTimedOut: false,
    stderrTail: status === "success" ? "" : `validation broke in ${taskId}`,
    stdoutTail: ""
  };
}

function integrationResult(compositeTaskId: string): IntegrationResult {
  return {
    compositeTaskId,
    status: "success",
    childResults: [],
    repairAttempted: false,
    preMergeFindings: [],
    integrationCommitSha: `merge-${compositeTaskId}`
  } as IntegrationResult;
}

function initialState(graph: TaskGraph) {
  return {
    runId: "run-1",
    userPrompt: "build it",
    workspaceId: "ws-1",
    repoPath: graph.repo,
    taskGraph: graph,
    planningStepCache: {},
    leafResults: [],
    integrationResults: [],
    acceptedLeafFailures: [],
    acceptedIntegrationFailures: [],
    pendingQuestion: null,
    userAnswers: {},
    status: "approved" as const,
    errorMessage: null
  };
}

describe("accept_failing on a leaf WITH a dependent (F-004 regression)", () => {
  it("executes the dependent (leaf-c) after its dependency (leaf-a) is accepted-failing", async () => {
    const executions: string[] = [];
    const integrations: string[] = [];
    let validateRunCalledWith: { leafResults: number } | null = null;

    const graph = buildExecutionGraph({
      leafDeps: {
        executeLeaf: async (params: LeafExecutionInput) => {
          executions.push(params.taskId);
          const shouldFail = params.taskId === "leaf-a";
          return { result: leafResult(params.taskId, shouldFail ? "validation_failed" : "success") };
        },
        maxRepairAttempts: 0
      },
      integrateDeps: {
        integrateComposite: async (params) => {
          integrations.push(params.compositeTaskId);
          return integrationResult(params.compositeTaskId);
        }
      },
      validationDeps: {
        validateRun: async (p) => {
          validateRunCalledWith = { leafResults: p.leafResults.length };
          return { passed: true };
        }
      }
    });

    const taskGraph = makeGraph();
    const config = {
      configurable: { thread_id: "t-strand" },
      recursionLimit: executionRecursionLimit({ taskGraph })
    };

    await graph.invoke(initialState(taskGraph), config);
    const final = (await graph.invoke(
      new Command({ resume: { action: "accept_failing" } }),
      config
    )) as RunState;

    // Diagnostics
    console.log("FINAL STATUS:", final.status);
    console.log("EXECUTIONS:", executions);
    console.log("INTEGRATIONS:", integrations);
    console.log("LEAF RESULTS:", final.leafResults.map((r) => `${r.taskId}:${r.status}`));
    console.log("ACCEPTED:", final.acceptedLeafFailures);
    console.log("validateRun leafResults count:", validateRunCalledWith);

    // Before the fix, leaf-c was NEVER executed (stranded) yet the run still
    // reported completed. It must now run and its result must reach validation.
    expect(executions).toContain("leaf-c");
    expect(final.leafResults.map((r) => r.taskId)).toContain("leaf-c");
    expect(final.status).toBe("completed");
  });
});
