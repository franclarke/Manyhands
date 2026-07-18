import { describe, expect, it } from "vitest";
import { AgentTaskContractSchema, type AgentTaskContract, type InterfaceContract } from "@manyhands/contracts";
import {
  buildRepositoryAwareRiskMatrix,
  buildStaticConflictSignals,
  findRiskPrediction
} from "@manyhands/conflict-risk";
import type { RepositoryIndex } from "@manyhands/repository-index";
import { buildSchedulingSafetyContext, scheduleTasks } from "@manyhands/scheduler";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";

describe("repository-aware scheduling risk", () => {
  it("same expected file becomes high risk and is not co-scheduled", () => {
    const contracts = {
      a: contract("a", { paths: ["src/a.ts"], changedFiles: ["src/shared.ts"] }),
      b: contract("b", { paths: ["src/b.ts"], changedFiles: ["src/shared.ts"] })
    };
    const graph = graphFor(contracts);
    const safety = buildSchedulingSafetyContext({ graph, contracts, policy: "risk_aware" });
    const prediction = findRiskPrediction(safety.riskMatrix, "a", "b");

    expect(prediction?.level).toBe("high");
    expect(prediction?.evidence.map((item) => item.signal)).toContain("file_overlap");

    const plan = scheduleTasks({
      graph,
      contracts,
      riskMatrix: safety.riskMatrix,
      maxParallel: 2,
      policy: "risk_aware"
    });
    expect(plan.batches.map((batch) => batch.taskIds)).toEqual([["a"], ["b"]]);
  });

  it("disjoint scopes remain low risk and can share a wave", () => {
    const contracts = {
      a: contract("a", { paths: ["src/auth/**"], changedFiles: ["src/auth/session.ts"] }),
      b: contract("b", { paths: ["src/billing/**"], changedFiles: ["src/billing/invoice.ts"] })
    };
    const graph = graphFor(contracts);
    const safety = buildSchedulingSafetyContext({ graph, contracts, policy: "risk_aware" });
    const prediction = findRiskPrediction(safety.riskMatrix, "a", "b");

    expect(prediction?.level).toBe("low");
    expect(scheduleTasks({
      graph,
      contracts,
      riskMatrix: safety.riskMatrix,
      maxParallel: 2,
      policy: "risk_aware"
    }).batches.map((batch) => batch.taskIds)).toEqual([["a", "b"]]);
  });

  it("compatible producer/consumer interface seams remain low risk and share a wave", () => {
    const seam = interfaceContract("TaskStore");
    const contracts = {
      producer: contract("producer", {
        paths: ["src/store.ts"],
        changedFiles: ["src/store.ts"],
        producedSymbols: ["TaskStore"],
        producedInterfaces: [seam]
      }),
      consumer: contract("consumer", {
        paths: ["src/view.ts"],
        changedFiles: ["src/view.ts"],
        consumedSymbols: ["TaskStore"],
        consumedInterfaces: [seam]
      })
    };
    const graph = graphFor(contracts);
    const safety = buildSchedulingSafetyContext({ graph, contracts, policy: "risk_aware" });
    const prediction = findRiskPrediction(safety.riskMatrix, "producer", "consumer");

    expect(prediction?.level).toBe("low");
    expect(prediction?.evidence.map((item) => item.signal)).not.toContain("producer_consumer");
    expect(scheduleTasks({
      graph,
      contracts,
      riskMatrix: safety.riskMatrix,
      maxParallel: 2,
      policy: "risk_aware"
    }).batches.map((batch) => batch.taskIds)).toEqual([["consumer", "producer"]]);
  });

  it("keeps incompatible declarations for the same interface seam at high risk", () => {
    const seam = interfaceContract("TaskStore");
    const contracts = {
      producer: contract("producer", {
        paths: ["src/store.ts"],
        changedFiles: ["src/store.ts"],
        producedInterfaces: [seam]
      }),
      consumer: contract("consumer", {
        paths: ["src/view.ts"],
        changedFiles: ["src/view.ts"],
        consumedInterfaces: [{ ...seam, signature: "type TaskStore = { id: number }" }]
      })
    };
    const safety = buildSchedulingSafetyContext({
      graph: graphFor(contracts),
      contracts,
      policy: "risk_aware"
    });
    const prediction = findRiskPrediction(safety.riskMatrix, "producer", "consumer");

    expect(prediction?.level).toBe("high");
    expect(prediction?.explanation).toContain("incompatible declarations");
  });

  it("missing repository index falls back to contract heuristics with an auditable warning", () => {
    const contracts = {
      a: contract("a", { paths: ["src/a/**"], changedFiles: ["src/a.ts"] }),
      b: contract("b", { paths: ["src/b/**"], changedFiles: ["src/b.ts"] })
    };
    const safety = buildSchedulingSafetyContext({
      graph: graphFor(contracts),
      contracts,
      policy: "risk_aware"
    });

    expect(safety.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing_repository_index" })
      ])
    );
  });

  it("repository index import relation raises risk between exporter and consumer", () => {
    const contracts = {
      exporter: contract("exporter", {
        paths: ["src/api.ts"],
        changedFiles: ["src/api.ts"],
        producedSymbols: ["ApiClient"]
      }),
      consumer: contract("consumer", {
        paths: ["src/feature.ts"],
        changedFiles: ["src/feature.ts"],
        consumedSymbols: ["ApiClient"]
      })
    };
    const matrix = buildRepositoryAwareRiskMatrix({ contracts, repositoryIndex: repositoryIndex() });
    const prediction = findRiskPrediction(matrix, "exporter", "consumer");

    expect(prediction?.level).toBe("high");
    expect(prediction?.evidence.map((item) => item.signal)).toEqual(
      expect.arrayContaining(["static_import_dependency", "static_producer_consumer_symbol"])
    );
    expect(prediction?.explanation).toContain("imports src/api.ts");
  });

  it("scheduler serializes by enriched repository-index risk even when scopes are disjoint", () => {
    const contracts = {
      exporter: contract("exporter", {
        paths: ["src/api.ts"],
        changedFiles: ["src/api.ts"],
        producedSymbols: ["ApiClient"]
      }),
      consumer: contract("consumer", {
        paths: ["src/feature.ts"],
        changedFiles: ["src/feature.ts"],
        consumedSymbols: ["ApiClient"]
      })
    };
    const graph = graphFor(contracts);
    const staticSignals = buildStaticConflictSignals({ contracts, repositoryIndex: repositoryIndex() });
    const safety = buildSchedulingSafetyContext({ graph, contracts, staticSignals, policy: "risk_aware" });
    const plan = scheduleTasks({
      graph,
      contracts,
      riskMatrix: safety.riskMatrix,
      staticSignals,
      maxParallel: 2,
      policy: "risk_aware"
    });

    expect(findRiskPrediction(safety.riskMatrix, "exporter", "consumer")?.evidence.map((item) => item.signal)).toContain(
      "static_import_dependency"
    );
    expect(plan.batches.some((batch) => batch.taskIds.includes("exporter") && batch.taskIds.includes("consumer"))).toBe(false);
    expect(plan.batches.flatMap((batch) => batch.taskIds).sort()).toEqual(["consumer", "exporter"]);
    expect(safety.warnings.map((warning) => warning.code)).not.toContain("missing_repository_index");
  });
});

