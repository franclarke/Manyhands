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
      const total =
        conflictGraph.status.planned +
        conflictGraph.status.ready +
        conflictGraph.status.running +
        conflictGraph.status.gated +
        conflictGraph.status.done +
        conflictGraph.status.failed +
        conflictGraph.status.blocked;
      expect(total).toBe(conflictGraph.summary.taskCount);
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
