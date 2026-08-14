import type { ArtifactContract, TaskContractBundle } from "@manyhands/contracts";
import type { FinalArtifactManifest } from "@manyhands/shared";
import {
  computeInputFingerprint,
  type AdoptedArtifact,
  type AttemptUsage,
  type EvidenceMatrixRecord,
  type RunCoordinator,
  type RunEventInput,
  type RunProjection,
  type SchedulerExplanationEvent
} from "@manyhands/run-coordinator";
import {
  evaluateReadiness,
  selectFrontier,
  type CanonicalReadinessExplanation,
  type IntegrationRiskEstimate
} from "@manyhands/scheduler";
import { GraphRevisionSchema, type CanonicalTaskNode, type GraphRevision } from "@manyhands/task-graph";

export interface CanonicalExecutorProfile {
  id: string;
  revision: string;
}

export interface CanonicalExecutionTarget {
  sourceTargetFingerprint: string;
  targetBranch: string;
  targetHead: string;
}

export interface CanonicalNodeExecutionInput {
  runId: string;
  waveId: string;
  attemptId: string;
  inputFingerprint: string;
  graph: GraphRevision;
  node: CanonicalTaskNode;
  contract: TaskContractBundle;
  consumedArtifacts: AdoptedArtifact[];
  executorProfile: CanonicalExecutorProfile;
}

export type CanonicalNodeExecutionOutcome =
  | {
      kind: "success";
      usage?: AttemptUsage;
      candidateCommit: string;
      outputDigest: string;
      changedFiles: string[];
      evidenceMatrix: EvidenceMatrixRecord;
      artifactLocation: string;
      artifactCherryPickMainline?: 1;
      integrationManifestId?: string;
      finalManifestId?: string;
      finalManifest?: FinalArtifactManifest;
    }
  | { kind: "failure"; reason: string; usage?: AttemptUsage };

export interface CanonicalExecutionDriverOptions {
  coordinator: RunCoordinator;
  execute(input: CanonicalNodeExecutionInput): Promise<CanonicalNodeExecutionOutcome>;
  estimateIntegrationRisk(
    candidate: CanonicalReadinessExplanation,
    selected: readonly CanonicalReadinessExplanation[]
  ): IntegrationRiskEstimate;
  now(): string;
}

export interface CanonicalExecutionRunInput {
  runId: string;
  graph: GraphRevision;
  contracts: Readonly<Record<string, TaskContractBundle>>;
  repositoryContextDigest: string;
  executorProfile: CanonicalExecutorProfile;
  effectiveConfig: { maxParallel: number; maxTokensTotal?: number; maxCostUsd?: number };
  availableExecutorNodeIds: string[];
  target: CanonicalExecutionTarget;
  maxWaves?: number;
}

/**
 * Productive execution path for a direct GraphRevision. It deliberately has no
 * legacy graph projection and no pairwise-risk input: hard readiness comes from
 * the canonical relations, while risk only orders the already-ready frontier.
 */
export class CanonicalExecutionDriver {
  constructor(private readonly options: CanonicalExecutionDriverOptions) {}

  async run(input: CanonicalExecutionRunInput): Promise<RunProjection> {
    const run = prepare(input);
    const maxWaves = input.maxWaves ?? Object.keys(run.graph.nodes).length * 3;
    for (let ordinal = 0; ordinal < maxWaves; ordinal += 1) {
      let state = await this.options.coordinator.load(run.runId);
      if (state.lifecycle !== "running" && state.lifecycle !== "waiting_for_input") return state;
      const selection = this.select(run, state);
      state = await this.observe(run, state, selection.explanations, selection.nodeIds);
      if (state.lifecycle !== "running" || selection.nodeIds.length === 0) return state;
      const waveId = `${run.runId}:wave:${state.selectedWaves.length + 1}`;
      state = await this.options.coordinator.execute(run.runId, {
        type: "select_wave",
        waveId,
        nodeIds: selection.nodeIds,
        maxParallel: run.effectiveConfig.maxParallel,
        blocked: selection.explanations.filter((explanation) => !selection.nodeIds.includes(explanation.nodeId)) as SchedulerExplanationEvent[],
        effectiveConfig: run.effectiveConfig,
        evaluatedAt: this.options.now()
      });
      const attempts = selection.nodeIds.map((nodeId) => createAttempt(run, state, nodeId, waveId, this.options.now()));
      state = await this.options.coordinator.record(run.runId, attempts.map((attempt) => attempt.startedEvent));
      for (const attempt of attempts) {
        const outcome = await this.options.execute(attempt.input);
        state = await this.recordOutcome(run, attempt, outcome);
        if (state.lifecycle !== "running") return state;
      }
    }
    throw new Error(`Canonical execution exceeded ${maxWaves} waves without a terminal state.`);
  }