function contract(
  taskId: string,
  input: {
    paths: string[];
    changedFiles: string[];
    producedSymbols?: string[];
    consumedSymbols?: string[];
    producedInterfaces?: InterfaceContract[];
    consumedInterfaces?: InterfaceContract[];
  }
): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: input.paths },
    forbidden: { paths: [] },
    relevantSymbols: [...(input.producedSymbols ?? []), ...(input.consumedSymbols ?? [])],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: {
      changedFiles: input.changedFiles,
      producedSymbols: input.producedSymbols ?? [],
      consumedSymbols: input.consumedSymbols ?? [],
      diffShapeHint: "diff"
    },
    limits: { maxDurationMs: 60_000, maxCostUsd: 0 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: input.paths, testPaths: [], configPaths: [] },
    ...(input.producedInterfaces !== undefined ? { producedInterfaces: input.producedInterfaces } : {}),
    ...(input.consumedInterfaces !== undefined ? { consumedInterfaces: input.consumedInterfaces } : {})
  });
}

function interfaceContract(id: string): InterfaceContract {
  return {
    id,
    kind: "type",
    signature: `type ${id} = { id: string }`,
    description: `${id} seam`,
    definedAtNodeId: "root"
  };
}

function graphFor(contracts: Record<string, AgentTaskContract>): TaskGraph {
  const leaves = Object.values(contracts).map((item): TaskNode => ({
    id: item.taskId,
    parentId: "root",
    kind: "leaf",
    title: item.taskId,
    goal: item.objective,
    status: "planned",
    granularity: "auto",
    depth: 1,
    childrenIds: [],
    dependencies: [],
    contract: item
  }));
  const root: TaskNode = {
    id: "root",
    parentId: null,
    kind: "root",
    title: "root",
    goal: "root",
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
    baseCommit: "BASE",
    featureRequest: "feature",
    rootId: "root",
    createdAt: "2026-06-18T00:00:00.000Z",
    nodes: Object.fromEntries([root, ...leaves].map((node) => [node.id, node])),
    dependencies: []
  };
}

function repositoryIndex(): RepositoryIndex {
  return {
    repositoryId: "repo",
    rootPath: "/repo",
    indexedAt: "2026-06-18T00:00:00.000Z",
    files: [
      {
        path: "src/api.ts",
        kind: "source",
        declaredSymbols: ["ApiClient"],
        exportedSymbols: ["ApiClient"],
        importedSymbols: []
      },
      {
        path: "src/feature.ts",
        kind: "source",
        declaredSymbols: ["Feature"],
        exportedSymbols: ["Feature"],
        importedSymbols: ["ApiClient"]
      }
    ],
    symbols: [
      { name: "ApiClient", kind: "type", filePath: "src/api.ts", exported: true, line: 1 },
      { name: "Feature", kind: "function", filePath: "src/feature.ts", exported: true, line: 3 }
    ],
    imports: [
      {
        filePath: "src/feature.ts",
        moduleSpecifier: "./api",
        importedSymbols: ["ApiClient"]
      }
    ],
    exports: [
      { filePath: "src/api.ts", exportedSymbols: ["ApiClient"] },
      { filePath: "src/feature.ts", exportedSymbols: ["Feature"] }
    ],
    diagnostics: [],
    metadata: {
      indexer: "test",
      deterministic: true,
      fileCount: 2,
      symbolCount: 2,
      importCount: 1,
      exportCount: 2
    }
  };
}
