import { describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import {
  RunCoordinator,
  RunEventSchema,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";
import {
  V2ExecutionDriver,
  type V2NodeExecutionInput,
  type V2NodeExecutionOutcome
} from "@manyhands/orchestrator-graph";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures";

const at = "2026-07-17T12:00:00.000Z";

describe("V2ExecutionDriver", () => {
  it("refreshes scheduler capabilities with the inputs that replace a stale attempt", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const revisedContracts = structuredClone(compiled.contracts);
    const revisedApi = revisedContracts.find((bundle) => bundle.task.nodeId === "node-api")!;
    revisedApi.validation.revision = "validation-r2";
    revisedApi.task.validation.revision = "validation-r2";
    let currentContracts = compiled.contracts;
    let availableExecutorNodeIds = ["node-api"];
    const executed: string[] = [];
    const harness = coordinatorHarness(compiled.graph.graphId);
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: async () => ({
        graph: compiled.graph,
        contracts: currentContracts,
        repositoryContextDigest: "sha256:repository",
        executorProfile: { id: "claude-code-cli", revision: "sonnet" },
        materializableNodeIds: Object.keys(compiled.graph.nodes),
        availableExecutorNodeIds,
        conflictConstraints: []
      }),
      execute: async (input) => {
        executed.push(input.node.id);
        if (executed.length === 1) {
          currentContracts = revisedContracts;
          availableExecutorNodeIds = Object.keys(compiled.graph.nodes);
        }
        return {
          ...(success(input) as Extract<V2NodeExecutionOutcome, { kind: "success" }>),
          ...(input.node.id === compiled.graph.rootId
            ? { integrationManifestId: "integration-root", finalManifestId: "fresh-capabilities-final" }
            : {})
        };
      }
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: ["node-api"],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(executed.filter((nodeId) => nodeId === "node-api")).toHaveLength(2);
    expect(new Set(executed)).toEqual(new Set(Object.keys(compiled.graph.nodes)));
    expect(state.lifecycle).toBe("result_ready");
  });

  it("marks a result stale when a material contract changes while its attempt is running", async () => {
    const breakdown = bookingBreakdown();
    if (breakdown.root.kind !== "composite") throw new Error("Fixture must start composite.");
    const domain = breakdown.root.children.find((unit) => unit.key === "domain");
    if (domain?.kind !== "leaf") throw new Error("Missing atomic domain leaf.");
    breakdown.root = domain;
    breakdown.acceptanceIntents = breakdown.acceptanceIntents.filter((intent) => intent.id === "domain-ready");
    breakdown.candidateSeams = [];
    const atomic = compileGraphRevision(
      { breakdown, repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(atomic.graph.graphId);
    const revisedContracts = structuredClone(atomic.contracts);
    revisedContracts[0]!.validation.revision = "validation-r2";
    revisedContracts[0]!.task.validation.revision = "validation-r2";
    let currentContracts = atomic.contracts;
    let executions = 0;
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: async () => ({
        graph: atomic.graph,
        contracts: currentContracts,
        repositoryContextDigest: "sha256:repository",
        executorProfile: { id: "claude-code-cli", revision: "sonnet" },
        materializableNodeIds: Object.keys(atomic.graph.nodes),
        availableExecutorNodeIds: Object.keys(atomic.graph.nodes),
        conflictConstraints: []
      }),
      execute: async (input) => {
        executions += 1;
        if (executions === 1) currentContracts = revisedContracts;
        return {
          ...(success(input) as Extract<V2NodeExecutionOutcome, { kind: "success" }>),
          finalManifestId: "fresh-final"
        };
      }
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: atomic.graph,
      contracts: atomic.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [atomic.graph.rootId],
      availableExecutorNodeIds: [atomic.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    const attempts = Object.values(state.attempts);
    expect(attempts).toEqual([
      expect.objectContaining({ status: "stale" }),
      expect.objectContaining({ status: "adopted" })
    ]);
    expect(Object.values(state.adoptedArtifacts)).toEqual([
      expect.objectContaining({ producerAttemptId: attempts[1]!.attemptId })
    ]);
    expect(Object.values(state.adoptedArtifacts).some(
      (artifact) => artifact.producerAttemptId === attempts[0]!.attemptId
    )).toBe(false);
    expect(harness.events().some((event) => event.type === "attempt.stale")).toBe(true);
    expect(state.finalCandidate).toMatchObject({ manifestId: "fresh-final" });
  });

  it("executes seam siblings together, adopts exact artifacts and integrates the root bottom-up", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    const dispatches: V2NodeExecutionInput[] = [];
    const ordering: string[] = [];
    harness.onAppend((events) => {
      for (const event of events) ordering.push(`event:${event.type}`);
    });
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input): Promise<V2NodeExecutionOutcome> => {
        ordering.push(`execute:${input.node.id}`);
        dispatches.push(input);
        const obligation = input.contract.validation.obligations[0]!;
        return {
          kind: "success",
          candidateCommit: `commit-${input.node.id}`,
          outputDigest: `sha256:${input.node.id}`,
          changedFiles: [...input.contract.scope.allowedPaths],
          evidenceMatrix: {
            matrixId: `matrix-${input.node.id}`,
            candidateCommit: `commit-${input.node.id}`,
            validationContract: {
              id: input.contract.validation.id,
              revision: input.contract.validation.revision
            },
            criteria: [{
              criterionId: obligation.criterionId,
              obligationId: obligation.id,
              status: "satisfied",
              justification: "Exact candidate evidence passed.",
              evidenceRefs: [`evidence-${input.node.id}`]
            }],
            outcome: "verified"
          },
          artifactLocation: `commit-${input.node.id}`,
          ...(input.node.id === compiled.graph.rootId
            ? { integrationManifestId: "integration-root", finalManifestId: "final-root" }
            : {})
        };
      }
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: {
        sourceTargetFingerprint: "sha256:target",
        targetBranch: "main",
        targetHead: "base-head"
      }
    });

    expect(dispatches.slice(0, 3).map((input) => input.node.id).sort()).toEqual([
      "node-api",
      "node-domain",
      "node-ui"
    ]);
    const rootDispatch = dispatches.at(-1)!;
    expect(rootDispatch.node.id).toBe(compiled.graph.rootId);
    expect(rootDispatch.consumedArtifacts).toHaveLength(3);
    expect(state.lifecycle).toBe("result_ready");
    expect(state.finalCandidate).toMatchObject({ manifestId: "final-root", commit: `commit-${compiled.graph.rootId}` });
    expect(Object.keys(state.adoptedArtifacts)).toHaveLength(4);

    const firstExecute = ordering.findIndex((item) => item.startsWith("execute:"));
    expect(ordering.slice(0, firstExecute)).toEqual(expect.arrayContaining([
      "event:wave.selected",
      "event:attempt.started"
    ]));
  });

  it("keeps an independent sibling running when another node raises a local decision", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => input.node.id === "node-api"
        ? { kind: "failure", reason: "API needs a product decision." }
        : success(input)
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.nodeId).sort()).toEqual([
      "node-domain",
      "node-ui"
    ]);
    expect(Object.values(state.decisions)).toEqual([
      expect.objectContaining({ status: "pending", affectedNodeIds: ["node-api"] })
    ]);
    expect(state.lifecycle).toBe("waiting_for_input");
  });

  it("persists a local decision before slower siblings in the same wave finish", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    let releaseSiblings!: () => void;
    const siblingsReleased = new Promise<void>((resolve) => { releaseSiblings = resolve; });
    let decisionObserved!: () => void;
    const observed = new Promise<void>((resolve) => { decisionObserved = resolve; });
    harness.onAppend((events) => {
      if (events.some((event) => event.type === "decision.raised")) decisionObserved();
    });
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => {
        if (input.node.id === "node-api") return { kind: "failure", reason: "Choose the public API shape." };
        await siblingsReleased;
        return success(input);
      }
    });

    const running = driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    const decisionWasVisible = await Promise.race([
      observed.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50))
    ]);
    releaseSiblings();
    const state = await running;

    expect(decisionWasVisible).toBe(true);
    expect(Object.values(state.adoptedArtifacts).map((artifact) => artifact.nodeId).sort()).toEqual([
      "node-domain",
      "node-ui"
    ]);
  });

  it("executes an atomic root as a task attempt and still produces the final candidate", async () => {
    const breakdown = bookingBreakdown();
    if (breakdown.root.kind !== "composite") throw new Error("Fixture must start composite.");
    const domain = breakdown.root.children.find((unit) => unit.key === "domain");
    if (domain?.kind !== "leaf") throw new Error("Missing atomic domain leaf.");
    breakdown.root = domain;
    breakdown.acceptanceIntents = breakdown.acceptanceIntents.filter((intent) => intent.id === "domain-ready");
    breakdown.candidateSeams = [];
    const compiled = compileGraphRevision(
      { breakdown, repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => ({
        ...(success(input) as Extract<V2NodeExecutionOutcome, { kind: "success" }>),
        finalManifestId: "final-atomic"
      })
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(state.lifecycle).toBe("result_ready");
    expect(harness.events().some((event) => event.type === "attempt.started")).toBe(true);
    expect(harness.events().some((event) => event.type === "integration.started")).toBe(false);
  });
});

