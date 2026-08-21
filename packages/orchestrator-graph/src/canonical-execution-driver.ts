import { validateEvidenceFreshness, type ArtifactContract, type ArtifactManifest, type CanonicalValidationObligation, type CandidateTreeManifest, type GoalContract, type ProofStrategy, type TaskContractBundle } from "@manyhands/contracts";
import { createHash } from "node:crypto";
import type { FinalArtifactManifest } from "@manyhands/shared";
import {
  computeInputFingerprint,
  routeRepair,
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
import { assertNoConcurrentResourceConflict } from "./concurrent-resource-invariant.js";
import { executionBaseArtifacts } from "./execution-base-closure.js";
import {
  GraphRevisionSchema,
  checkResourceAuthority,
  describeResourceAuthorityViolations,
  type CanonicalTaskNode,
  type GraphRevision
} from "@manyhands/task-graph";

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
  /** Immutable failure evidence that causally distinguishes a repair attempt. */
  priorFailure?: { attemptId: string; reason: string };
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
      candidateManifest?: CandidateTreeManifest;
      artifactManifests?: Readonly<Record<string, ArtifactManifest>>;
      integrationManifestId?: string;
      finalManifestId?: string;
      finalManifest?: FinalArtifactManifest;
    }
  | {
    kind: "needs_input";
    reason: string;
    unmaterializedObligationIds: string[];
    unmaterialized?: ExecutionBlocker[];
  }
  | { kind: "failure"; reason: string; usage?: AttemptUsage };

/**
 * Why a node could not even start. A blocker is deterministic in the node's
 * contract: the same attempt run again computes the same answer, so an operator
 * offered "retry" is offered nothing at all.
 */
export interface ExecutionBlocker {
  obligationId: string;
  cause: "evidence_missing" | "shared_evidence_invalid" | "capability_missing";
  detail: string;
}

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
  evidenceAuthority?: CanonicalEvidenceAuthority;
  maxWaves?: number;
}

export interface CanonicalEvidenceAuthority {
  goal: GoalContract;
  baseline: { commitOid: string; treeOid: string };
  validationObligations: Readonly<Record<string, CanonicalValidationObligation>>;
  proofStrategies: Readonly<Record<string, ProofStrategy>>;
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
      state = await this.executeWave(run, attempts, state);
      if (state.lifecycle !== "running") return state;
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
    const nodeIds = frontier.selected.map(({ nodeId }) => nodeId);
    assertNoConcurrentResourceConflict(run.graph.resourceClaims, nodeIds);
    return { nodeIds, explanations };
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

  /**
   * Runs one wave with at most `maxParallel` attempts in flight.
   *
   * Two things are deliberately asymmetric. Execution is concurrent, because
   * that is the point of the wave. Journal appends are serialized through one
   * chain, because the journal is a single writer with a strict
   * expected-sequence contract and concurrency must not become its problem.
   *
   * Every started attempt settles before this returns, including when one
   * executor throws. An abandoned in-flight attempt is an unjournaled result,
   * which is the failure mode the gate exists to prevent, so the first throw is
   * held and re-raised only after the rest have been recorded.
   */
  private async executeWave(
    run: PreparedRun,
    attempts: readonly PreparedAttempt[],
    initialState: RunProjection
  ): Promise<RunProjection> {
    let state = initialState;
    const limit = Math.max(1, Math.trunc(run.effectiveConfig.maxParallel));
    const queue = [...attempts];
    let appendChain: Promise<unknown> = Promise.resolve();
    let firstError: unknown;

    const recordSerially = async (
      attempt: PreparedAttempt,
      outcome: CanonicalNodeExecutionOutcome
    ): Promise<void> => {
      const chained = appendChain.then(async () => {
        state = await this.recordOutcome(run, attempt, outcome);
      });
      appendChain = chained.catch(() => undefined);
      await chained;
    };

    const worker = async (): Promise<void> => {
      for (;;) {
        const attempt = queue.shift();
        if (attempt === undefined) return;
        let outcome: CanonicalNodeExecutionOutcome;
        try {
          outcome = await this.options.execute(attempt.input);
        } catch (error) {
          // Hold the throw instead of propagating now: siblings are still in
          // flight and their results have to reach the journal.
          if (firstError === undefined) firstError = error;
          return;
        }
        await recordSerially(attempt, outcome);
      }
    };

    await Promise.all(Array.from({ length: Math.min(limit, attempts.length) }, worker));
    await appendChain;
    if (firstError !== undefined) throw firstError;
    return state;
  }

