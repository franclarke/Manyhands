import {
  TaskContractBundleSchema,
  type ArtifactContract,
  type TaskContractBundle
} from "@manyhands/contracts";
import type { ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import {
  computeInputFingerprint,
  type AdoptedArtifact,
  type DecisionInput,
  type EvidenceMatrixRecord,
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
  pass: number;
  evidenceRefs: string[];
}

export type V2NodeExecutionOutcome =
  | {
      kind: "success";
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

    const outcomes = await Promise.all(
      attempts.map(async (attempt) => ({ attempt, outcome: await this.options.execute(attempt.executionInput) }))
    );
    const facts = outcomes.flatMap(({ attempt, outcome }) => this.factsForOutcome(input, attempt, outcome));
    state = await this.options.coordinator.record(input.runId, facts);
    return { dispatched: true, state };
  }

  private factsForOutcome(
    run: PreparedExecutionRunInput,
    attempt: PreparedAttempt,
    outcome: V2NodeExecutionOutcome
  ): RunEventInput[] {
    const at = this.options.now();
    const facts: RunEventInput[] = [];
    const isComposite = attempt.executionInput.node.kind === "root" || attempt.executionInput.node.kind === "composite";
    for (const repair of outcome.repairObservations ?? []) {
      facts.push(fact(`${attempt.attemptId}:integration-repair:${repair.pass}`, at, "integration.repair_attempted", {
        attemptId: attempt.attemptId,
        nodeId: attempt.nodeId,
        pass: repair.pass,
        evidenceRefs: repair.evidenceRefs
      }));
    }
    if (outcome.kind === "failure") {
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
            reason: outcome.reason
          }));
      const decision = outcome.decision ?? defaultFailureDecision(attempt, outcome.reason);
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
          changedFiles: outcome.changedFiles
        }),
        fact(`${attempt.attemptId}:validation-completed`, at, "validation.completed", {
          attemptId: attempt.attemptId,
          nodeId: attempt.nodeId,
          matrix: outcome.evidenceMatrix
        })
      );
    }

    if (outcome.evidenceMatrix.outcome !== "verified") {
      const decision = defaultFailureDecision(attempt, `Validation outcome is ${outcome.evidenceMatrix.outcome}.`);
      facts.push(fact(`${attempt.attemptId}:decision:${decision.id}`, at, "decision.raised", { decision }));
      return facts;
    }

    const artifact: AdoptedArtifact = {
      schemaVersion: 1,
      artifactId: `${attempt.executionInput.outputArtifactContract.id}:${attempt.attemptId}`,
      runId: run.runId,
      nodeId: attempt.nodeId,
      digest: outcome.outputDigest,
      producerAttemptId: attempt.attemptId,
      contract: {
        id: attempt.executionInput.outputArtifactContract.id,
        revision: attempt.executionInput.outputArtifactContract.revision
      },
      kind: "commit",
      location: outcome.artifactLocation,
      adoptedAt: at
    };
    facts.push(fact(`${attempt.attemptId}:artifact-adopted`, at, "artifact.adopted", { artifact }));
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
    graph: { id: run.graph.graphId, revision: run.graph.revision },
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
  const isComposite = node.kind === "root" || node.kind === "composite";
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
