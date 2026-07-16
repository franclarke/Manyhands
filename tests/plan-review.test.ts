import { describe, expect, it } from "vitest";
import type { AgentTaskContract, RunSnapshot, TaskGraph } from "@manyhands/core";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { buildPlanControlPlane } from "@/lib/plan-control";
import type { RunPatch } from "@/lib/server/runs";

const now = "2026-06-01T00:00:00.000Z";

describe("plan-review", () => {
  it("reports a clean plan when leaves have contracts and no high risks", () => {
    const summary = buildPlanReviewSummary(makeSnapshot());

    expect(summary?.status).toBe("clean");
    expect(summary?.issueCounts).toEqual({ errors: 0, warnings: 0 });
    expect(summary?.readiness).toMatchObject({
      totalLeaves: 1,
      contractReadyLeaves: 1,
      scopeReadyLeaves: 1,
      acceptanceReadyLeaves: 1,
      expectedOutputReadyLeaves: 1
    });
  });

  it("reports blocking validation and readiness issues when a leaf contract is incomplete", () => {
    const snapshot = makeSnapshot({
      contracts: [
        makeContract({
          allowedPaths: [],
          acceptance: [],
          changedFiles: []
        })
      ]
    });

    const summary = buildPlanReviewSummary(snapshot);

    expect(summary?.status).toBe("errors");
    expect(summary?.issues.map((issue) => issue.title)).toEqual(
      expect.arrayContaining(["Missing scope", "Missing acceptance", "Missing expected output"])
    );
    expect(summary?.readiness.scopeReadyLeaves).toBe(0);
    expect(summary?.readiness.acceptanceReadyLeaves).toBe(0);
    expect(summary?.readiness.expectedOutputReadyLeaves).toBe(0);
  });

  it("surfaces unacknowledged high and blocking risks", () => {
    const summary = buildPlanReviewSummary(
      makeSnapshot({
        riskPredictions: [
          {
            taskAId: "task-1",
            taskBId: "task-2",
            level: "high",
            recommendation: "Serialize these tasks.",
            explanation: "They share a file.",
            sharedFiles: ["src/a.ts"],
            sharedSymbols: [],
            evidence: []
          },
          {
            taskAId: "task-3",
            taskBId: "task-4",
            level: "blocking",
            recommendation: "Already acknowledged.",
            explanation: "They share a schema.",
            sharedFiles: [],
            sharedSymbols: ["Schema"],
            evidence: [],
            acknowledged: true
          }
        ] as unknown as RunSnapshot["riskPredictions"]
      })
    );

    expect(summary?.status).toBe("warnings");
    expect(summary?.highRiskCount).toBe(2);
    expect(summary?.unacknowledgedHighRiskCount).toBe(1);
    expect(summary?.issues.some((issue) => issue.kind === "risk")).toBe(true);
  });

  it("counts human plan edits and structured DAG patches", () => {
    const patches: RunPatch[] = [
      patch({ type: "NODE_RENAMED", taskId: "task-1", title: "Edited" }),
      patch({ type: "NODE_ACCEPTANCE_EDITED", taskId: "task-1", acceptanceCriteria: ["Done"] }),
      patch({ type: "SUBTREE_REGENERATED", taskId: "task-1", removedTaskIds: [], nodes: {}, dependencies: [], contracts: [] }),
      patch({ type: "TASKS_SERIALIZED", fromTaskId: "task-1", toTaskId: "task-2" }),
      patch({ type: "DEPENDENCY_REMOVED", fromTaskId: "task-2", toTaskId: "task-3" }),
      patch({ type: "INTEGRATOR_NODE_CREATED", taskId: "integrator", node: makeIntegratorNode(), dependencies: [] }),
      patch({ type: "RISK_ACKNOWLEDGED", taskIds: ["task-1", "task-2"], reason: "Reviewed." })
    ];

    const summary = buildPlanReviewSummary(makeSnapshot(), patches);

    expect(summary?.patchCounts).toEqual({
      humanEdits: 2,
      subtreeRegenerations: 1,
      dependenciesAdded: 1,
      dependenciesRemoved: 1,
      integratorsAdded: 1,
      riskAcknowledgements: 1
    });
  });

  it("raises a blocking error for a consumed seam with no producer", () => {
    const summary = buildPlanReviewSummary(
      makeSnapshot({
        contracts: [
          {
            ...makeContract(),
            consumedInterfaces: [
              { id: "TaskStore", kind: "function", signature: "createTaskStore(): TaskStore", description: "seam" }
            ]
          } as AgentTaskContract
        ]
      })
    );

    expect(summary?.status).toBe("errors");
    expect(summary?.issues.some((issue) => issue.kind === "seam" && issue.severity === "error")).toBe(true);
  });

  it("projects one authoritative editable control plane from the patched snapshot", () => {
    const snapshot = makeSnapshot({
      riskPredictions: [{
        taskAId: "task-1",
        taskBId: "task-2",
        level: "high",
        score: 0.82,
        evidence: [],
        sharedFiles: ["src/shared.ts"],
        sharedSymbols: [],
        predictedConflictTypes: ["file_overlap"],
        recommendation: "serialize",
        explanation: "Both tasks change the same module.",
        acknowledged: true,
        acknowledgedReason: "Reviewed by the operator."
      }] as unknown as RunSnapshot["riskPredictions"]
    });
    snapshot.graphSnapshot.nodes["task-1"]!.metadata = {
      authoredBy: "human",
      executorSelection: { executorId: "codex-cli", model: "gpt-5.5" }
    };

    const control = buildPlanControlPlane(snapshot, {
      version: 7,
      status: "approved",
      routing: "fixed",
      nodeReviews: {
        "task-1": { status: "approved", at: now }
      }
    });

    expect(control).toMatchObject({
      version: 7,
      status: "approved",
      editable: true,
      canRunManualNodes: true
    });
    expect(control?.nodes.find((node) => node.id === "task-1")).toMatchObject({
      objective: "Implement task one.",
      allowedPaths: ["src/task.ts"],
      acceptanceCriteria: ["Criterion"],
      manual: true,
      executorSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      review: { status: "approved" }
    });
    expect(control?.routing).toBe("fixed");
    expect(control?.risks[0]).toMatchObject({
      acknowledged: true,
      acknowledgedReason: "Reviewed by the operator.",
      recommendation: "serialize"
    });
  });
});

function makeSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  const contract = (overrides.contracts?.[0] as AgentTaskContract | undefined) ?? makeContract();
  const graph: TaskGraph = {
    id: "graph-1",
    planId: "plan-1",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Feature",
    rootId: "root",
    createdAt: now,
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate feature.",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["task-1"],
        dependencies: []
      },
      "task-1": {
        id: "task-1",
        parentId: "root",
        kind: "leaf",
        title: "Task one",
        goal: contract.objective,
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract
      }
    },
    dependencies: []
  };

  return {
    runId: "run-1",
    featureId: "feature-1",
    decompositionMode: "balanced",
    graphSnapshot: graph,
    contracts: [contract],
    riskPredictions: [],
    staticConflictSignals: [],
    schedule: { policy: "risk_aware", batches: [], blocked: [], explanations: [] },
    agentRunResults: [],
    blockedTasks: [],
    traceEvents: [],
    metadata: {
      schemaVersion: "test",
      deterministic: true,
      createdAt: now
    },
    ...overrides
  } as RunSnapshot;
}

function makeContract(overrides: {
  taskId?: string;
  allowedPaths?: string[];
  acceptance?: string[];
  changedFiles?: string[];
} = {}): AgentTaskContract {
  const taskId = overrides.taskId ?? "task-1";
  const acceptance = overrides.acceptance ?? ["Criterion"];
  return {
    taskId,
    objective: "Implement task one.",
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: {
      paths: overrides.allowedPaths ?? ["src/task.ts"]
    },
    forbidden: {
      paths: []
    },
    relevantSymbols: [],
    dependencies: [],
    acceptance: acceptance.map((description) => ({ kind: "custom", description })),
    validationCommands: [],
    expectedOutput: {
      changedFiles: overrides.changedFiles ?? ["src/task.ts"],
      producedSymbols: [],
      consumedSymbols: []
    },
    executionScope: {
      implementationPaths: overrides.allowedPaths ?? ["src/task.ts"],
      testPaths: [],
      configPaths: []
    },
    limits: {
      maxDurationMs: 1000,
      maxCostUsd: 0
    },
    knownRisks: [],
    definitionOfDone: "Criterion"
  };
}

function makeIntegratorNode(): Extract<RunPatch, { type: "INTEGRATOR_NODE_CREATED" }>["node"] {
  return {
    id: "integrator",
    parentId: "root",
    kind: "integrator",
    title: "Integrator",
    goal: "Integrate",
    status: "planned",
    granularity: "fine",
    depth: 1,
    childrenIds: [],
    dependencies: [],
    metadata: { integrator: true, integratesTaskIds: ["task-1"] }
  };
}

function patch<T extends RunPatch["type"]>(
  payload: { type: T } & Omit<Extract<RunPatch, { type: T }>, "id" | "createdAt" | "actor">
): Extract<RunPatch, { type: T }> {
  return {
    id: `patch-${payload.type}`,
    createdAt: now,
    actor: "human",
    ...payload
  } as Extract<RunPatch, { type: T }>;
}
