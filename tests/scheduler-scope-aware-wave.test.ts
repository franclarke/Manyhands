/**
 * Tests for selectScopeAwareWave — the adaptive wavefront selector that feeds
 * the execution graph's frontier router (docs/design/future-frontier-tasks.md §2).
 */
import { describe, expect, it } from "vitest";
import { selectScopeAwareWave } from "@manyhands/scheduler";
import type { TaskPairRiskMatrix } from "@manyhands/conflict-risk";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";

function makeLeaf(id: string, scopePaths?: string[]): TaskNode {
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
    ...(scopePaths !== undefined
      ? {
          contract: {
            taskId: id,
            objective: `objective ${id}`,
            context: { files: [], symbols: [], constraints: [] },
            allowed: { paths: [], symbols: [] },
            forbidden: { paths: [], symbols: [] },
            relevantSymbols: [],
            dependencies: [],
            acceptance: [{ id: `${id}-ac`, description: "done", verification: "tests" }],
            validationCommands: [],
            expectedOutput: { kind: "patch", description: "diff" },
            limits: { maxDurationMs: 1000, maxCostUsd: 1 },
            knownRisks: [],
            definitionOfDone: "done",
            executionScope: { implementationPaths: scopePaths, testPaths: [], configPaths: [] }
          } as unknown as NonNullable<TaskNode["contract"]>
        }
      : {})
  };
}

function makeGraph(leaves: TaskNode[]): TaskGraph {
  const root: TaskNode = {
    id: "root",
    parentId: null,
    kind: "root",
    title: "root",
    goal: "root goal",
    status: "planned",
    granularity: "auto",
    depth: 0,
    childrenIds: leaves.map((leaf) => leaf.id),
    dependencies: []
  };
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "sha",
    featureRequest: "feature",
    rootId: "root",
    createdAt: new Date().toISOString(),
    nodes: Object.fromEntries([root, ...leaves].map((node) => [node.id, node])),
    dependencies: []
  };
}

describe("selectScopeAwareWave", () => {
  it("runs tasks with disjoint scopes in the same wave", () => {
    const graph = makeGraph([
      makeLeaf("a", ["src/auth/**"]),
      makeLeaf("b", ["src/billing/**"]),
      makeLeaf("c", ["src/ui/**"])
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"] });
    expect(wave).toEqual(["a", "b", "c"]);
  });

  it("serializes tasks whose scope globs overlap", () => {
    const graph = makeGraph([
      makeLeaf("a", ["src/auth/**"]),
      makeLeaf("b", ["src/auth/login.ts"]),
      makeLeaf("c", ["src/billing/**"])
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"] });
    expect(wave).toEqual(["a", "c"]); // b collides with a → next wave
  });

  it("treats a mid-segment glob conservatively (partial segment dropped)", () => {
    const graph = makeGraph([makeLeaf("a", ["src/auth*"]), makeLeaf("b", ["src/authx/file.ts"])]);
    // "src/auth*" reduces to the literal prefix ["src"], which prefixes
    // ["src","authx","file.ts"] → treated as overlapping (conservative).
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"] });
    expect(wave).toEqual(["a"]);
  });

  it("a repo-wide glob overlaps everything", () => {
    const graph = makeGraph([makeLeaf("a", ["**/*.ts"]), makeLeaf("b", ["src/billing/**"])]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"] });
    expect(wave).toEqual(["a"]);
  });

  it("tasks without declared scopes parallelize freely (D9)", () => {
    const graph = makeGraph([makeLeaf("a"), makeLeaf("b"), makeLeaf("c", ["src/x/**"])]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"] });
    expect(wave).toEqual(["a", "b", "c"]);
  });

  it("serializes high/blocking risk pairs even without scopes", () => {
    const graph = makeGraph([makeLeaf("a"), makeLeaf("b"), makeLeaf("c")]);
    const riskMatrix = [
      {
        taskAId: "a",
        taskBId: "b",
        level: "high",
        sharedFiles: ["src/shared.ts"],
        sharedSymbols: [],
        explanation: "both edit shared.ts"
      }
    ] as unknown as TaskPairRiskMatrix;
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"], riskMatrix });
    expect(wave).toEqual(["a", "c"]);
  });

  it("low/medium risk pairs stay parallel", () => {
    const graph = makeGraph([makeLeaf("a"), makeLeaf("b")]);
    const riskMatrix = [
      {
        taskAId: "a",
        taskBId: "b",
        level: "medium",
        sharedFiles: [],
        sharedSymbols: ["X"],
        explanation: "shared symbol"
      }
    ] as unknown as TaskPairRiskMatrix;
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"], riskMatrix });
    expect(wave).toEqual(["a", "b"]);
  });

  it("honours maxParallel as an optional cap", () => {
    const graph = makeGraph([makeLeaf("a"), makeLeaf("b"), makeLeaf("c")]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"], maxParallel: 2 });
    expect(wave).toEqual(["a", "b"]);
  });

  it("never starves the frontier: first candidate always selected", () => {
    const graph = makeGraph([makeLeaf("a", ["**/*"]), makeLeaf("b", ["**/*"])]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"] });
    expect(wave).toEqual(["a"]);
  });
});