  private select(run: PreparedRun, state: RunProjection): { nodeIds: string[]; explanations: CanonicalReadinessExplanation[] } {
    const activeNodeIds = Object.values(state.attempts)
      .filter((attempt) => attempt.status === "running")
      .map((attempt) => attempt.nodeId);
    const evaluation = evaluateReadiness({
      graph: run.graph,
      contracts: { taskBundles: run.contracts },
      adoptedArtifacts: Object.values(state.adoptedArtifacts).map((artifact) => ({
        artifactId: artifact.contract.id,
        revision: Number(artifact.contract.revision),
        digest: artifact.digest
      })),
      pendingDecisions: Object.values(state.decisions)
        .filter((decision) => decision.status === "pending")
        .map((decision) => ({ decisionId: decision.id, affectedNodeIds: decision.affectedNodeIds })),
      activeNodeIds,
      activeRuntimeLeases: run.graph.runtimeLeaseClaims.filter((claim) => activeNodeIds.includes(claim.nodeId)),
      availableExecutorNodeIds: run.availableExecutorNodeIds,
      adoptedNodeIds: Object.values(state.adoptedArtifacts).map((artifact) => artifact.nodeId),
      budgetAvailable: budgetAvailable(run, state),
      currentContractDigests: Object.fromEntries(run.graph.contractRefs.map((ref) => [ref.id, ref.digest]))
    });
    const frontier = selectFrontier({
      ready: evaluation.ready,
      policy: { maxParallel: run.effectiveConfig.maxParallel },
      graph: run.graph,
      estimateIntegrationRisk: this.options.estimateIntegrationRisk
    });
    const deferred = new Map(frontier.deferred.map((item) => [item.nodeId, item.reason]));
    const explanations = [...evaluation.ready, ...evaluation.blocked].map((explanation) => {
      const reason = deferred.get(explanation.nodeId);
      if (reason === undefined) return explanation;
      return {
        nodeId: explanation.nodeId,
        ready: false,
        reasons: [{ code: reason }] as CanonicalReadinessExplanation["reasons"]
      };
    });
    return {
      nodeIds: frontier.selected.map(({ nodeId }) => nodeId),
      explanations
    };
  }

  private observe(
    run: PreparedRun,
    state: RunProjection,
    explanations: CanonicalReadinessExplanation[],
    readyNodeIds: string[]
  ): Promise<RunProjection> {
    return this.options.coordinator.execute(run.runId, {
      type: "observe_readiness",
      readyNodeIds,
      pendingDecisionIds: Object.values(state.decisions)
        .filter((decision) => decision.status === "pending")
        .map((decision) => decision.id)
        .sort(),
      explanations: explanations as SchedulerExplanationEvent[],
      effectiveConfig: run.effectiveConfig,
      schedulerState: {
        materializableNodeIds: Object.keys(run.graph.nodes),
        activeResourceNodeIds: Object.values(state.attempts)
          .filter((attempt) => attempt.status === "running")
          .map((attempt) => attempt.nodeId),
        openCircuitBreakerNodeIds: [],
        availableExecutorNodeIds: run.availableExecutorNodeIds,
        stoppedNodeIds: state.stoppedNodeIds ?? [],
        budgetAvailable: budgetAvailable(run, state)
      },
      budgetAvailable: budgetAvailable(run, state),
      evaluatedAt: this.options.now()
    });
  }

