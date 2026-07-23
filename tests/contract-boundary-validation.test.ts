import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  validateAgentTaskContractBoundary,
  type AgentTaskContract
} from "@manyhands/contracts";
import { validateExecutableTaskGraph, type TaskGraph, type TaskNode } from "@manyhands/task-graph";

describe("contract boundary validation", () => {
  it("accepts a minimal executable contract with scope, paths and acceptance", () => {
    const result = validateAgentTaskContractBoundary(contract("task-a"), {
      taskId: "task-a",
      executable: true
    });

    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("allows explicit scheduler fallback when executionScope is missing but allowed paths exist", () => {
    const input = contract("task-a");
    delete (input as { executionScope?: unknown }).executionScope;

    const result = validateAgentTaskContractBoundary(input, {
      taskId: "task-a",
      executable: true
    });

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "missing_execution_scope",
        severity: "warning",
        field: "executionScope"
      })
    ]);
  });

  it("blocks path traversal and absolute paths in executable contracts", () => {
    const result = validateAgentTaskContractBoundary(
      {
        ...contract("task-a"),
        allowed: { paths: ["../secrets/**"] },
        forbiddenPaths: ["C:\\Users\\franc\\.ssh\\id_rsa"],
        expectedOutput: { changedFiles: ["/etc/passwd"], producedSymbols: [], consumedSymbols: [] }
      },
      { taskId: "task-a", executable: true }
    );

    expect(result.ok).toBe(false);
    expect(result.issues.filter((issue) => issue.code === "unsafe_path")).toHaveLength(3);
  });

  it("blocks invalid and duplicate interface ids inside a contract boundary", () => {
    const result = validateAgentTaskContractBoundary(
      contract("task-a", {
        consumedInterfaces: [{ id: "Bad/Id", kind: "type", signature: "type Bad = {}", description: "bad" }],
        producedInterfaces: [
          { id: "SessionApi", kind: "type", signature: "type SessionApi = {}", description: "session" },
          { id: "SessionApi", kind: "type", signature: "type SessionApi = {}", description: "session duplicate" }
        ]
      }),
      { taskId: "task-a", executable: true }
    );

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid_interface_id",
          field: "consumedInterfaces.id",
          taskId: "task-a",
          severity: "error"
        }),
        expect.objectContaining({
          code: "duplicate_interface_id",
          field: "producedInterfaces",
          taskId: "task-a",
          severity: "error"
        })
      ])
    );
  });

  it("blocks a task from consuming the same seam that it produces", () => {
    const shared = {
      id: "ProjectScripts",
      kind: "type" as const,
      signature: "type ProjectScripts = Record<string, string>",
      description: "package scripts"
    };
    const selfSeamed = contract("task-a", {
      consumedInterfaces: [shared],
      producedInterfaces: [shared]
    });

    const boundary = validateAgentTaskContractBoundary(selfSeamed, {
      taskId: "task-a",
      executable: true
    });
    expect(boundary.ok).toBe(false);
    expect(boundary.issues).toEqual([
      expect.objectContaining({
        code: "self_consumed_interface",
        field: "consumedInterfaces",
        taskId: "task-a",
        severity: "error"
      })
    ]);

    expect(validateExecutableTaskGraph(graphWith([leaf("task-a", selfSeamed)]))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "self_consumed_interface",
          taskId: "task-a",
          severity: "error"
        })
      ])
    );
  });

  it("blocks a task graph with a dangling dependency", () => {
    const issues = validateExecutableTaskGraph({
      ...graphWith([leaf("task-a", contract("task-a"))]),
      dependencies: [{ fromTaskId: "missing", toTaskId: "task-a", type: "logical", inferred: false }]
    });

    expect(issues).toEqual([
      expect.objectContaining({
        code: "dangling_dependency",
        severity: "error"
      })
    ]);
  });

  it("blocks a node whose contract taskId does not match the node id", () => {
    const issues = validateExecutableTaskGraph(graphWith([leaf("task-a", contract("task-b"))]));

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "contract_task_id_mismatch",
          taskId: "task-a",
          severity: "error"
        })
      ])
    );
  });

  it("blocks consumed interfaces with no producer and duplicate producers", () => {
    const consumer = contract("consumer", {
      consumedInterfaces: [{ id: "AuthApi", kind: "type", signature: "type AuthApi = {}", description: "auth" }]
    });
    const producerA = contract("producer-a", {
      producedInterfaces: [{ id: "SessionApi", kind: "type", signature: "type SessionApi = {}", description: "session" }]
    });
    const producerB = contract("producer-b", {
      producedInterfaces: [{ id: "SessionApi", kind: "type", signature: "type SessionApi = {}", description: "session" }]
    });

    const issues = validateExecutableTaskGraph(
      graphWith([
        leaf("consumer", consumer),
        leaf("producer-a", producerA),
        leaf("producer-b", producerB)
      ])
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "orphan_consumed_interface", taskId: "consumer", severity: "error" }),
        expect.objectContaining({ code: "duplicate_produced_interface", taskId: "producer-a", severity: "error" }),
        expect.objectContaining({ code: "duplicate_produced_interface", taskId: "producer-b", severity: "error" })
      ])
    );
  });
});

function contract(
  taskId: string,
  overrides: Partial<Pick<AgentTaskContract, "consumedInterfaces" | "producedInterfaces">> = {}
): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${taskId}.ts`], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
    forbiddenPaths: [],
    ...overrides
  });
}

function leaf(id: string, contractValue: AgentTaskContract): TaskNode {
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
    acceptanceCriteria: ["done"],
    contract: contractValue
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
    childrenIds: leaves.map((node) => node.id)
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
