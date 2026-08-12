import { describe, expect, it } from "vitest";
import {
  adaptTaskGraphV1ToLegacyGraphV2,
  validateTaskGraph,
  type TaskGraph,
  type TaskNode
} from "@manyhands/task-graph";

describe("TaskGraph V1 compatibility", () => {
  it("preserves V1 validation and converts only artifact dependencies with explicit path evidence", () => {
    const legacy = legacyGraph();
    expect(validateTaskGraph(legacy).filter((issue) => issue.severity === "error")).toEqual([]);

    const result = adaptTaskGraphV1ToLegacyGraphV2(legacy, {
      repositorySnapshotId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    });

    expect(result.graph.artifactRequirements).toEqual([
      expect.objectContaining({
        producerNodeId: "model",
        consumerNodeId: "ui",
        artifactContract: expect.objectContaining({ id: expect.stringContaining("model") })
      })
    ]);
    expect(result.graph.legacyOrderingConstraints).toEqual([
      expect.objectContaining({ fromNodeId: "model", toNodeId: "tests", deprecated: true, requiresReplan: true })
    ]);
    expect(result.requiresReplan).toBe(true);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "ambiguous_legacy_dependency", nodeId: "tests" })])
    );
  });

  it("turns matching produced and consumed interfaces into seam bindings without adding ordering", () => {
    const legacy = legacyGraph();
    legacy.nodes.model!.contract!.producedInterfaces = [legacyInterface("Booking")];
    legacy.nodes.ui!.contract!.consumedInterfaces = [legacyInterface("Booking")];

    const result = adaptTaskGraphV1ToLegacyGraphV2(legacy, {
      repositorySnapshotId: "snapshot-1"
    });

    expect(result.graph.seamBindings).toEqual([
      expect.objectContaining({ producerNodeId: "model", consumerNodeId: "ui", seamContract: expect.objectContaining({ id: "Booking" }) })
    ]);
    expect(result.graph.nodes.ui).not.toHaveProperty("dependencies");
  });
});

function legacyGraph(): TaskGraph {
  return {
    id: "legacy-booking",
    planId: "plan-1",
    repo: "/repo",
    baseBranch: "main",
    baseCommit: "abc123",
    featureRequest: "Build booking app",
    rootId: "root",
    createdAt: "2026-07-17T00:00:00.000Z",
    nodes: {
      root: node({ id: "root", kind: "root", depth: 0, childrenIds: ["model", "ui", "tests"] }),
      model: node({ id: "model", parentId: "root", kind: "leaf", depth: 1, contract: contract("model", ["src/model.ts"]) }),
      ui: node({
        id: "ui",
        parentId: "root",
        kind: "leaf",
        depth: 1,
        contract: contract("ui", ["src/ui.ts"], ["src/model.ts"])
      }),
      tests: node({
        id: "tests",
        parentId: "root",
        kind: "leaf",
        depth: 1,
        contract: contract("tests", ["tests/model.test.ts"])
      })
    },
    dependencies: [
      { fromTaskId: "model", toTaskId: "ui", type: "contractual", inferred: false },
      { fromTaskId: "model", toTaskId: "tests", type: "logical", inferred: true }
    ]
  } as TaskGraph;
}

function node(partial: Partial<TaskNode> & Pick<TaskNode, "id" | "kind" | "depth">): TaskNode {
  return {
    parentId: null,
    title: partial.id,
    goal: `Implement ${partial.id}`,
    status: "planned",
    granularity: "auto",
    childrenIds: [],
    ...partial
  } as TaskNode;
}

function contract(taskId: string, changedFiles: string[], upstreamArtifacts: string[] = []) {
  return {
    taskId,
    objective: `Implement ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts },
    allowed: { paths: ["src/**", "tests/**"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom" as const, description: "works" }],
    validationCommands: [],
    expectedOutput: { changedFiles, producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 1_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done"
  };
}

function legacyInterface(id: string) {
  return {
    id,
    kind: "type" as const,
    signature: `interface ${id} { id: string }`,
    description: `${id} contract`,
    definedByTaskId: "root"
  };
}
