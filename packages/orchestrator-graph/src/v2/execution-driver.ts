import {
  TaskContractBundleSchema,
  type ArtifactContract,
  type TaskContractBundle
} from "@manyhands/contracts";
import type { ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import {
  computeInputFingerprint,
  classifyFailure,
  recoveryPolicyFor,
  type AdoptedArtifact,
  type AttemptUsage,
  type DecisionInput,
  type EvidenceMatrixRecord,
  type FailureObservation,
  type RunCoordinator,
  type RunEventInput,
  type RunProjection
} from "@manyhands/run-coordinator";
import { selectReadyWaveV2, type ReadinessStateV2 } from "@manyhands/scheduler";
import { GraphRevisionSchema, type GraphRevision, type TaskNodeV2 } from "@manyhands/task-graph";

export interface V2ExecutorProfile {
  id: string;
  revision: string;
}

export interface V2ExecutionTarget {
  sourceTargetFingerprint: string;
  targetBranch: string;
  targetHead: string;
}

export interface V2NodeExecutionInput {
  runId: string;
  waveId: string;
  attemptId: string;
  inputFingerprint: string;
  graph: GraphRevision;
  node: TaskNodeV2;
  contract: TaskContractBundle;
  consumedArtifacts: AdoptedArtifact[];
  outputArtifactContract: ArtifactContract;
  executorProfile: V2ExecutorProfile;
}

export interface V2RepairObservation {
  kind: "code" | "integration";
  pass: number;
  evidenceRefs: string[];
}

export type V2NodeExecutionOutcome =
  | {
      kind: "success";
      usage?: AttemptUsage;
      candidateCommit: string;
      outputDigest: string;
      changedFiles: string[];
      evidenceMatrix: EvidenceMatrixRecord;
      artifactLocation: string;
      integrationManifestId?: string;
      repairObservations?: V2RepairObservation[];
      finalManifestId?: string;
    }
  | {
      kind: "failure";
      reason: string;
      usage?: AttemptUsage;
      integrationManifestId?: string;
      repairObservations?: V2RepairObservation[];
      decision?: DecisionInput;
    };

export interface V2ExecutionDriverOptions {
  coordinator: RunCoordinator;
  execute(input: V2NodeExecutionInput): Promise<V2NodeExecutionOutcome>;
  now(): string;
}

export interface V2ExecutionRunInput {
  runId: string;
  graph: GraphRevision;
  contracts: TaskContractBundle[];
  repositoryContextDigest: string;
  executorProfile: V2ExecutorProfile;
  effectiveConfig: { maxParallel: number };
  materializableNodeIds: string[];
  availableExecutorNodeIds: string[];
  conflictConstraints: ConflictConstraintEvidence[];
  target: V2ExecutionTarget;
  maxWaves?: number;
}

/**
 * Drives the approved V2 graph from canonical facts only. It persists the wave
 * and every attempt-start fact before invoking an executor, then records the
 * exact candidate, evidence and adopted artifact as one deterministic batch.
 */
export class V2ExecutionDriver {
  constructor(private readonly options: V2ExecutionDriverOptions) {}

  async run(input: V2ExecutionRunInput): Promise<RunProjection> {
    const prepared = prepare(input);
    const maxWaves = input.maxWaves ?? Object.keys(prepared.graph.nodes).length * 3;
    for (let wave = 0; wave < maxWaves; wave += 1) {
      const current = await this.options.coordinator.load(input.runId);
      if (current.lifecycle !== "running" && current.lifecycle !== "waiting_for_input") return current;
      if (
        current.graphId !== prepared.graph.graphId ||
        current.graphRevision !== prepared.graph.revision ||
        current.approvedGraphRevision !== prepared.graph.revision
      ) {
        throw new Error(
          `Execution graph ${prepared.graph.graphId}@${prepared.graph.revision} is not the exact approved revision.`
        );
      }
      const advanced = await this.advance(prepared, current);
      if (!advanced.dispatched) return advanced.state;
      if (advanced.state.lifecycle !== "running" && advanced.state.lifecycle !== "waiting_for_input") return advanced.state;
    }
    throw new Error(`Execution exceeded ${maxWaves} waves without reaching a stable state.`);
  }

  private async advance(
    input: PreparedExecutionRunInput,
    current: RunProjection
  ): Promise<{ dispatched: boolean; state: RunProjection }> {
    const readinessState = buildReadinessState(input, current);
    const selection = selectReadyWaveV2({
      graph: input.graph,
      nodeIds: Object.keys(input.graph.nodes).sort(),
      state: readinessState,
      effectiveConfig: input.effectiveConfig,
      conflictConstraints: input.conflictConstraints
    });
    const pendingDecisionIds = Object.values(current.decisions)
      .filter((decision) => decision.status === "pending")
      .map((decision) => decision.id)
      .sort();
    let state = await this.options.coordinator.execute(input.runId, {
      type: "observe_readiness",
      readyNodeIds: selection.nodeIds,
      pendingDecisionIds
    });
    if (state.lifecycle !== "running" || selection.nodeIds.length === 0) return { dispatched: false, state };

    const waveId = `${input.runId}:wave:${state.selectedWaves.length + 1}`;
    state = await this.options.coordinator.execute(input.runId, {
      type: "select_wave",
      waveId,
      nodeIds: selection.nodeIds,
      maxParallel: input.effectiveConfig.maxParallel
    });

    const startedAt = this.options.now();
    const attempts = selection.nodeIds.map((nodeId) => createAttempt(input, state, nodeId, waveId, startedAt));
    state = await this.options.coordinator.record(
      input.runId,
      attempts.map((attempt) => attempt.startedEvent)
    );

    let latestState = state;
    let recordQueue = Promise.resolve();
    await Promise.all(attempts.map(async (attempt) => {
      const outcome = await this.options.execute(attempt.executionInput);
      const facts = this.factsForOutcome(input, attempt, outcome);

      let resolveEnqueued!: () => void;
      let rejectEnqueued!: (err: unknown) => void;
      const enqueued = new Promise<void>((resolve, reject) => {
        resolveEnqueued = resolve;
        rejectEnqueued = reject;
      });

      const previousQueue = recordQueue;
      recordQueue = previousQueue.catch(() => {}).then(async () => {
        try {
          latestState = await this.options.coordinator.record(input.runId, facts);
          resolveEnqueued();
        } catch (err) {
          rejectEnqueued(err);
        }
      });

      await enqueued;
    }));
    state = latestState;
    return { dispatched: true, state };
  }

  private factsForOutcome(
    run: PreparedExecutionRunInput,
    attempt: PreparedAttempt,
    outcome: V2NodeExecutionOutcome
  ): RunEventInput[] {
    const at = this.options.now();
    const facts: RunEventInput[] = [];
    const isComposite = attempt.startedEvent.type === "integration.started";
    for (const repair of outcome.repairObservations ?? []) {
      const observation = repair.kind === "integration"
        ? { source: "integration" as const, code: "conflict", message: "Integration required semantic repair." }
        : { source: "validation" as const, code: "validation_failed", message: "Exact-candidate validation required code repair." };
      const failureClass = classifyFailure(observation);
      const policy = recoveryPolicyFor(failureClass);
      facts.push(fact(`${attempt.attemptId}:${repair.kind}-failure:${repair.pass}`, at, "failure.classified", {
        nodeId: attempt.nodeId,
        failureClass,
        observation,
        allowedActions: policy.actions,
        automaticRetryBudget: policy.automaticRetryBudget,
        discardCandidate: policy.discardCandidate
      }));
      const payload = {
        attemptId: attempt.attemptId,
        nodeId: attempt.nodeId,
        pass: repair.pass,
        evidenceRefs: repair.evidenceRefs
      };
      facts.push(repair.kind === "integration"
        ? fact(`${attempt.attemptId}:integration-repair:${repair.pass}`, at, "integration.repair_attempted", payload)
        : fact(`${attempt.attemptId}:code-repair:${repair.pass}`, at, "attempt.repair_attempted", payload));
    }
    if (outcome.kind === "failure") {
      if ((outcome.repairObservations?.length ?? 0) === 0) {
        const observation: FailureObservation = isComposite
          ? { source: "integration", code: "integration_failed", message: outcome.reason }
          : leafFailureObservation(outcome);
        const failureClass = classifyFailure(observation);
        const policy = recoveryPolicyFor(failureClass);
        facts.push(fact(`${attempt.attemptId}:failure-classified`, at, "failure.classified", {
          nodeId: attempt.nodeId,
          failureClass,
          observation,
          allowedActions: policy.actions,
          automaticRetryBudget: policy.automaticRetryBudget,
          discardCandidate: policy.discardCandidate
        }));
      }
      facts.push(isComposite
        ? fact(`${attempt.attemptId}:integration-failed`, at, "integration.failed", {
            attemptId: attempt.attemptId,
            nodeId: attempt.nodeId,
            ...(outcome.integrationManifestId !== undefined ? { manifestId: outcome.integrationManifestId } : {}),
            reason: outcome.reason,
            decisionRequired: outcome.decision !== undefined
          })
        : fact(`${attempt.attemptId}:failed`, at, "attempt.failed", {
            attemptId: attempt.attemptId,
            nodeId: attempt.nodeId,
            reason: outcome.reason,
            // A condition that burns tokens and delivers nothing is exactly the
            // cost the comparative study needs to see.
            ...(outcome.usage !== undefined ? { usage: outcome.usage } : {})
          }));
      const decision = { ...(outcome.decision ?? defaultFailureDecision(attempt, outcome.reason)), raisedAtGraphRevision: run.graph.revision };
      facts.push(fact(`${attempt.attemptId}:decision:${decision.id}`, at, "decision.raised", { decision }));
      return facts;
    }

    assertSuccessfulOutcome(attempt, outcome);
    if (isComposite) {
      facts.push(fact(`${attempt.attemptId}:integration-completed`, at, "integration.completed", {
        attemptId: attempt.attemptId,
        nodeId: attempt.nodeId,
        manifestId: outcome.integrationManifestId ?? `${attempt.attemptId}:manifest`,
        candidateCommit: outcome.candidateCommit,
        matrix: outcome.evidenceMatrix
      }));
    } else {
      facts.push(
        fact(`${attempt.attemptId}:candidate`, at, "attempt.candidate_created", {
          attemptId: attempt.attemptId,
          nodeId: attempt.nodeId,
          candidateCommit: outcome.candidateCommit,
          outputDigest: outcome.outputDigest,
          changedFiles: outcome.changedFiles,
          ...(outcome.usage !== undefined ? { usage: outcome.usage } : {})
        }),
        fact(`${attempt.attemptId}:validation-completed`, at, "validation.completed", {
          attemptId: attempt.attemptId,
          nodeId: attempt.nodeId,
          matrix: outcome.evidenceMatrix
        })
      );
    }

    if (outcome.evidenceMatrix.outcome !== "verified") {
      const decision = { ...defaultFailureDecision(attempt, `Validation outcome is ${outcome.evidenceMatrix.outcome}.`), raisedAtGraphRevision: run.graph.revision };
      facts.push(fact(`${attempt.attemptId}:decision:${decision.id}`, at, "decision.raised", { decision }));
      return facts;
    }

    // Adopt EVERY artifact contract this node produces, not just its node-result.
    // A planner-declared artifact between siblings compiles into an
    // execution-phase requirement; adopting only the node-result left that
    // requirement permanently unsatisfied, so its consumers never became ready
    // and the run went quiet with no failure and no decision. A stall that
    // reports nothing is worse than a failure -- it looks like work in progress.
    // The verified candidate is the evidence for all of them, so they share its
    // digest and location.
    const produced = producedArtifactContracts(attempt);
    for (const [index, contract] of produced.entries()) {
      const artifact: AdoptedArtifact = {
        schemaVersion: 1,
        artifactId: `${contract.id}:${attempt.attemptId}`,
        runId: run.runId,
        nodeId: attempt.nodeId,
        digest: outcome.outputDigest,
        producerAttemptId: attempt.attemptId,
        contract: { id: contract.id, revision: contract.revision },
        kind: "commit",
        location: outcome.artifactLocation,
        adoptedAt: at
      };
      facts.push(fact(
        index === 0 ? `${attempt.attemptId}:artifact-adopted` : `${attempt.attemptId}:artifact-adopted:${index}`,
        at,
        "artifact.adopted",
        { artifact }
      ));
    }
    if (attempt.nodeId === run.graph.rootId) {
      if (outcome.finalManifestId === undefined) throw new Error("The root execution outcome requires a final manifest id.");
      facts.push(fact(`${attempt.attemptId}:final-candidate`, at, "final_candidate.verified", {
        manifestId: outcome.finalManifestId,
        commit: outcome.candidateCommit,
        evidenceMatrixId: outcome.evidenceMatrix.matrixId,
        evidenceEligible: true,
        executionSucceeded: true,
        sourceTargetFingerprint: run.target.sourceTargetFingerprint,
        targetBranch: run.target.targetBranch,
        targetHead: run.target.targetHead
      }));
    }
    return facts;
  }
}

interface PreparedExecutionRunInput extends V2ExecutionRunInput {
  graph: GraphRevision;
  contractsByNodeId: Map<string, TaskContractBundle>;
}

interface PreparedAttempt {
  attemptId: string;
  nodeId: string;
  startedEvent: RunEventInput;
  executionInput: V2NodeExecutionInput;
}

function prepare(input: V2ExecutionRunInput): PreparedExecutionRunInput {
  const graph = GraphRevisionSchema.parse(input.graph);
  if (!Number.isInteger(input.effectiveConfig.maxParallel) || input.effectiveConfig.maxParallel < 1) {
    throw new Error("V2 execution requires a persisted positive maxParallel.");
  }
  const contracts = input.contracts.map((bundle) => TaskContractBundleSchema.parse(bundle));
  const contractsByNodeId = new Map(contracts.map((bundle) => [bundle.task.nodeId, bundle]));
  for (const nodeId of Object.keys(graph.nodes)) {
    if (!contractsByNodeId.has(nodeId)) throw new Error(`Graph node ${nodeId} has no V2 contract bundle.`);
  }
  return { ...input, graph, contracts, contractsByNodeId };
}

function buildReadinessState(input: PreparedExecutionRunInput, state: RunProjection): ReadinessStateV2 {
  const bundles = [...input.contractsByNodeId.values()];
  const currentContractRevisions: Record<string, string> = {};
  const requiredContractRevisions: Record<string, Array<{ id: string; revision: string }>> = {};
  for (const bundle of bundles) {
    const contracts = [bundle.task, bundle.scope, bundle.validation, ...bundle.seams, ...bundle.artifacts];
    for (const contract of contracts) currentContractRevisions[contract.id] = contract.revision;
    requiredContractRevisions[bundle.task.nodeId] = contracts.map(({ id, revision }) => ({ id, revision }));
  }
  return {
    adoptedArtifacts: Object.values(state.adoptedArtifacts).map((artifact) => ({
      artifactId: artifact.contract.id,
      revision: artifact.contract.revision,
      digest: artifact.digest
    })),
    pendingDecisions: Object.values(state.decisions)
      .filter((decision) => decision.status === "pending")
      .map((decision) => ({ decisionId: decision.id, affectedNodeIds: [...decision.affectedNodeIds] })),
    materializableNodeIds: [...input.materializableNodeIds],
    activeResourceNodeIds: [],
    budgetAvailable: true,
    availableExecutorNodeIds: [...input.availableExecutorNodeIds],
    adoptedNodeIds: [...new Set(Object.values(state.adoptedArtifacts).map((artifact) => artifact.nodeId))],
    currentContractRevisions,
    requiredContractRevisions
  };
}

function createAttempt(
  run: PreparedExecutionRunInput,
  state: RunProjection,
  nodeId: string,
  waveId: string,
  startedAt: string
): PreparedAttempt {
  const node = run.graph.nodes[nodeId]!;
  const contract = run.contractsByNodeId.get(nodeId)!;
  const phases = node.kind === "root" || node.kind === "composite"
    ? new Set(["execution", "integration"])
    : new Set(["execution"]);
  const requirements = run.graph.artifactRequirements.filter(
    (requirement) => requirement.consumerNodeId === nodeId && phases.has(requirement.requiredFor)
  );
  const artifacts = Object.values(state.adoptedArtifacts);
  const consumedArtifacts = requirements.map((requirement) => {
    const artifact = artifacts.find((candidate) =>
      candidate.contract.id === requirement.artifactContract.id &&
      candidate.contract.revision === requirement.artifactContract.revision
    );
    if (artifact === undefined) throw new Error(`Ready node ${nodeId} is missing artifact ${requirement.artifactContract.id}.`);
    return artifact;
  });
  const outputArtifactContract = contract.artifacts.find((artifact) =>
    artifact.producerNodeId === nodeId &&
    (artifact.artifactType === "node-result" || artifact.artifactType === "final-candidate")
  );
  if (outputArtifactContract === undefined) throw new Error(`Node ${nodeId} has no compiled output artifact contract.`);
  const contractRevisions = [contract.task, contract.scope, contract.validation, ...contract.seams, ...contract.artifacts]
    .map(({ id, revision }) => ({ id, revision }));
  const inputFingerprint = computeInputFingerprint({
    graphId: run.graph.graphId,
    nodeId,
    contractRevisions,
    baseCommit: run.graph.baseCommit,
    consumedArtifacts: consumedArtifacts.map((artifact) => ({ id: artifact.artifactId, digest: artifact.digest })),
    repositoryContextDigest: run.repositoryContextDigest,
    executorProfile: run.executorProfile,
    validationContract: { id: contract.validation.id, revision: contract.validation.revision }
  });
  const ordinal = Object.values(state.attempts).filter((attempt) => attempt.nodeId === nodeId).length + 1;
  const attemptId = `${run.runId}:attempt:${nodeId}:${ordinal}`;
  const common = { attemptId, nodeId, inputFingerprint, executorProfile: run.executorProfile };
  const isComposite = requirements.length > 0 && (node.kind === "root" || node.kind === "composite");
  const startedEvent = fact(
    `${attemptId}:started`,
    startedAt,
    isComposite ? "integration.started" : "attempt.started",
    isComposite
      ? { ...common, requiredArtifactIds: consumedArtifacts.map((artifact) => artifact.artifactId) }
      : common
  );
  return {
    attemptId,
    nodeId,
    startedEvent,
    executionInput: {
      runId: run.runId,
      waveId,
      attemptId,
      inputFingerprint,
      graph: run.graph,
      node,
      contract,
      consumedArtifacts,
      outputArtifactContract,
      executorProfile: run.executorProfile
    }
  };
}

/**
 * The artifact contracts a node is responsible for producing: its node-result
 * plus every declared artifact whose producer it is. Deduplicated by id, since
 * the bundle carries the node-result in both collections.
 */
function producedArtifactContracts(attempt: PreparedAttempt): Array<{ id: string; revision: string }> {
  const output = attempt.executionInput.outputArtifactContract;
  const byId = new Map<string, { id: string; revision: string }>([[output.id, { id: output.id, revision: output.revision }]]);
  for (const contract of attempt.executionInput.contract.artifacts) {
    if (contract.producerNodeId !== attempt.nodeId) continue;
    if (!byId.has(contract.id)) byId.set(contract.id, { id: contract.id, revision: contract.revision });
  }
  return [...byId.values()];
}

function assertSuccessfulOutcome(attempt: PreparedAttempt, outcome: Extract<V2NodeExecutionOutcome, { kind: "success" }>): void {
  if (outcome.evidenceMatrix.candidateCommit !== outcome.candidateCommit) {
    throw new Error(`Evidence matrix ${outcome.evidenceMatrix.matrixId} does not validate the exact candidate for ${attempt.nodeId}.`);
  }
  const expected = attempt.executionInput.contract.validation;
  if (outcome.evidenceMatrix.validationContract.id !== expected.id || outcome.evidenceMatrix.validationContract.revision !== expected.revision) {
    throw new Error(`Evidence matrix ${outcome.evidenceMatrix.matrixId} does not match validation contract ${expected.id}@${expected.revision}.`);
  }
}

function defaultFailureDecision(attempt: PreparedAttempt, reason: string): DecisionInput {
  return {
    id: `${attempt.attemptId}:decision`,
    kind: "resolve_conflict",
    question: `The work for ${attempt.executionInput.node.title} needs guidance: ${reason}`,
    options: [
      { id: "retry", label: "Retry with guidance" },
      { id: "stop", label: "Stop this branch" }
    ],
    affectedNodeIds: [attempt.nodeId],
    evidenceRefs: [attempt.attemptId],
    impact: "behavior"
  };
}

function fact<T extends RunEventInput["type"]>(
  eventId: string,
  occurredAt: string,
  type: T,
  payload: Extract<RunEventInput, { type: T }>["payload"]
): Extract<RunEventInput, { type: T }> {
  return { eventId, occurredAt, type, payload } as Extract<RunEventInput, { type: T }>;
}

/**
 * Derives the failure cause of a leaf attempt from the executor's reason.
 *
 * `V2NodeExecutor` encodes the cause as the reason's leading token (the result
 * status: `scope_violation`, `unexpected_commit`, …). Collapsing every leaf
 * failure into `execution_failed` would send the recovery policy down the wrong
 * branch — repairing code that was actually rejected for leaving its scope
 * (DECISIONS.md A11).
 */
export function leafFailureObservation(outcome: { reason: string }): FailureObservation {
  const code = outcome.reason.split(":", 1)[0]?.trim();
  if (code === "scope_violation" || code === "unexpected_commit") {
    return { source: "scope", code, message: outcome.reason };
  }
  return { source: "executor", code: "execution_failed", message: outcome.reason };
}