function success(input: V2NodeExecutionInput): V2NodeExecutionOutcome {
  const obligation = input.contract.validation.obligations[0]!;
  return {
    kind: "success",
    candidateCommit: `commit-${input.node.id}`,
    outputDigest: `sha256:${input.node.id}`,
    changedFiles: [...input.contract.scope.allowedPaths],
    evidenceMatrix: {
      matrixId: `matrix-${input.node.id}`,
      candidateCommit: `commit-${input.node.id}`,
      validationContract: { id: input.contract.validation.id, revision: input.contract.validation.revision },
      criteria: [{ criterionId: obligation.criterionId, obligationId: obligation.id, status: "satisfied", justification: "Passed.", evidenceRefs: [`evidence-${input.node.id}`] }],
      outcome: "verified"
    },
    artifactLocation: `commit-${input.node.id}`
  };
}

function staticInputs(compiled: ReturnType<typeof compileGraphRevision>) {
  return async () => ({
    graph: compiled.graph,
    contracts: compiled.contracts,
    repositoryContextDigest: "sha256:repository",
    executorProfile: { id: "claude-code-cli", revision: "sonnet" },
    materializableNodeIds: Object.keys(compiled.graph.nodes),
    availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
    conflictConstraints: []
  });
}

function coordinatorHarness(graphId: string) {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId: "run-v2", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Build booking" } }),
    RunEventSchema.parse({ eventId: "proposed", runId: "run-v2", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId: "run-v2", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
  ];
  let listener: (events: RunEvent[]) => void = () => undefined;
  const coordinator = new RunCoordinator({
    events: {
      load: async () => structuredClone(events),
      append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
        expect(expectedSequence).toBe(events.length);
        const appended = inputs.map((input, index) => RunEventSchema.parse({
          ...input,
          runId,
          sequence: expectedSequence + index + 1
        }));
        events = [...events, ...appended];
        listener(appended);
        return appended;
      }
    },
    delivery: { publish: async () => { throw new Error("unused"); } },
    clock: () => at,
    eventId: (type, sequence) => `${type}:${sequence}`
  });
  return {
    coordinator,
    events: () => structuredClone(events),
    onAppend(next: (events: RunEvent[]) => void) { listener = next; }
  };
}
