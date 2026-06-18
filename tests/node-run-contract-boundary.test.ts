import { describe, expect, it } from "vitest";
import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import { assertManualNodeExecutionReady } from "@/lib/server/runs/execution-pipeline";
import type { RunRecord } from "@/lib/server/runs/schema";

describe("manual node execution contract boundary", () => {
  it("rejects a node run when the persisted graph has an invalid contract", async () => {
    const contract = {
      ...validContract("leaf-a"),
      allowed: { paths: ["../outside-repo/**"] }
    };
    const run = runWithGraph(graphWith([leaf("leaf-a", contract)]));

    await expect(assertManualNodeExecutionReady(run, "leaf-a")).rejects.toThrow(
      /Executable graph is invalid|path traversal/i
    );
  });
});

function runWithGraph(graph: TaskGraph): RunRecord {
  return {
    runId: "run-node-boundary",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "Build feature",
    title: "Build feature",
    version: 0,
    status: "approved",
    createdAt: "2026-06-18T00:00:00.000Z",
    updatedAt: "2026-06-18T00:00:00.000Z",
    planning: { decomposition: { graph, contracts: Object.values(graph.nodes).flatMap((node) => node.contract ?? []) } },
    patches: []
  };
}

function validContract(taskId: string): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: "Implement feature",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "works" }],
    validationCommands: [],
    expectedOutput: { changedFiles: ["src/feature.ts"], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
    forbiddenPaths: []
  });
}

function leaf(id: string, contract: AgentTaskContract): TaskNode {
  return {
    id,
    parentId: "root",
    kind: "leaf",
    title: id,
    goal: `goal ${id}`,
    status: "planned",
    granularity: "auto",
    depth: 1,
    childrenIds: [],
    dependencies: [],
    acceptanceCriteria: ["works"],
    contract
  };
}

function graphWith(leaves: TaskNode[]): TaskGraph {
  const root: TaskNode = {
    id: "root",
    parentId: null,
    kind: "root",
    title: "Root",
    goal: "root goal",
    status: "planned",
    granularity: "auto",
    depth: 0,
    childrenIds: leaves.map((node) => node.id),
    dependencies: []
  };
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "feature",
    rootId: "root",
    createdAt: "2026-06-18T00:00:00.000Z",
    nodes: Object.fromEntries([root, ...leaves].map((node) => [node.id, node])),
    dependencies: []
  };
}
