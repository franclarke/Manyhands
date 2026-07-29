import { describe, expect, it } from "vitest";
import { selectReadyWaveV2 } from "@manyhands/scheduler";
import { RunEventSchema, foldRun } from "@manyhands/run-coordinator";

const graph = {
  schemaVersion: 2,
  graphId: "graph-1",
  revision: 1,
  rootId: "root",
  baseCommit: "commit-1",
  repositorySnapshotId: "snapshot-1",
  nodes: {
    A: { id: "A", parentId: null, kind: "leaf", title: "A", goal: "A" },
    B: { id: "B", parentId: null, kind: "leaf", title: "B", goal: "B" }
  },
  artifactRequirements: [],
  seamBindings: [],
  conflictConstraints: [],
  legacyOrderingConstraints: [],
  createdAt: "2026-07-29T12:00:00.000Z"
} as any;

const state = {
  adoptedArtifacts: [],
  pendingDecisions: [],
  materializableNodeIds: ["A", "B"],
  activeResourceNodeIds: [],
  budgetAvailable: true,
  availableExecutorNodeIds: ["A", "B"],
  adoptedNodeIds: [],
  currentContractRevisions: {},
  requiredContractRevisions: {}
};

describe("causal recovery and durable scheduling", () => {
  it("ignores expired conflict evidence when recalculating a wave", () => {
    const result = selectReadyWaveV2({
      graph,
      nodeIds: ["A", "B"],
      state,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{
        id: "expired",
        leftNodeId: "A",
        rightNodeId: "B",
        reason: "old lock",
        risk: "high",
        signals: [{ type: "resource_lock", detail: "old lock" }],
        confidence: 1,
        observedAt: "2026-07-28T12:00:00.000Z",
        expiresAt: "2026-07-29T11:00:00.000Z"
      } as any],
      now: "2026-07-29T12:00:00.000Z"
    } as any);

    expect(result.nodeIds).toEqual(["A", "B"]);

    const conservativeWithoutClock = selectReadyWaveV2({
      graph,
      nodeIds: ["A", "B"],
      state,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{
        id: "expired-without-clock",
        leftNodeId: "A",
        rightNodeId: "B",
        reason: "must not be evaluated without a cursor",
        risk: "high",
        signals: [],
        confidence: 1,
        observedAt: "2026-07-28T12:00:00.000Z",
        expiresAt: "2026-07-29T11:00:00.000Z"
      } as any]
    } as any);
    expect(conservativeWithoutClock.nodeIds).toEqual(["A"]);
  });

  it("does not serialize an advisory signal or dispatch through an open circuit breaker", () => {
    const advisory = selectReadyWaveV2({
      graph,
      nodeIds: ["A", "B"],
      state,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{
        id: "advisory",
        leftNodeId: "A",
        rightNodeId: "B",
        reason: "observe only",
        risk: "high",
        mode: "advisory",
        signals: [{ type: "history", detail: "observe only" }],
        confidence: 1,
        observedAt: "2026-07-29T12:00:00.000Z",
        expiresAt: "2026-07-30T12:00:00.000Z"
      } as any]
    } as any);
    expect(advisory.nodeIds).toEqual(["A", "B"]);

    const breaker = selectReadyWaveV2({
      graph,
      nodeIds: ["A"],
      state: { ...state, openCircuitBreakerNodeIds: ["A"] },
      effectiveConfig: { maxParallel: 1 },
      conflictConstraints: []
    } as any);
    expect(breaker.nodeIds).toEqual([]);
    expect(breaker.explanations[0]?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "circuit_breaker_open" })
    ]));

    const resourceLock = selectReadyWaveV2({
      graph,
      nodeIds: ["A", "B"],
      state,
      effectiveConfig: { maxParallel: 2 },
      conflictConstraints: [{
        id: "named-lock",
        leftNodeId: "A",
        rightNodeId: "B",
        reason: "same external account",
        risk: "high",
        mode: "resource_lock",
        resourceId: "account:shared",
        signals: [{ type: "resource_lock", detail: "same external account" }],
        confidence: 1,
        observedAt: "2026-07-29T12:00:00.000Z",
        expiresAt: "2026-07-30T12:00:00.000Z"
      } as any],
      now: "2026-07-29T12:00:00.000Z"
    } as any);
    expect(resourceLock.nodeIds).toEqual(["A"]);

    const stoppedBranch = selectReadyWaveV2({
      graph: { ...graph, nodes: { ...graph.nodes, C: { id: "C", parentId: "A", kind: "leaf", title: "C", goal: "C" } } },
      nodeIds: ["C"],
      state: { ...state, stoppedNodeIds: ["A"] },
      effectiveConfig: { maxParallel: 1 },
      conflictConstraints: []
    } as any);
    expect(stoppedBranch.nodeIds).toEqual([]);
    expect(stoppedBranch.explanations[0]?.reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "branch_stopped" })
    ]));
  });

  it("replays the readiness explanations and effective scheduling inputs", () => {
    const events = [
      RunEventSchema.parse({ eventId: "created", runId: "run-1", sequence: 1, occurredAt: "2026-07-29T12:00:00.000Z", type: "run.created", payload: { goal: "test" } }),
      RunEventSchema.parse({ eventId: "proposed", runId: "run-1", sequence: 2, occurredAt: "2026-07-29T12:00:00.000Z", type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } }),
      RunEventSchema.parse({ eventId: "approved", runId: "run-1", sequence: 3, occurredAt: "2026-07-29T12:00:00.000Z", type: "graph.revision.approved", payload: { graphId: "graph-1", revision: 1 } }),
      RunEventSchema.parse({
        eventId: "readiness",
        runId: "run-1",
        sequence: 4,
        occurredAt: "2026-07-29T12:00:00.000Z",
        type: "readiness.observed",
        payload: {
          readyNodeIds: ["A"],
          pendingDecisionIds: [],
          explanations: [{ nodeId: "B", ready: false, reasons: [{ code: "budget_exhausted" }] }],
          effectiveConfig: { maxParallel: 2, maxTokensTotal: 100 },
          budgetAvailable: false,
          conflictEvidence: [{ id: "risk-1", leftNodeId: "A", rightNodeId: "B", reason: "shared resource", risk: "high", mode: "serialize" }],
          evaluatedAt: "2026-07-29T12:00:00.000Z"
        }
      })
    ];

    const state = foldRun(events);
    expect(state.readiness).toMatchObject({
      readyNodeIds: ["A"],
      budgetAvailable: false,
      effectiveConfig: { maxTokensTotal: 100 },
      evaluatedAt: "2026-07-29T12:00:00.000Z"
    });
    expect(state.readiness.explanations).toEqual([
      { nodeId: "B", ready: false, reasons: [{ code: "budget_exhausted" }] }
    ]);
  });
});