  private async recordOutcome(
    run: PreparedRun,
    attempt: PreparedAttempt,
    outcome: CanonicalNodeExecutionOutcome
  ): Promise<RunProjection> {
    const at = this.options.now();
    if (outcome.kind === "failure") {
      return this.options.coordinator.record(run.runId, [
        fact(`${attempt.input.attemptId}:failed`, at, "attempt.failed", {
          attemptId: attempt.input.attemptId,
          nodeId: attempt.input.node.id,
          reason: outcome.reason,
          ...(outcome.usage === undefined ? {} : { usage: outcome.usage })
        }),
        decisionFact(attempt, at, outcome.reason)
      ]);
    }
    if (outcome.evidenceMatrix.candidateCommit !== outcome.candidateCommit) {
      throw new Error(`Evidence matrix ${outcome.evidenceMatrix.matrixId} does not identify ${attempt.input.node.id}'s candidate.`);
    }
    const expectedValidation = attempt.input.contract.validation;
    if (outcome.evidenceMatrix.validationContract.id !== expectedValidation.id ||
        outcome.evidenceMatrix.validationContract.revision !== expectedValidation.revision) {
      throw new Error(`Evidence matrix ${outcome.evidenceMatrix.matrixId} does not match ${attempt.input.node.id}'s validation contract.`);
    }
    const integration = attempt.input.node.kind !== "leaf";
    const facts: RunEventInput[] = integration
      ? [fact(`${attempt.input.attemptId}:integrated`, at, "integration.completed", {
        attemptId: attempt.input.attemptId,
        nodeId: attempt.input.node.id,
        manifestId: outcome.integrationManifestId ?? `${attempt.input.attemptId}:integration`,
        candidateCommit: outcome.candidateCommit,
        matrix: outcome.evidenceMatrix
      })]
      : [fact(`${attempt.input.attemptId}:candidate`, at, "attempt.candidate_created", {
        attemptId: attempt.input.attemptId,
        nodeId: attempt.input.node.id,
        candidateCommit: outcome.candidateCommit,
        outputDigest: outcome.outputDigest,
        changedFiles: outcome.changedFiles,
        ...(outcome.usage === undefined ? {} : { usage: outcome.usage })
      }),
      fact(`${attempt.input.attemptId}:validated`, at, "validation.completed", {
        attemptId: attempt.input.attemptId,
        nodeId: attempt.input.node.id,
        matrix: outcome.evidenceMatrix
      })
    ];
    if (outcome.evidenceMatrix.outcome !== "verified") {
      facts.push(decisionFact(attempt, at, `Validation outcome is ${outcome.evidenceMatrix.outcome}.`));
      return this.options.coordinator.record(run.runId, facts);
    }
    for (const artifact of producedArtifacts(attempt.input.contract, attempt.input.node.id)) {
      facts.push(fact(`${attempt.input.attemptId}:artifact:${artifact.id}`, at, "artifact.adopted", {
        artifact: {
          schemaVersion: 1,
          artifactId: `${artifact.id}:${attempt.input.attemptId}`,
          runId: run.runId,
          nodeId: attempt.input.node.id,
          digest: outcome.outputDigest,
          producerAttemptId: attempt.input.attemptId,
          contract: { id: artifact.id, revision: artifact.revision },
          kind: "commit",
          location: outcome.artifactLocation,
          ...(outcome.artifactCherryPickMainline === undefined ? {} : { cherryPickMainline: outcome.artifactCherryPickMainline }),
          adoptedAt: at
        }
      }));
    }
    if (attempt.input.node.id === run.graph.rootId) {
      if (outcome.finalManifestId === undefined || outcome.finalManifest === undefined) {
        throw new Error("Canonical root integration requires a complete final manifest.");
      }
      facts.push(fact(`${attempt.input.attemptId}:final`, at, "final_candidate.verified", {
        manifestId: outcome.finalManifestId,
        commit: outcome.candidateCommit,
        evidenceMatrixId: outcome.evidenceMatrix.matrixId,
        evidenceEligible: true,
        executionSucceeded: true,
        sourceTargetFingerprint: run.target.sourceTargetFingerprint,
        targetBranch: run.target.targetBranch,
        targetHead: run.target.targetHead,
        finalManifest: outcome.finalManifest
      }));
    }
    return this.options.coordinator.record(run.runId, facts);
  }
}

interface PreparedRun extends CanonicalExecutionRunInput {
  graph: GraphRevision;
  contracts: Readonly<Record<string, TaskContractBundle>>;
}

interface PreparedAttempt {
  input: CanonicalNodeExecutionInput;
  startedEvent: RunEventInput;
}

function prepare(input: CanonicalExecutionRunInput): PreparedRun {
  const graph = GraphRevisionSchema.parse(input.graph);
  if (!Number.isInteger(input.effectiveConfig.maxParallel) || input.effectiveConfig.maxParallel < 1) {
    throw new Error("Canonical execution requires a positive maxParallel.");
  }
  for (const nodeId of Object.keys(graph.nodes)) {
    if (!input.contracts[nodeId]) throw new Error(`Canonical graph node ${nodeId} has no task bundle.`);
  }
  return { ...input, graph };
}

