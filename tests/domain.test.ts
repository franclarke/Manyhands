import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  type AgentTaskContract
} from "@manyhands/contracts";
import {
  buildTaskPairRiskMatrix,
  findRiskPrediction,
  type ConflictPrediction
} from "@manyhands/conflict-risk";
import { scheduleTasks } from "@manyhands/scheduler";
import {
  getReadyLeaves,
  type TaskGraph,
  validateTaskGraph
} from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";

function makeContract(
  taskId: string,
  overrides: Partial<AgentTaskContract> = {}
): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}`,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: {
      paths: [`src/${taskId}/**`]
    },
    forbidden: {
      paths: ["**/.env*"]
    },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [
      {
        kind: "test",
        description: `tests pass for ${taskId}`,
        command: "pnpm test"
      }
    ],
    validationCommands: [
      {
        kind: "unit",
        command: "pnpm test"
      }
    ],
    expectedOutput: {
      changedFiles: [`src/${taskId}/index.ts`],
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: {
      maxDurationMs: 60_000,
      maxCostUsd: 1
    },
    knownRisks: [],
    definitionOfDone: `Task ${taskId} is complete and validated.`,
    ...overrides
  });
}

function makeGraph(
  contracts: Record<string, AgentTaskContract>,
  dependencies: TaskGraph["dependencies"] = [],
  statuses: Record<string, TaskGraph["nodes"][string]["status"]> = {}
): TaskGraph {
  const leafIds = Object.keys(contracts).sort();

  return {
    id: "graph-1",
    planId: "plan-1",
    repo: "manyhands",
    baseBranch: "main",
    baseCommit: "abc123",
    featureRequest: "Build a tested domain nucleus.",
    rootId: "root",
    createdAt: "2026-05-24T00:00:00.000Z",
    dependencies,
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate leaf tasks.",
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
            status: statuses[taskId] ?? "planned",
            granularity: "fine" as const,
            depth: 1,
            childrenIds: [],
            dependencies: [],
            contract: contracts[taskId]
          }
        ])
      )
    }
  };
}

describe("TaskGraph", () => {
  it("validates a graph without cycles", () => {
    const graph = makeGraph({
      a: makeContract("a"),
      b: makeContract("b")
    });

    expect(validateTaskGraph(graph)).toEqual([]);
  });

  it("detects a cycle in the DAG", () => {
    const graph = makeGraph(
      {
        a: makeContract("a"),
        b: makeContract("b")
      },
      [
        {
          fromTaskId: "a",
          toTaskId: "b",
          type: "logical",
          inferred: false
        },
        {
          fromTaskId: "b",
          toTaskId: "a",
          type: "logical",
          inferred: false
        }
      ]
    );

    expect(validateTaskGraph(graph)).toContainEqual(
      expect.objectContaining({ code: "cycle_detected" })
    );
  });

  it("calculates ready leaves according to dependencies", () => {
    const graph = makeGraph(
      {
        setup: makeContract("setup"),
        ui: makeContract("ui")
      },
      [
        {
          fromTaskId: "setup",
          toTaskId: "ui",
          type: "contractual",
          inferred: false
        }
      ]
    );

    expect(getReadyLeaves(graph).map((node) => node.id)).toEqual(["setup"]);
  });
});

describe("AgentTaskContract", () => {
  it("validates a correct contract", () => {
    expect(AgentTaskContractSchema.safeParse(makeContract("valid")).success).toBe(true);
  });

  it("rejects contracts without allowed paths or acceptance criteria", () => {
    const withoutAllowed = {
      ...makeContract("without-allowed"),
      allowed: {
        paths: []
      }
    };
    const withoutAcceptance = {
      ...makeContract("without-acceptance"),
      acceptance: []
    };

    expect(AgentTaskContractSchema.safeParse(withoutAllowed).success).toBe(false);
    expect(AgentTaskContractSchema.safeParse(withoutAcceptance).success).toBe(false);
  });
});