  private async recordOutcome(
    run: PreparedRun,
    attempt: PreparedAttempt,
    outcome: CanonicalNodeExecutionOutcome
  ): Promise<RunProjection> {
    const at = this.options.now();
    if (outcome.kind === "failure" || outcome.kind === "needs_input") {
      const blockers = outcome.kind === "needs_input" ? outcome.unmaterialized ?? [] : [];
      return this.options.coordinator.record(run.runId, [
        fact(`${attempt.input.attemptId}:failed`, at, "attempt.failed", {
          attemptId: attempt.input.attemptId,
          nodeId: attempt.input.node.id,
          reason: outcome.reason,
          ...(blockers.length === 0 ? {} : { blockers }),
          ...(outcome.kind === "failure" && outcome.usage !== undefined ? { usage: outcome.usage } : {})
        }),
        decisionFact(attempt, at, outcome.reason, blockers)
      ]);
    }
    // Authority is checked before adoption, not inside the executor: adoption is
    // the act that grants a candidate standing, and a replaceable executor must
    // not be the thing deciding whether a node may change another node's
    // resource. The scope enforcer cannot answer this — a composite's scope
    // legitimately spans the paths of the children it integrates.
    const authorityViolations = checkResourceAuthority({
      nodeId: attempt.input.node.id,
      resourceClaims: run.graph.resourceClaims,
      // Every artifact contract in the run, not just the ones this node's own
      // bundle happens to carry: a node cannot be measured against a title it
      // was never handed, which let a leaf write a sibling's file unreported.
      artifactContracts: Object.values(run.contracts).flatMap((bundle) => bundle.artifacts),
      changedPaths: outcome.changedFiles,
      // An integration composes the artifacts it consumed, and its candidate is
      // diffed against the target base, so those paths are present without the
      // composite having authored them.
      composedArtifactIds: attempt.input.node.kind === "leaf"
        ? []
        : attempt.input.consumedArtifacts.map((artifact) => artifact.contract.id)
    });
    if (authorityViolations.length > 0) {
      const reason = describeResourceAuthorityViolations(authorityViolations);
      return this.options.coordinator.record(run.runId, [
        fact(`${attempt.input.attemptId}:failed`, at, "attempt.failed", {
          attemptId: attempt.input.attemptId,
          nodeId: attempt.input.node.id,
          reason
        }),
        decisionFact(attempt, at, reason)
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
    if (run.evidenceAuthority !== undefined && outcome.evidenceMatrix.outcome === "verified") {
      verifyExactEvidenceAuthority(run.evidenceAuthority, outcome);
    }
    const integration = attempt.input.node.kind !== "leaf";
    const facts: RunEventInput[] = integration
      ? [fact(`${attempt.input.attemptId}:integrated`, at, "integration.completed", {
        attemptId: attempt.input.attemptId,
        nodeId: attempt.input.node.id,
        manifestId: outcome.integrationManifestId ?? `${attempt.input.attemptId}:integration`,
        candidateCommit: outcome.candidateCommit,
        ...(outcome.candidateManifest === undefined ? {} : {
          candidate: {
            manifestDigest: outcome.candidateManifest.manifestDigest,
            commitOid: outcome.candidateManifest.commitOid,
            treeOid: outcome.candidateManifest.treeOid
          }
        }),
        matrix: outcome.evidenceMatrix
      })]
      : [fact(`${attempt.input.attemptId}:candidate`, at, "attempt.candidate_created", {
        attemptId: attempt.input.attemptId,
        nodeId: attempt.input.node.id,
        candidateCommit: outcome.candidateCommit,
        ...(outcome.candidateManifest === undefined ? {} : {
          candidate: {
            manifestDigest: outcome.candidateManifest.manifestDigest,
            commitOid: outcome.candidateManifest.commitOid,
            treeOid: outcome.candidateManifest.treeOid
          }
        }),
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
      const manifest = outcome.artifactManifests?.[artifact.id];
      const contractRef = attempt.input.graph.contractRefs.find((ref) =>
        ref.id === artifact.id && ref.revision === Number(artifact.revision)
      );
      if (manifest === undefined) {
        throw new Error(`Verified attempt ${attempt.input.attemptId} did not produce manifest ${artifact.id}.`);
      }
      if (contractRef === undefined ||
          manifest.id !== artifact.id ||
          manifest.contract.id !== contractRef.id ||
          manifest.contract.revision !== contractRef.revision ||
          manifest.contract.digest !== contractRef.digest ||
          manifest.producerNodeId !== attempt.input.node.id ||
          manifest.producerAttemptId !== attempt.input.attemptId ||
          manifest.inputFingerprint !== attempt.input.inputFingerprint ||
          manifest.sourceCandidate.commitOid !== outcome.candidateCommit) {
        throw new Error(`Manifest ${manifest.id} does not bind the exact verified attempt ${attempt.input.attemptId}.`);
      }
      facts.push(fact(`${attempt.input.attemptId}:artifact:${artifact.id}`, at, "artifact.adopted", {
        artifact: {
          schemaVersion: 1,
          artifactId: `${artifact.id}:${attempt.input.attemptId}`,
          runId: run.runId,
          nodeId: attempt.input.node.id,
          digest: manifest.manifestDigest,
          producerAttemptId: attempt.input.attemptId,
          contract: { id: artifact.id, revision: artifact.revision },
          kind: "manifest",
          location: manifest.manifestDigest,
          manifest,
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

function verifyExactEvidenceAuthority(
  authority: CanonicalEvidenceAuthority,
  outcome: Extract<CanonicalNodeExecutionOutcome, { kind: "success" }>
): void {
  const candidate = outcome.candidateManifest;
  if (candidate === undefined) {
    throw new Error(`Verified evidence matrix ${outcome.evidenceMatrix.matrixId} has no retained candidate-tree manifest.`);
  }
  if (
    candidate.commitOid !== outcome.candidateCommit ||
    candidate.sourceCandidate.commitOid !== outcome.candidateCommit ||
    candidate.sourceCandidate.treeOid !== candidate.treeOid
  ) {
    throw new Error(`Candidate manifest ${candidate.id} does not identify the verified candidate.`);
  }
  const bindings = outcome.evidenceMatrix.evidenceBindings;
  if (bindings.length !== outcome.evidenceMatrix.criteria.length) {
    throw new Error(`Evidence matrix ${outcome.evidenceMatrix.matrixId} does not bind every validation criterion.`);
  }
  for (const criterion of outcome.evidenceMatrix.criteria) {
    const binding = bindings.find((item) => item.obligationId === criterion.obligationId);
    if (binding === undefined) throw new Error(`Evidence matrix ${outcome.evidenceMatrix.matrixId} is missing ${criterion.obligationId}.`);
    const obligation = authority.validationObligations[criterion.obligationId];
    const strategy = obligation === undefined ? undefined : authority.proofStrategies[obligation.proofStrategy.id];
    const selectorDigest = strategy?.selectorDigest
      ?? (obligation?.required === false ? sha256(JSON.stringify([])) : undefined);
    if (
      obligation === undefined ||
      strategy === undefined ||
      selectorDigest === undefined ||
      strategy.revision !== obligation.proofStrategy.revision ||
      strategy.digest !== obligation.proofStrategy.digest
    ) {
      throw new Error(`Evidence criterion ${criterion.obligationId} has no materialized proof authority.`);
    }
    const freshness = validateEvidenceFreshness(binding, {
      goalContractDigest: authority.goal.digest,
      criterionId: strategy.criterionId,
      obligationId: criterion.obligationId,
      mode: strategy.mode,
      authority: strategy.authority,
      candidate: { manifestDigest: candidate.manifestDigest, commitOid: candidate.commitOid, treeOid: candidate.treeOid },
      baseline: authority.baseline,
      proofStrategyDigest: strategy.digest,
      recipeDigest: requiredRecipeDigest(outcome.evidenceMatrix),
      environmentDigest: strategy.environmentPolicyDigest,
      selectorDigest,
      outputDigest: binding.outputDigest
    }, sha256);
    if (!freshness.ok) throw new Error(`Evidence binding ${binding.id} is stale: ${freshness.issues.map(({ code }) => code).join(", ")}.`);
  }
}

function requiredRecipeDigest(matrix: EvidenceMatrixRecord): string {
  if (matrix.validationRecipeDigest === undefined) throw new Error(`Evidence matrix ${matrix.matrixId} has no validation recipe digest.`);
  return matrix.validationRecipeDigest;
}

const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function createAttempt(run: PreparedRun, state: RunProjection, nodeId: string, waveId: string, at: string): PreparedAttempt {
  const node = run.graph.nodes[nodeId]!;
  const contract = run.contracts[nodeId]!;
  // The whole base, not only the direct inputs. Each artifact is a change set
  // against one exact tree, so an input that was itself built on another has to
  // land on that other one first or its manifest will not apply.
  const consumedArtifacts = executionBaseArtifacts(run.graph, nodeId).map(({ artifactContract }) => {
    const adopted = Object.values(state.adoptedArtifacts).find((artifact) =>
      artifact.contract.id === artifactContract.id && Number(artifact.contract.revision) === artifactContract.revision
    );
    if (adopted === undefined) throw new Error(`Ready node ${nodeId} is missing ${artifactContract.id}.`);
    return adopted;
  });
  const ordinal = Object.values(state.attempts).filter((attempt) => attempt.nodeId === nodeId).length + 1;
  const attemptId = `${run.runId}:attempt:${nodeId}:${ordinal}`;
  const previousAttempt = Object.values(state.attempts)
    .filter((attempt) => attempt.nodeId === nodeId && ["failed", "discarded", "stale"].includes(attempt.status))
    .at(-1);
  const priorFailure = previousAttempt?.status === "failed" && previousAttempt.failureReason !== undefined
    ? { attemptId: previousAttempt.attemptId, reason: previousAttempt.failureReason }
    : undefined;
  const inputFingerprint = computeInputFingerprint({
    graphId: run.graph.graphId,
    nodeId,
    contractRevisions: [contract.task, contract.scope, contract.validation, ...contract.seams, ...contract.artifacts]
      .map(({ id, revision }) => ({ id, revision })),
    baseCommit: run.target.targetHead,
    consumedArtifacts: consumedArtifacts.map((artifact) => ({ id: artifact.artifactId, digest: artifact.digest })),
    repositoryContextDigest: run.repositoryContextDigest,
    executorProfile: run.executorProfile,
    validationContract: { id: contract.validation.id, revision: contract.validation.revision },
    ...(priorFailure === undefined ? {} : {
      recoveryContextDigest: sha256(JSON.stringify({
        attemptId: priorFailure.attemptId,
        inputFingerprint: previousAttempt!.inputFingerprint,
        reason: priorFailure.reason
      }))
    })
  });
  const common = {
    attemptId,
    nodeId,
    inputFingerprint,
    ...(previousAttempt === undefined ? {} : { retryOfAttemptId: previousAttempt.attemptId }),
    executorProfile: run.executorProfile
  };
  const isIntegration = node.kind === "root" || node.kind === "composite" || node.kind === "integrator";
  return {
    input: { runId: run.runId, waveId, attemptId, inputFingerprint, ...(priorFailure === undefined ? {} : { priorFailure }), graph: run.graph, node, contract, consumedArtifacts, executorProfile: run.executorProfile },
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

/**
 * The decision is addressed to whoever can fix the failure, which for a
 * composite is usually one of its children rather than the composite itself.
 */
function decisionFact(
  attempt: PreparedAttempt,
  at: string,
  reason: string,
  blockers: readonly ExecutionBlocker[] = []
): RunEventInput {
  const route = routeRepair({
    failedNodeId: attempt.input.node.id,
    failureReason: reason,
    graph: attempt.input.graph,
    consumedArtifacts: attempt.input.consumedArtifacts.map((artifact) => ({
      artifactId: artifact.contract.id,
      producerNodeId: artifact.nodeId
    }))
  });
  // The blocked scope always includes the node that failed, because its result
  // cannot stand. When the repair belongs to another node, that node is blocked
  // too: it is about to be attempted again. Blocking only the repair target
  // would leave the failed composite free to be re-selected immediately, which
  // spins the wave loop instead of waiting for the operator.
  const affectedNodeIds = [...new Set([
    attempt.input.node.id,
    ...(route.kind === "retry_node" ? [route.nodeId] : [])
  ])].sort();
  const repairTargetNodeId = route.kind === "retry_node" ? route.nodeId : undefined;
  // A blocked node never ran, so there is no attempt to repeat: the check that
  // stopped it reads the contract and the repository, both unchanged by a
  // retry. Offering one spends an operator's decision on a certainty.
  const blocked = blockers.length > 0;
  const kind = blocked || route.kind === "amend_plan" ? "approve_amendment" as const : "resolve_conflict" as const;
  const options = blocked
    ? [
      { id: "amend", label: "Amend the plan" },
      { id: "stop", label: "Stop this work" }
    ]
    : route.kind === "amend_plan"
    ? [
      { id: "amend", label: "Amend the plan" },
      { id: "stop", label: "Stop this work" }
    ]
    : route.kind === "effect_policy"
      ? [
        { id: "retry", label: "Retry after fixing the environment" },
        { id: "stop", label: "Stop this work" }
      ]
      : [
        { id: "retry", label: "Retry with guidance" },
        { id: "stop", label: "Stop this work" }
      ];
  return fact(`${attempt.input.attemptId}:decision`, at, "decision.raised", {
    decision: {
      id: `${attempt.input.attemptId}:decision`,
      kind,
      question: blocked
        ? `${attempt.input.node.title} cannot start: ${reason}`
        : `Execution for ${attempt.input.node.title} requires guidance: ${reason}`,
      options,
      ...(blocked ? { blockers: [...blockers] } : {}),
      affectedNodeIds,
      ...(repairTargetNodeId === undefined ? {} : { repairTargetNodeId }),
      evidenceRefs: [attempt.input.attemptId, `input-fingerprint:${attempt.input.inputFingerprint}`],
      impact: "behavior",
      raisedAtGraphRevision: attempt.input.graph.revision
    }
  });
}