function createAttempt(run: PreparedRun, state: RunProjection, nodeId: string, waveId: string, at: string): PreparedAttempt {
  const node = run.graph.nodes[nodeId]!;
  const contract = run.contracts[nodeId]!;
  const requirements = run.graph.artifactRequirements.filter((requirement) => requirement.consumerNodeId === nodeId);
  const consumedArtifacts = requirements.map((requirement) => {
    const adopted = Object.values(state.adoptedArtifacts).find((artifact) =>
      artifact.contract.id === requirement.artifactContract.id && Number(artifact.contract.revision) === requirement.artifactContract.revision
    );
    if (adopted === undefined) throw new Error(`Ready node ${nodeId} is missing ${requirement.artifactContract.id}.`);
    return adopted;
  });
  const ordinal = Object.values(state.attempts).filter((attempt) => attempt.nodeId === nodeId).length + 1;
  const attemptId = `${run.runId}:attempt:${nodeId}:${ordinal}`;
  const inputFingerprint = computeInputFingerprint({
    graphId: run.graph.graphId,
    nodeId,
    contractRevisions: [contract.task, contract.scope, contract.validation, ...contract.seams, ...contract.artifacts]
      .map(({ id, revision }) => ({ id, revision })),
    baseCommit: run.target.targetHead,
    consumedArtifacts: consumedArtifacts.map((artifact) => ({ id: artifact.artifactId, digest: artifact.digest })),
    repositoryContextDigest: run.repositoryContextDigest,
    executorProfile: run.executorProfile,
    validationContract: { id: contract.validation.id, revision: contract.validation.revision }
  });
  const common = { attemptId, nodeId, inputFingerprint, executorProfile: run.executorProfile };
  const isIntegration = node.kind === "root" || node.kind === "composite" || node.kind === "integrator";
  return {
    input: { runId: run.runId, waveId, attemptId, inputFingerprint, graph: run.graph, node, contract, consumedArtifacts, executorProfile: run.executorProfile },
    startedEvent: isIntegration && consumedArtifacts.length > 0
      ? fact(`${attemptId}:started`, at, "integration.started", { ...common, requiredArtifactIds: consumedArtifacts.map((artifact) => artifact.artifactId) })
      : fact(`${attemptId}:started`, at, "attempt.started", common)
  };
}

function producedArtifacts(contract: TaskContractBundle, nodeId: string): ArtifactContract[] {
  return contract.artifacts.filter((artifact) => artifact.producerNodeId === nodeId);
}

function budgetAvailable(run: PreparedRun, state: RunProjection): boolean {
  const usage = Object.values(state.attempts).reduce((total, attempt) => ({
    tokens: total.tokens + (attempt.usage?.tokensTotal ?? 0),
    cost: total.cost + (attempt.usage?.costUsd ?? 0)
  }), { tokens: 0, cost: 0 });
  return (run.effectiveConfig.maxTokensTotal === undefined || usage.tokens < run.effectiveConfig.maxTokensTotal) &&
    (run.effectiveConfig.maxCostUsd === undefined || usage.cost < run.effectiveConfig.maxCostUsd);
}

function fact<T extends RunEventInput["type"]>(
  eventId: string,
  occurredAt: string,
  type: T,
  payload: Extract<RunEventInput, { type: T }>["payload"]
): Extract<RunEventInput, { type: T }> {
  return { eventId, occurredAt, type, payload } as Extract<RunEventInput, { type: T }>;
}

function decisionFact(attempt: PreparedAttempt, at: string, reason: string): RunEventInput {
  return fact(`${attempt.input.attemptId}:decision`, at, "decision.raised", {
    decision: {
      id: `${attempt.input.attemptId}:decision`,
      kind: "resolve_conflict",
      question: `Execution for ${attempt.input.node.title} requires guidance: ${reason}`,
      options: [
        { id: "retry", label: "Retry with guidance" },
        { id: "stop", label: "Stop this work" }
      ],
      affectedNodeIds: [attempt.input.node.id],
      evidenceRefs: [attempt.input.attemptId, `input-fingerprint:${attempt.input.inputFingerprint}`],
      impact: "behavior",
      raisedAtGraphRevision: attempt.input.graph.revision
    }
  });
}