describe("ConflictRisk", () => {
  it("predicts high risk when two tasks touch the same file and symbol", () => {
    const first = makeContract("first", {
      allowed: {
        paths: ["src/auth/session.ts"]
      },
      relevantSymbols: ["Session"],
      expectedOutput: {
        changedFiles: ["src/auth/session.ts"],
        producedSymbols: ["Session"],
        consumedSymbols: []
      }
    });
    const second = makeContract("second", {
      allowed: {
        paths: ["src/auth/session.ts"]
      },
      relevantSymbols: ["Session"],
      expectedOutput: {
        changedFiles: ["src/auth/session.ts"],
        producedSymbols: [],
        consumedSymbols: ["Session"]
      }
    });

    const prediction = findRiskPrediction(
      buildTaskPairRiskMatrix({ contracts: { first, second } }),
      "first",
      "second"
    );

    expect(prediction?.level).toBe("high");
    expect(prediction?.evidence.map((item) => item.signal)).toEqual(
      expect.arrayContaining(["file_overlap", "symbol_overlap"])
    );
  });

  it("predicts low risk when no overlap is declared", () => {
    const first = makeContract("first", {
      allowed: {
        paths: ["src/billing/**"]
      },
      relevantSymbols: ["Invoice"],
      expectedOutput: {
        changedFiles: ["src/billing/invoice.ts"],
        producedSymbols: ["Invoice"],
        consumedSymbols: []
      }
    });
    const second = makeContract("second", {
      allowed: {
        paths: ["src/auth/**"]
      },
      relevantSymbols: ["Session"],
      expectedOutput: {
        changedFiles: ["src/auth/session.ts"],
        producedSymbols: ["Session"],
        consumedSymbols: []
      }
    });

    const prediction = findRiskPrediction(
      buildTaskPairRiskMatrix({ contracts: { first, second } }),
      "first",
      "second"
    );

    expect(prediction?.level).toBe("low");
    expect(prediction?.score).toBe(0);
  });
});

describe("Scheduler", () => {
  it("generates naive batches from dependency readiness", () => {
    const contracts = {
      a: makeContract("a"),
      b: makeContract("b"),
      c: makeContract("c")
    };
    const graph = makeGraph(contracts, [
      {
        fromTaskId: "a",
        toTaskId: "c",
        type: "logical",
        inferred: false
      }
    ]);

    const plan = scheduleTasks({
      graph,
      contracts,
      riskMatrix: buildTaskPairRiskMatrix({ contracts }),
      maxParallel: 2,
      policy: "parallel_naive"
    });

    expect(plan.batches.map((batch) => batch.taskIds)).toEqual([["a", "b"], ["c"]]);
    expect(plan.blocked).toEqual([]);
  });

  it("schedules integrator nodes as executable work after their dependencies", () => {
    const contracts = {
      a: makeContract("a"),
      join: makeContract("join")
    };
    const graph = makeGraph(contracts, [
      {
        fromTaskId: "a",
        toTaskId: "join",
        type: "logical",
        inferred: false
      }
    ]);
    graph.nodes.join!.kind = "integrator";
    graph.nodes.join!.metadata = { integrator: true, integratesTaskIds: ["a"] };

    const plan = scheduleTasks({
      graph,
      contracts,
      riskMatrix: buildTaskPairRiskMatrix({ contracts }),
      maxParallel: 2,
      policy: "parallel_naive"
    });

    expect(plan.batches.map((batch) => batch.taskIds)).toEqual([["a"], ["join"]]);
    expect(plan.blocked).toEqual([]);
  });

  it("generates risk-aware batches that avoid high-risk pairs", () => {
    const contracts = {
      a: makeContract("a"),
      b: makeContract("b"),
      c: makeContract("c")
    };
    const graph = makeGraph(contracts);
    const highRisk: ConflictPrediction = {
      taskAId: "a",
      taskBId: "b",
      level: "high",
      score: 0.8,
      evidence: [
        {
          signal: "file_overlap",
          detail: "both edit src/shared.ts",
          weight: 0.8
        }
      ],
      sharedFiles: ["src/shared.ts"],
      sharedSymbols: [],
      predictedConflictTypes: ["textual"],
      recommendation: "serialize",
      explanation: "both edit src/shared.ts"
    };

    const plan = scheduleTasks({
      graph,
      contracts,
      riskMatrix: [highRisk],
      maxParallel: 6,
      policy: "risk_aware"
    });

    expect(plan.batches.some((batch) => batch.taskIds.includes("a") && batch.taskIds.includes("b"))).toBe(false);
    expect(plan.batches.flatMap((batch) => batch.taskIds).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("InMemoryTraceStore", () => {
  it("registers trace events in memory", () => {
    const store = new InMemoryTraceStore();

    store.append({
      type: "graph_created",
      actor: "system",
      planId: "plan-1",
      payload: {
        graphId: "graph-1"
      }
    });
    store.append({
      type: "task_completed",
      actor: "agent",
      planId: "plan-1",
      taskId: "a",
      payload: {
        success: true
      }
    });

    expect(store.list()).toHaveLength(2);
    expect(store.findByType("task_completed")).toHaveLength(1);
    expect(store.findByTask("a")[0]?.payload).toEqual({ success: true });
  });
});
