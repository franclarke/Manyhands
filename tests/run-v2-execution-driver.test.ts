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
  orderArtifactRequirementsForMaterialization,
  type V2NodeExecutionInput,
  type V2NodeExecutionOutcome
} from "@manyhands/orchestrator-graph";
import type { LegacyGraphRevisionV2 } from "@manyhands/task-graph";
import {
  bookingBreakdown,
  bookingSnapshot,
  compilerDependencies
} from "./helpers/target-planning-fixtures";

const at = "2026-07-17T12:00:00.000Z";

describe("V2ExecutionDriver", () => {
  it("materializes upstream artifact dependencies before descendant artifacts", () => {
    type Requirement = LegacyGraphRevisionV2["artifactRequirements"][number];
    const requirements: Requirement[] = [
      {
        id: "requirement-event",
        artifactContract: { id: "event-contract", revision: "r1" },
        producerNodeId: "application",
        consumerNodeId: "durability",
        requiredFor: "execution"
      },
      {
        id: "requirement-domain",
        artifactContract: { id: "domain-contract", revision: "r1" },
        producerNodeId: "domain",
        consumerNodeId: "durability",
        requiredFor: "execution"
      }
    ];
    const allRequirements: Requirement[] = [
      ...requirements,
      {
        id: "requirement-domain-to-application",
        artifactContract: { id: "domain-contract", revision: "r1" },
        producerNodeId: "domain",
        consumerNodeId: "application",
        requiredFor: "execution"
      }
    ];

    expect(orderArtifactRequirementsForMaterialization(requirements, allRequirements).map((requirement) => requirement.id))
      .toEqual(["requirement-domain", "requirement-event"]);
  });

  it("retries a transient leaf failure within the declared recovery budget", async () => {
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
    let attempts = 0;
    const retryContexts: Array<V2NodeExecutionInput["priorFailure"]> = [];
    const fingerprints: string[] = [];
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => {
        attempts += 1;
        retryContexts.push(input.priorFailure);
        fingerprints.push(input.inputFingerprint);
        if (attempts === 1) return { kind: "failure", reason: "transient: provider disconnected" };
        return { ...(success(input) as Extract<V2NodeExecutionOutcome, { kind: "success" }>), finalManifestId: "retry-final" };
      }
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(attempts).toBe(2);
    expect(state.decisions).toEqual({});
    expect(state.lifecycle).toBe("result_ready");
    const retried = Object.values(state.attempts).find((attempt) => attempt.retryOfAttemptId !== undefined);
    expect(retried?.retryOfAttemptId).toBeDefined();
    expect(retryContexts).toEqual([
      undefined,
      { attemptId: retried!.retryOfAttemptId, reason: "transient: provider disconnected" }
    ]);
    expect(new Set(fingerprints).size).toBe(2);
    expect(retried?.inputFingerprint).not.toBe(
      Object.values(state.attempts).find((attempt) => attempt.attemptId === retried?.retryOfAttemptId)?.inputFingerprint
    );
  });

  it("raises an empty upstream artifact decision against the producer, not the blocked consumer", async () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const harness = coordinatorHarness(compiled.graph.graphId, "run-v2-artifact-empty");
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => input.node.id === compiled.graph.rootId
        ? ({
            kind: "failure",
            reason: "Could not materialize artifact artifact-domain-output: artifact_empty.",
            failureCause: { source: "artifact", code: "artifact_empty", artifactId: "artifact-domain-output", producerNodeId: "node-domain" }
          } as unknown as V2NodeExecutionOutcome)
        : success(input)
    });

    const state = await driver.run({
      runId: "run-v2-artifact-empty",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(Object.values(state.decisions)).toEqual([
      expect.objectContaining({ affectedNodeIds: ["node-booking", "node-domain"], evidenceRefs: expect.arrayContaining(["artifact:artifact-domain-output"]) })
    ]);
  });

  it("does not retry a transient leaf when the run declares a zero retry budget", async () => {
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
    const harness = coordinatorHarness(compiled.graph.graphId, "run-v2-single-attempt");
    let attempts = 0;
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async () => {
        attempts += 1;
        return { kind: "failure", reason: "transient: provider disconnected" };
      }
    });

    const state = await driver.run({
      runId: "run-v2-single-attempt",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1, automaticRetryBudget: 0 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(attempts).toBe(1);
    expect(state.lifecycle).toBe("waiting_for_input");
    expect(Object.values(state.attempts)).toHaveLength(1);
    expect(Object.values(state.decisions)).toHaveLength(1);
  });

  it("does not automatically repeat a leaf that exhausted its executor deadline", async () => {
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
    const harness = coordinatorHarness(compiled.graph.graphId, "run-v2-timeout");
    let attempts = 0;
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async () => {
        attempts += 1;
        return {
          kind: "failure",
          reason: "timeout: timeout: The agent hit the hard timeout after producing a partial diff."
        };
      }
    });

    const state = await driver.run({
      runId: "run-v2-timeout",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "codex-cli", revision: "gpt-5.4-mini" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(attempts).toBe(1);
    expect(state.lifecycle).toBe("waiting_for_input");
    expect(Object.values(state.attempts)).toHaveLength(1);
    expect(state.recoveryHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ failureClass: "executor_timeout" })
    ]));
    const classified = harness.events().find((event) => event.type === "failure.classified");
    expect(classified?.type === "failure.classified" ? classified.payload.automaticRetryBudget : undefined).toBe(0);
  });

  it("does not dispatch a second wave when bounded usage cannot prove the remaining budget", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    let executions = 0;
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => {
        executions += 1;
        return { ...(success(input) as Extract<V2NodeExecutionOutcome, { kind: "success" }>), usage: { tokensTotal: 1, source: "unavailable" } };
      }
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 3, maxTokensTotal: 100 },
      materializableNodeIds: Object.keys(compiled.graph.nodes),
      availableExecutorNodeIds: Object.keys(compiled.graph.nodes),
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(executions).toBe(1);
    expect(state.lifecycle).toBe("waiting_for_input");
    expect(Object.values(state.decisions)).toEqual([
      expect.objectContaining({ status: "pending", impact: "risk" })
    ]);
  });

  it("suspends an executor after an auth failure while preserving the causal decision", async () => {
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
      execute: async () => ({ kind: "failure", reason: "auth: expired credentials" })
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(state.lifecycle).toBe("waiting_for_input");
    const readiness = harness.events().filter((event) => event.type === "readiness.observed").at(-1);
    expect(readiness?.type === "readiness.observed" ? readiness.payload.readyNodeIds : []).toEqual([]);
    expect(state.recoveryHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ failureClass: "environment_auth_executor" })
    ]));

    const restartedDriver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async () => { throw new Error("A persisted executor suspension must prevent dispatch."); }
    });
    await restartedDriver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });
    const replayedReadiness = harness.events().filter((event) => event.type === "readiness.observed").at(-1);
    expect(replayedReadiness?.type === "readiness.observed" ? replayedReadiness.payload.readyNodeIds : []).toEqual([]);

    const decisionId = Object.keys((await harness.coordinator.load("run-v2")).decisions)[0];
    if (decisionId === undefined) throw new Error("Auth failure must raise a decision.");
    await harness.coordinator.execute("run-v2", { type: "resolve_decision", decisionId, optionId: "retry" });
    let recoveredExecutions = 0;
    const recoveredDriver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input) => {
        recoveredExecutions += 1;
        return { ...(success(input) as Extract<V2NodeExecutionOutcome, { kind: "success" }>), finalManifestId: "auth-recovered-final" };
      }
    });
    const recovered = await recoveredDriver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });
    expect(recoveredExecutions).toBe(1);
    expect(recovered.lifecycle).toBe("result_ready");
  });

  it("discards a candidate rejected for leaving its declared scope", async () => {
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
      execute: async () => ({ kind: "failure", reason: "unexpected_commit: wrote outside allowed paths" })
    });

    const state = await driver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });

    expect(Object.values(state.attempts)).toEqual([
      expect.objectContaining({ status: "discarded", failureReason: expect.stringContaining("scope_unexpected_commit") })
    ]);
    expect(state.recoveryHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ failureClass: "scope_unexpected_commit" })
    ]));

    const decisionId = Object.keys(state.decisions)[0];
    if (decisionId === undefined) throw new Error("Scope failure must raise a decision.");
    await harness.coordinator.execute("run-v2", { type: "resolve_decision", decisionId, optionId: "stop" });
    let stoppedExecutions = 0;
    const stoppedDriver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async () => {
        stoppedExecutions += 1;
        throw new Error("A stopped branch must not dispatch.");
      }
    });
    await stoppedDriver.run({
      runId: "run-v2",
      graph: compiled.graph,
      contracts: compiled.contracts,
      repositoryContextDigest: "sha256:repository",
      executorProfile: { id: "claude-code-cli", revision: "sonnet" },
      effectiveConfig: { maxParallel: 1 },
      materializableNodeIds: [compiled.graph.rootId],
      availableExecutorNodeIds: [compiled.graph.rootId],
      conflictConstraints: [],
      target: { sourceTargetFingerprint: "sha256:target", targetBranch: "main", targetHead: "base-head" }
    });
    expect(stoppedExecutions).toBe(0);
  });

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
            outcome: "verified",
            validationRecipeDigest: "sha256:recipe-v2",
            evidenceBindings: [],
            observations: []
          },
          artifactLocation: `commit-${input.node.id}`,
          ...(input.node.id === compiled.graph.rootId
            ? {
                integrationManifestId: "integration-root",
                finalManifestId: "final-root",
                finalManifest: {
                  commitSha: `commit-${input.node.id}`,
                  treeSha: `tree-${input.node.id}`,
                  graphRevision: input.graph.revision,
                  artifactIds: input.contract.task.produces.map(({ id }) => id),
                  evidenceMatrixId: `matrix-${input.node.id}`,
                  validationRecipeDigest: "sha256:recipe-v2",
                  deliveryTarget: "main"
                }
              }
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

  it("does not emit a terminal integration failure with decisionRequired=false when recovery needs guidance", async () => {
    const compiled = compileGraphRevision(
      { breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() },
      compilerDependencies
    );
    const harness = coordinatorHarness(compiled.graph.graphId);
    const driver = new V2ExecutionDriver({
      coordinator: harness.coordinator,
      now: () => at,
      loadCurrentInputs: staticInputs(compiled),
      execute: async (input): Promise<V2NodeExecutionOutcome> => {
        if (input.node.id !== compiled.graph.rootId) return success(input);
        const obligation = input.contract.validation.obligations[0]!;
        return {
          kind: "failure",
          integrationManifestId: "integration-root",
          candidateCommit: "candidate-root",
          evidenceMatrix: {
            matrixId: "matrix-root-failed",
            candidateCommit: "candidate-root",
            validationContract: { ...input.contract.task.validation },
            criteria: [{
              criterionId: obligation.criterionId,
              obligationId: obligation.id,
              status: "failed",
              justification: "Parent criterion is not satisfied.",
              evidenceRefs: ["evidence-parent-failure"]
            }],
            outcome: "failed",
            validationRecipeDigest: "sha256:recipe-root",
            evidenceBindings: [],
            observations: []
          },
          reason: "parent_validation_failed: exact candidate is not verified"
        };
      }
    });

    await driver.run({
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

    const failed = harness.events().find((event) => event.type === "integration.failed");
    expect(failed).toMatchObject({ payload: { decisionRequired: true, candidateCommit: "candidate-root", matrix: { matrixId: "matrix-root-failed" } } });
    expect(harness.events().some((event) => event.type === "decision.raised")).toBe(true);
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
      outcome: "verified",
      validationRecipeDigest: "sha256:recipe-v2",
      evidenceBindings: [],
      observations: []
    },
    finalManifest: {
      commitSha: `commit-${input.node.id}`,
      treeSha: `tree-${input.node.id}`,
      graphRevision: input.graph.revision,
      artifactIds: input.contract.task.produces.map(({ id }) => id),
      evidenceMatrixId: `matrix-${input.node.id}`,
      validationRecipeDigest: "sha256:recipe-v2",
      deliveryTarget: "main"
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

function coordinatorHarness(graphId: string, runId = "run-v2") {
  let events: RunEvent[] = [
    RunEventSchema.parse({ eventId: "created", runId, sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Build booking" } }),
    RunEventSchema.parse({ eventId: "proposed", runId, sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId, revision: 1 } }),
    RunEventSchema.parse({ eventId: "approved", runId, sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId, revision: 1 } })
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
