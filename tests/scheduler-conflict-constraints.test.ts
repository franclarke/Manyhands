import { selectReadyWaveV2 } from "@manyhands/scheduler";
import { describe, it, expect } from "vitest";

describe("selectReadyWaveV2 - ConflictConstraints", () => {
  const baseGraph = {
    schemaVersion: 2,
    graphId: "graph-1",
    revision: 1,
    rootId: "root",
    baseCommit: "commit1",
    repositorySnapshotId: "snap",
    nodes: {
      A: { id: "A", parentId: null, kind: "leaf", title: "A", goal: "A" },
      B: { id: "B", parentId: null, kind: "leaf", title: "B", goal: "B" },
      C: { id: "C", parentId: null, kind: "leaf", title: "C", goal: "C" }
    },
    artifactRequirements: [],
    seamBindings: [],
    conflictConstraints: [],
    legacyOrderingConstraints: [],
    createdAt: "2026-07-22T00:00:00Z"
  } as any;

  const baseState = {
    adoptedArtifacts: [],
    pendingDecisions: [],
    materializableNodeIds: ["A", "B", "C"],
    activeResourceNodeIds: [],
    budgetAvailable: true,
    availableExecutorNodeIds: ["A", "B", "C"],
    adoptedNodeIds: [],
    currentContractRevisions: {},
    requiredContractRevisions: {}
  };

  it("1. selects multiple nodes when no conflicts exist", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["A", "B"],
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: []
    });
    expect(result.nodeIds).toEqual(["A", "B"]);
  });

  it("2. defers node when explicit graph constraint exists", () => {
    const result = selectReadyWaveV2({
      graph: {
        ...baseGraph,
        conflictConstraints: [{ id: "c1", leftNodeId: "A", rightNodeId: "B", reason: "test", risk: "high" }]
      },
      nodeIds: ["A", "B"],
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: []
    });
    expect(result.nodeIds).toEqual(["A"]);
    const deferredB = result.explanations.find(e => e.nodeId === "B");
    expect(deferredB?.deferred).toBe(true);
  });

  it("3. handles inverted constraints correctly", () => {
    const result = selectReadyWaveV2({
      graph: {
        ...baseGraph,
        conflictConstraints: [{ id: "c1", leftNodeId: "B", rightNodeId: "A", reason: "test", risk: "high" }]
      },
      nodeIds: ["A", "B"],
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: []
    });
    expect(result.nodeIds).toEqual(["A"]);
  });

  it("4. applies constraints from external input (conflict-risk evidence)", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["A", "B"],
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{ id: "e1", leftNodeId: "A", rightNodeId: "B", risk: "blocking", type: "conflict", providerId: "p", evidenceIds: [] } as any]
    });
    expect(result.nodeIds).toEqual(["A"]);
  });

  it("5. defers node when active resource conflict exists", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["B"],
      state: { ...baseState, activeResourceNodeIds: ["A"] },
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{ id: "e1", leftNodeId: "B", rightNodeId: "A", risk: "high", type: "conflict", providerId: "p", evidenceIds: [] } as any]
    });
    expect(result.nodeIds).toEqual([]);
    expect(result.explanations.find(e => e.nodeId === "B")?.deferred).toBe(true);
  });

  it("6. ignores low risk conflicts", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["A", "B"],
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{ id: "e1", leftNodeId: "A", rightNodeId: "B", risk: "low", type: "conflict", providerId: "p", evidenceIds: [] } as any]
    });
    expect(result.nodeIds).toEqual(["A", "B"]);
  });

  it("7. enforces deterministic selection using localeCompare", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["B", "A"], // B comes first in input
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{ id: "e1", leftNodeId: "B", rightNodeId: "A", risk: "high", type: "conflict", providerId: "p", evidenceIds: [] } as any]
    });
    // Because it sorts by localeCompare, A should be selected and B deferred
    expect(result.nodeIds).toEqual(["A"]);
  });

  it("8. respects maxParallel with no conflicts", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["A", "B", "C"],
      state: baseState,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: []
    });
    expect(result.nodeIds).toEqual(["A", "B"]);
  });

  it("9. allows node when active node finishes (wave posterior)", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["B"],
      state: { ...baseState, activeResourceNodeIds: [] }, // A finished
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{ id: "e1", leftNodeId: "A", rightNodeId: "B", risk: "high", type: "conflict", providerId: "p", evidenceIds: [] } as any]
    });
    expect(result.nodeIds).toEqual(["B"]);
  });

  it("10. defers multiple nodes colliding with a single selected one", () => {
    const result = selectReadyWaveV2({
      graph: baseGraph,
      nodeIds: ["A", "B", "C"],
      state: baseState,
      effectiveConfig: { maxParallel: 3 },
      conflictConstraints: [
        { id: "e1", leftNodeId: "A", rightNodeId: "B", risk: "high", type: "conflict", providerId: "p", evidenceIds: [] } as any,
        { id: "e2", leftNodeId: "A", rightNodeId: "C", risk: "high", type: "conflict", providerId: "p", evidenceIds: [] } as any
      ]
    });
    expect(result.nodeIds).toEqual(["A"]);
    expect(result.explanations.find(e => e.nodeId === "B")?.deferred).toBe(true);
    expect(result.explanations.find(e => e.nodeId === "C")?.deferred).toBe(true);
  });
});
