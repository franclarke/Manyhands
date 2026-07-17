/**
 * Tests for selectScopeAwareWave — the adaptive wavefront selector that feeds
 * the execution graph's current frontier router (docs/system/12-scheduler.md).
 */
import { describe, expect, it } from "vitest";
import { buildSchedulingSafetyContext, selectScopeAwareWave } from "@manyhands/scheduler";
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
            context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
            allowed: { paths: scopePaths },
            forbidden: { paths: [] },
            relevantSymbols: [],
            dependencies: [],
            acceptance: [{ kind: "custom", description: "done" }],
            validationCommands: [],
            expectedOutput: { changedFiles: [], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" },
            limits: { maxDurationMs: 1000, maxCostUsd: 1 },
            knownRisks: [],
            definitionOfDone: "done",
            executionScope: { implementationPaths: scopePaths, testPaths: [], configPaths: [] }
          } as unknown as NonNullable<TaskNode["contract"]>
        }
      : {})
  };
}

function makeScopedLeaf(
  id: string,
  scope: { implementationPaths?: string[]; testPaths?: string[]; configPaths?: string[] }
): TaskNode {
  const leaf = makeLeaf(id, scope.implementationPaths ?? []);
  const contract = leaf.contract as NonNullable<TaskNode["contract"]>;
  (contract as unknown as { executionScope: unknown }).executionScope = {
    implementationPaths: scope.implementationPaths ?? [],
    testPaths: scope.testPaths ?? [],
    configPaths: scope.configPaths ?? []
  };
  return leaf;
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

  it("does not serialize scoped tasks that overlap only on shared config files", () => {
    // Shared manifests (package.json, tsconfig.json, vite.config.ts) are touched
    // by nearly every task. Because all leaves branch from the same skeleton
    // commit, serializing on them never avoids the integration-time conflict —
    // it only collapses the wave to a single task. They must not gate parallelism.
    const graph = makeGraph([
      makeScopedLeaf("a", {
        implementationPaths: ["src/server/**"],
        configPaths: ["package.json", "tsconfig.json"]
      }),
      makeScopedLeaf("b", {
        implementationPaths: ["src/client/**"],
        configPaths: ["package.json", "tsconfig.json"]
      }),
      makeScopedLeaf("c", { configPaths: ["package.json", "vite.config.ts"] })
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"] });
    expect(wave).toEqual(["a", "b"]);
  });

  it("still serializes real implementation overlap even when configs are shared", () => {
    const graph = makeGraph([
      makeScopedLeaf("a", {
        implementationPaths: ["src/server/**"],
        configPaths: ["package.json"]
      }),
      makeScopedLeaf("b", {
        implementationPaths: ["src/server/routes.ts"],
        configPaths: ["package.json"]
      })
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"] });
    expect(wave).toEqual(["a"]); // src/server overlap still gates; b waits
  });

  it("parallelizes independent leaves that overlap only on a barrel shared by many (O-7)", () => {
    // Each leaf owns a distinct file and re-exports into a shared src/index.ts.
    // A specific file touched by many leaves is a coordination file, the same
    // class as a shared config manifest: every leaf branches from the same
    // skeleton commit, so serializing on it never avoids the integration-time
    // conflict (the composer reconciles), it only collapses the wave (O-7).
    const graph = makeGraph([
      makeLeaf("a", ["src/a.ts", "src/index.ts"]),
      makeLeaf("b", ["src/b.ts", "src/index.ts"]),
      makeLeaf("c", ["src/c.ts", "src/index.ts"]),
      makeLeaf("d", ["src/d.ts", "src/index.ts"])
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c", "d"] });
    expect(wave).toEqual(["a", "b", "c", "d"]);
  });

  it("still serializes a specific file shared by only two leaves (below the coordination threshold)", () => {
    // Two leaves on the same file is a genuine pairwise overlap, not a broadly
    // shared coordination file — stay conservative.
    const graph = makeGraph([
      makeLeaf("a", ["src/a.ts", "src/shared.ts"]),
      makeLeaf("b", ["src/b.ts", "src/shared.ts"])
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"] });
    expect(wave).toEqual(["a"]);
  });

  it("does NOT treat a broad directory glob shared by many as a coordination file", () => {
    // Several leaves all claiming the whole src/ tree genuinely overlap; the
    // coordination-file relaxation must apply only to specific files (with an
    // extension), never to directory prefixes.
    const graph = makeGraph([
      makeLeaf("a", ["src/**"]),
      makeLeaf("b", ["src/**"]),
      makeLeaf("c", ["src/**"])
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"] });
    expect(wave).toEqual(["a"]);
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

  it("tasks without declared scopes serialize conservatively", () => {
    const graph = makeGraph([makeLeaf("a"), makeLeaf("b"), makeLeaf("c", ["src/x/**"])]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"] });
    expect(wave).toEqual(["a"]);

    const safety = buildSchedulingSafetyContext({ graph, taskIds: ["a", "b", "c"], policy: "risk_aware" });
    expect(safety.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining(["missing_contract", "missing_contract"])
    );
  });

  it("serializes high/blocking risk pairs even without scopes", () => {
    const graph = makeGraph([
      makeLeaf("a", ["src/a/**"]),
      makeLeaf("b", ["src/b/**"]),
      makeLeaf("c", ["src/c/**"])
    ]);
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
    const graph = makeGraph([makeLeaf("a", ["src/a/**"]), makeLeaf("b", ["src/b/**"])]);
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
    const graph = makeGraph([
      makeLeaf("a", ["src/a/**"]),
      makeLeaf("b", ["src/b/**"]),
      makeLeaf("c", ["src/c/**"])
    ]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b", "c"], maxParallel: 2 });
    expect(wave).toEqual(["a", "b"]);
  });

  it("never starves the frontier: first candidate always selected", () => {
    const graph = makeGraph([makeLeaf("a", ["**/*"]), makeLeaf("b", ["**/*"])]);
    const wave = selectScopeAwareWave({ graph, candidates: ["a", "b"] });
    expect(wave).toEqual(["a"]);
  });
});
