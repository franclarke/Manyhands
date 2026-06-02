import { beforeAll, describe, expect, it } from "vitest";
import { runBenchmarkMockFlow, type RunSnapshot } from "@manyhands/core";
import {
  buildInspectorView,
  toRunGraphViewModel,
  type RunGraphViewModel
} from "@/lib/graph-view-model";
import {
  EMPTY_FILTERS,
  filtersAreEmpty,
  nodeMatchesFilters,
  toggleSetValue,
  visibleNodeIds
} from "@/lib/graph-filters";

describe("graph-view-model", () => {
  let conflictSnapshot: RunSnapshot;
  let mockSnapshot: RunSnapshot;
  let conflictGraph: RunGraphViewModel;

  beforeAll(async () => {
    const conflictResult = await runBenchmarkMockFlow({
      manifestPath: "benchmarks/conflict-v0/benchmark.json",
      featureIds: ["shared-schema-conflict"],
      configurationIds: ["B4"],
      createdAt: "1970-01-01T00:00:00.000Z"
    });
    const mockResult = await runBenchmarkMockFlow({
      manifestPath: "benchmarks/mock-v0/benchmark.json",
      featureIds: ["passwordless-login"],
      configurationIds: ["B3"],
      createdAt: "1970-01-01T00:00:00.000Z"
    });

    const firstConflict = conflictResult.snapshots[0];
    const firstMock = mockResult.snapshots[0];

    if (!firstConflict || !firstMock) {
      throw new Error("Benchmark flow did not produce expected snapshots");
    }

    conflictSnapshot = firstConflict;
    mockSnapshot = firstMock;
    conflictGraph = toRunGraphViewModel(conflictSnapshot);
  });

  describe("toRunGraphViewModel", () => {
    it("maps RunSnapshot into typed nodes and edges", () => {
      expect(conflictGraph.runId).toBe(conflictSnapshot.runId);
      expect(conflictGraph.featureId).toBe(conflictSnapshot.featureId);
      expect(conflictGraph.mode).toBe(conflictSnapshot.decompositionMode);
      expect(conflictGraph.deterministic).toBe(true);
      expect(conflictGraph.schemaVersion).toBe(conflictSnapshot.metadata.schemaVersion);
      expect(conflictGraph.nodes.length).toBe(Object.keys(conflictSnapshot.graphSnapshot.nodes).length);
      expect(conflictGraph.summary.taskCount).toBe(conflictGraph.nodes.length);
      expect(conflictGraph.summary.dependencyCount).toBe(conflictSnapshot.graphSnapshot.dependencies.length);
      expect(conflictGraph.summary.riskCount).toBe(conflictSnapshot.riskPredictions.length);
      expect(conflictGraph.summary.traceEventCount).toBe(conflictSnapshot.traceEvents.length);
    });

    it("emits dependency edges for every snapshot dependency", () => {
      const dependencyEdges = conflictGraph.edges.filter((edge) => edge.kind === "dependency");
      expect(dependencyEdges).toHaveLength(conflictSnapshot.graphSnapshot.dependencies.length);
      for (const edge of dependencyEdges) {
        expect(edge.source).toBeTruthy();
        expect(edge.target).toBeTruthy();
      }
    });

    it("emits risk edges from riskPredictions with their level", () => {
      const riskEdges = conflictGraph.edges.filter((edge) => edge.kind === "risk");
      expect(riskEdges.length).toBe(conflictSnapshot.riskPredictions.length);
      for (const edge of riskEdges) {
        expect(edge.riskLevel).toMatch(/^(low|medium|high|blocking)$/);
      }
    });

    it("derives status counts that sum to the task count", () => {
      const total = Object.values(conflictGraph.status).reduce((sum, count) => sum + count, 0);
      expect(total).toBe(conflictGraph.summary.taskCount);
    });

    it("marks executable nodes ready when their dependencies are satisfied", () => {
      const snapshot = structuredClone(mockSnapshot) as RunSnapshot;
      const leaves = Object.values(snapshot.graphSnapshot.nodes)
        .filter((node) => node.kind === "leaf")
        .slice(0, 2);
      const first = leaves[0];
      const second = leaves[1];
      expect(first).toBeDefined();
      expect(second).toBeDefined();
      if (first === undefined || second === undefined) return;

      snapshot.agentRunResults = [];
      snapshot.blockedTasks = [];
      snapshot.graphSnapshot.dependencies = [
        {
          fromTaskId: first.id,
          toTaskId: second.id,
          type: "logical",
          inferred: false,
          rationale: "Second task waits for the first."
        }
      ];
      for (const node of Object.values(snapshot.graphSnapshot.nodes)) {
        node.status = "planned";
        node.dependencies = node.id === second.id ? [first.id] : [];
      }

      const pendingGraph = toRunGraphViewModel(snapshot);
      expect(pendingGraph.nodes.find((node) => node.id === first.id)?.status).toBe("ready");
      expect(pendingGraph.nodes.find((node) => node.id === second.id)?.status).toBe("planned");

      snapshot.graphSnapshot.nodes[first.id]!.status = "done";

      const unblockedGraph = toRunGraphViewModel(snapshot);
      expect(unblockedGraph.nodes.find((node) => node.id === second.id)?.status).toBe("ready");
    });

    it("normalizes legacy TaskNodeStatus values into the UI palette", () => {
      const allowedStatuses = new Set([
        "planned",
        "ready",
        "running",
        "gated",
        "done",
        "failed",
        "blocked"
      ]);
      for (const node of conflictGraph.nodes) {
        expect(allowedStatuses.has(node.status)).toBe(true);
      }
    });

    it("flags gate required nodes on the conflict B4 snapshot", () => {
      const gateNodes = conflictGraph.nodes.filter((node) => node.gateRequired === true);
      expect(gateNodes.length).toBeGreaterThan(0);
    });

    it("attaches risk level to nodes involved in risk predictions", () => {
      for (const prediction of conflictSnapshot.riskPredictions) {
        const a = conflictGraph.nodes.find((node) => node.id === prediction.taskAId);
        const b = conflictGraph.nodes.find((node) => node.id === prediction.taskBId);
        expect(a?.riskLevel).toBeDefined();
        expect(b?.riskLevel).toBeDefined();
      }
    });

    it("falls back to the node title for legacy snapshots without goal or objective", () => {
      const legacySnapshot = structuredClone(mockSnapshot) as RunSnapshot;
      const firstTaskId = Object.keys(legacySnapshot.graphSnapshot.nodes)[0];
      expect(firstTaskId).toBeDefined();
      if (firstTaskId === undefined) return;

      const node = legacySnapshot.graphSnapshot.nodes[firstTaskId] as Record<string, unknown>;
      node.goal = undefined;
      node.title = "Legacy title fallback";

      const contract = legacySnapshot.contracts.find((entry) => entry.taskId === firstTaskId);
      if (contract !== undefined) {
        (contract as Record<string, unknown>).objective = undefined;
      }

      const graph = toRunGraphViewModel(legacySnapshot);
      expect(graph.nodes.find((entry) => entry.id === firstTaskId)?.description).toBe(
        "Legacy title fallback"
      );
    });
  });

  describe("buildInspectorView", () => {
    it("returns null for unknown task id", () => {
      expect(buildInspectorView(conflictSnapshot, "does-not-exist")).toBeNull();
    });

    it("exposes contract data for a leaf task", () => {
      const leafNode = conflictGraph.nodes.find((node) => node.kind === "leaf");
      expect(leafNode).toBeDefined();
      if (!leafNode) return;

      const view = buildInspectorView(conflictSnapshot, leafNode.id);
      expect(view).not.toBeNull();
      expect(view!.taskId).toBe(leafNode.id);
      expect(view!.title).toBe(leafNode.title);
      expect(view!.contract).toBeDefined();
      expect(view!.contract!.objective.length).toBeGreaterThan(0);
      expect(view!.contract!.definitionOfDone.length).toBeGreaterThan(0);
      expect(view!.contract!.allowedPaths.length).toBeGreaterThan(0);
    });

    it("exposes optional execution-core V2 contract fields", () => {
      const snapshot = structuredClone(mockSnapshot) as RunSnapshot;
      const contract = snapshot.contracts[0];
      expect(contract).toBeDefined();
      if (contract === undefined) return;

      contract.executionScope = {
        implementationPaths: ["src/**/*.ts"],
        testPaths: ["tests/**/*.test.ts"],
        configPaths: ["package.json"]
      };
      contract.forbiddenPaths = ["dist/**"];
      contract.leafValidationCommands = [
        { command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }
      ];
      contract.parentValidationCommands = [
        { command: "pnpm", args: ["build"], timeoutMs: 120_000, cwd: "repo-root" }
      ];
      contract.runValidationCommands = [
        { command: "pnpm", args: ["typecheck"], timeoutMs: 120_000, cwd: "repo-root" }
      ];
      contract.consumedInterfaces = [
        {
          id: "TaskStore",
          kind: "type",
          signature: "interface TaskStore {}",
          description: "Store consumed by this task.",
          definedAtNodeId: "root"
        }
      ];
      contract.producedInterfaces = [
        {
          id: "TaskService",
          kind: "function",
          signature: "function createTask(): Task",
          description: "Service produced by this task."
        }
      ];

      const view = buildInspectorView(snapshot, contract.taskId);

      expect(view?.contract?.executionScope?.implementationPaths).toEqual(["src/**/*.ts"]);
      expect(view?.contract?.explicitForbiddenPaths).toEqual(["dist/**"]);
      expect(view?.contract?.leafValidationCommands?.[0]?.command).toBe("pnpm");
      expect(view?.contract?.parentValidationCommands?.[0]?.cwd).toBe("repo-root");
      expect(view?.contract?.runValidationCommands?.[0]?.args).toEqual(["typecheck"]);
      expect(view?.contract?.consumedInterfaces[0]?.id).toBe("TaskStore");
      expect(view?.contract?.producedInterfaces[0]?.id).toBe("TaskService");
    });

    it("keeps V2 inspector contract fields empty for legacy contracts", () => {
      const legacySnapshot = structuredClone(conflictSnapshot) as RunSnapshot;
      for (const contract of legacySnapshot.contracts) {
        delete contract.executionScope;
        delete contract.forbiddenPaths;
        delete contract.leafValidationCommands;
        delete contract.parentValidationCommands;
        delete contract.runValidationCommands;
        delete contract.consumedInterfaces;
        delete contract.producedInterfaces;
      }
      const legacyGraph = toRunGraphViewModel(legacySnapshot);
      const leafNode = legacyGraph.nodes.find((node) => node.kind === "leaf");
      expect(leafNode).toBeDefined();
      if (!leafNode) return;

      const view = buildInspectorView(legacySnapshot, leafNode.id);

      expect(view?.contract?.executionScope).toBeUndefined();
      expect(view?.contract?.leafValidationCommands).toBeUndefined();
      expect(view?.contract?.consumedInterfaces).toEqual([]);
      expect(view?.contract?.producedInterfaces).toEqual([]);
    });

    it("returns trace events filtered to the task", () => {
      const taskWithTrace = conflictSnapshot.traceEvents.find((event) => event.taskId !== undefined);
      expect(taskWithTrace?.taskId).toBeDefined();
      if (!taskWithTrace?.taskId) return;

      const view = buildInspectorView(conflictSnapshot, taskWithTrace.taskId);
      expect(view).not.toBeNull();
      expect(view!.traceEvents.length).toBeGreaterThan(0);
      for (const entry of view!.traceEvents) {
        expect(entry.id).toBeTruthy();
        expect(entry.type).toBeTruthy();
      }
    });
  });

  describe("graph-filters", () => {
    it("EMPTY_FILTERS produces filtersAreEmpty=true", () => {
      expect(filtersAreEmpty(EMPTY_FILTERS)).toBe(true);
    });

    it("nodeMatchesFilters honors text search on title and id", () => {
      const node = conflictGraph.nodes[0];
      expect(node).toBeDefined();
      if (!node) return;

      const idMatch = nodeMatchesFilters(node, { ...EMPTY_FILTERS, text: node.id.slice(0, 4) });
      const titleMatch = nodeMatchesFilters(node, { ...EMPTY_FILTERS, text: node.title.slice(0, 4) });
      const noMatch = nodeMatchesFilters(node, { ...EMPTY_FILTERS, text: "zzz-not-matching-zzz" });
      expect(idMatch).toBe(true);
      expect(titleMatch).toBe(true);
      expect(noMatch).toBe(false);
    });

    it("toggleSetValue inserts and removes", () => {
      const start = new Set<string>(["a"]);
      const withB = toggleSetValue(start, "b");
      expect(withB.has("b")).toBe(true);
      const withoutA = toggleSetValue(withB, "a");
      expect(withoutA.has("a")).toBe(false);
      expect(withoutA.has("b")).toBe(true);
    });

    it("visibleNodeIds shrinks the set when status filter is set", () => {
      const allIds = new Set(conflictGraph.nodes.map((node) => node.id));
      const ready = visibleNodeIds(conflictGraph.nodes, {
        ...EMPTY_FILTERS,
        statuses: new Set(["ready"])
      });
      expect(ready.size).toBeLessThanOrEqual(allIds.size);
      for (const id of ready) {
        const node = conflictGraph.nodes.find((n) => n.id === id);
        expect(node?.status).toBe("ready");
      }
    });

    it("gateOnly filter keeps only gate-required nodes", () => {
      const matched = visibleNodeIds(conflictGraph.nodes, {
        ...EMPTY_FILTERS,
        gateOnly: true
      });
      for (const id of matched) {
        const node = conflictGraph.nodes.find((n) => n.id === id);
        expect(node?.gateRequired).toBe(true);
      }
    });
  });

  describe("mock-v0 sanity", () => {
    it("maps a non-conflict snapshot without throwing", () => {
      const graph = toRunGraphViewModel(mockSnapshot);
      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.summary.dependencyCount).toBe(mockSnapshot.graphSnapshot.dependencies.length);
    });
  });
});
