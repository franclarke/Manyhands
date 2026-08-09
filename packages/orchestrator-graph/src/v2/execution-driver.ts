import {
  TaskContractBundleSchema,
  type ArtifactContract,
  type TaskContractBundle
} from "@manyhands/contracts";
import type { ConflictConstraintEvidence } from "@manyhands/conflict-risk";
import type { FinalArtifactManifest, GranularityPolicyManifest } from "@manyhands/shared";
import {
  computeInputFingerprint,
  adoptAttemptResult,
  classifyFailure,
  recoveryPolicyFor,
  type AdoptedArtifact,
  type AttemptUsage,
  type DecisionInput,
  type EvidenceMatrixRecord,
  type FailureObservation,
  type ConflictEvidenceEvent,
  type SchedulerConfigEvent,
  type SchedulerExplanationEvent,
  type SchedulerStateEvent,
  type RunCoordinator,
  type RunEventInput,
  type RunProjection
} from "@manyhands/run-coordinator";
import { selectReadyWaveV2, type ReadinessExplanationV2, type ReadinessStateV2 } from "@manyhands/scheduler";
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
  granularityPolicy?: GranularityPolicyManifest;
}

export interface V2RepairObservation {
  kind: "code" | "integration";
  pass: number;
  evidenceRefs: string[];
}

export interface V2FailureCause {
  source: "artifact" | "executor" | "scope" | "integration";
  code: string;
  artifactId?: string;
  producerNodeId?: string;
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
      finalManifest?: FinalArtifactManifest;
    }
  | {
      kind: "failure";
      reason: string;
      usage?: AttemptUsage;
      integrationManifestId?: string;
      candidateCommit?: string;
      evidenceMatrix?: EvidenceMatrixRecord;
      failureCause?: V2FailureCause;
      repairObservations?: V2RepairObservation[];
      decision?: DecisionInput;
    };

export interface V2ExecutionDriverOptions {
  coordinator: RunCoordinator;
  execute(input: V2NodeExecutionInput): Promise<V2NodeExecutionOutcome>;
  loadCurrentInputs(): Promise<V2ExecutionFreshnessInputs>;
  now(): string;
}

export interface V2ExecutionFreshnessInputs {
  graph: GraphRevision;
  contracts: TaskContractBundle[];
  repositoryContextDigest: string;
  executorProfile: V2ExecutorProfile;
  materializableNodeIds: string[];
  availableExecutorNodeIds: string[];
  activeResourceNodeIds?: string[];
  openCircuitBreakerNodeIds?: string[];
  budgetAvailable?: boolean;
  evaluatedAt?: string;
  conflictConstraints: ConflictConstraintEvidence[];
}

export interface V2ExecutionRunInput {
  runId: string;
  graph: GraphRevision;
  contracts: TaskContractBundle[];
  repositoryContextDigest: string;
  executorProfile: V2ExecutorProfile;
  granularityPolicy?: GranularityPolicyManifest;
  effectiveConfig: { maxParallel: number; maxTokensTotal?: number; maxCostUsd?: number; automaticRetryBudget?: number };
  materializableNodeIds: string[];
  availableExecutorNodeIds: string[];
  activeResourceNodeIds?: string[];
  openCircuitBreakerNodeIds?: string[];
  budgetAvailable?: boolean;
  evaluatedAt?: string;
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
    let prepared = prepare(input);
    const runtime = createRuntimeState();
    let maxWaves = input.maxWaves ?? Object.keys(prepared.graph.nodes).length * 3;
    for (let wave = 0; wave < maxWaves; wave += 1) {
      const current = await this.options.coordinator.load(input.runId);
      const staleAttemptIds = new Set(
        Object.values(current.attempts)
          .filter((attempt) => attempt.status === "stale")
          .map((attempt) => attempt.attemptId)
      );
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
      const advanced = await this.advance(prepared, current, runtime);
      if (!advanced.dispatched) return advanced.state;
      if (advanced.state.lifecycle !== "running" && advanced.state.lifecycle !== "waiting_for_input") return advanced.state;
      const becameStale = Object.values(advanced.state.attempts).some(
        (attempt) => attempt.status === "stale" && !staleAttemptIds.has(attempt.attemptId)
      );
      if (becameStale) {
        const loaded = await this.options.loadCurrentInputs();
        prepared = prepare({
          ...input,
          graph: loaded.graph,
          contracts: loaded.contracts,
          repositoryContextDigest: loaded.repositoryContextDigest,
          executorProfile: loaded.executorProfile,
          materializableNodeIds: loaded.materializableNodeIds,
          availableExecutorNodeIds: loaded.availableExecutorNodeIds,
          ...(loaded.activeResourceNodeIds !== undefined ? { activeResourceNodeIds: loaded.activeResourceNodeIds } : {}),
          ...(loaded.openCircuitBreakerNodeIds !== undefined ? { openCircuitBreakerNodeIds: loaded.openCircuitBreakerNodeIds } : {}),
          ...(loaded.budgetAvailable !== undefined ? { budgetAvailable: loaded.budgetAvailable } : {}),
          ...(loaded.evaluatedAt !== undefined ? { evaluatedAt: loaded.evaluatedAt } : {}),
          conflictConstraints: loaded.conflictConstraints
        });
        if (input.maxWaves === undefined) {
          maxWaves = Math.max(maxWaves, wave + 1 + Object.keys(prepared.graph.nodes).length * 3);
        }
      }
    }
    throw new Error(`Execution exceeded ${maxWaves} waves without reaching a stable state.`);
  }

  private async advance(
    input: PreparedExecutionRunInput,
    current: RunProjection,
    runtime: RuntimeReadinessState
  ): Promise<{ dispatched: boolean; state: RunProjection }> {
    const readinessState = buildReadinessState(input, current, runtime);
    const effectiveConfig = schedulerConfigFor(input.effectiveConfig);
    // Concurrency is a property of the run, not of a batch: nodes already
    // running occupy slots, so only what is left may be dispatched now.
    const freeSlots = Math.max(0, effectiveConfig.maxParallel - runtime.inFlight.size);
    const selection = selectReadyWaveV2({
      graph: input.graph,
      nodeIds: Object.keys(input.graph.nodes).sort(),
      state: readinessState,
      // The selector demands a positive cap; when nothing is free we discard
      // its choice below rather than let it believe it had room.
      effectiveConfig: { ...effectiveConfig, maxParallel: Math.max(1, freeSlots) },
      conflictConstraints: input.conflictConstraints,
      now: input.evaluatedAt ?? this.options.now()
    });
    if (freeSlots === 0) selection.nodeIds = [];
    const pendingDecisionIds = Object.values(current.decisions)
      .filter((decision) => decision.status === "pending")
      .map((decision) => decision.id)
      .sort();
    const observeReadiness = (decisionIds: string[]): Promise<RunProjection> =>
      this.options.coordinator.execute(input.runId, {
        type: "observe_readiness",
        readyNodeIds: selection.nodeIds,
        pendingDecisionIds: decisionIds,
        explanations: selection.explanations as unknown as SchedulerExplanationEvent[],
        effectiveConfig: effectiveConfig as SchedulerConfigEvent,
        schedulerState: {
          materializableNodeIds: readinessState.materializableNodeIds,
          activeResourceNodeIds: readinessState.activeResourceNodeIds,
          openCircuitBreakerNodeIds: readinessState.openCircuitBreakerNodeIds ?? [],
          availableExecutorNodeIds: readinessState.availableExecutorNodeIds,
          stoppedNodeIds: readinessState.stoppedNodeIds ?? [],
          budgetAvailable: readinessState.budgetAvailable
        } as SchedulerStateEvent,
        budgetAvailable: readinessState.budgetAvailable,
        conflictEvidence: selection.effectiveConflictConstraints as unknown as ConflictEvidenceEvent[],
        evaluatedAt: input.evaluatedAt ?? this.options.now()
      });
    let state = await observeReadiness(pendingDecisionIds);
    if (state.lifecycle !== "running" || selection.nodeIds.length === 0) {
      // Work already running may still unblock more, so a run with attempts in
      // flight is never idle and never blocked. Deciding otherwise here would
      // raise a scheduler decision about an executor that is busy, not stuck,
      // and park the run at `waiting_for_input` while its own leaves finish.
      if (state.lifecycle === "running" && runtime.inFlight.size > 0) {
        return { dispatched: true, state: await this.settleOne(input, runtime) };
      }
      if (state.lifecycle === "running" && selection.nodeIds.length === 0 && pendingSchedulerDecision(selection.explanations)) {
        const decisionId = `${input.runId}:scheduler:${state.selectedWaves.length + 1}`;
        state = await this.options.coordinator.execute(input.runId, {
          type: "raise_decision",
          decision: {
            id: decisionId,
            kind: "resolve_conflict",
            question: "Scheduling is blocked by an unavailable executor, exhausted budget, or open circuit breaker.",
            options: [
              { id: "fix_environment", label: "Fix the blocked resource" },
              { id: "stop", label: "Stop affected work" }
            ],
            affectedNodeIds: selection.explanations.filter((explanation) => !explanation.ready).map((explanation) => explanation.nodeId),
            evidenceRefs: selection.explanations.flatMap((explanation) => explanation.reasons.map((reason) => reason.code)),
            impact: "risk",
            raisedAtGraphRevision: input.graph.revision
          }
        });
        // Raising the decision does not park the run by itself — a decision blocks
        // the nodes it names, not the run. Readiness is observed again with the new
        // decision so the canonical rule sees "nothing ready, something pending"
        // and parks it, instead of returning a `running` run with no way forward.
        state = await observeReadiness([...pendingDecisionIds, decisionId].sort());
      }
      // A lifecycle that stopped being `running` still has to drain: its
      // attempts hold real processes and their outcomes are facts.
      if (runtime.inFlight.size > 0) return { dispatched: true, state: await this.settleOne(input, runtime) };
      return { dispatched: false, state };
    }

    const waveId = `${input.runId}:wave:${state.selectedWaves.length + 1}`;
    state = await this.options.coordinator.execute(input.runId, {
      type: "select_wave",
      waveId,
      nodeIds: selection.nodeIds,
      maxParallel: effectiveConfig.maxParallel,
      blocked: selection.explanations.filter((explanation) => !selection.nodeIds.includes(explanation.nodeId)) as unknown as SchedulerExplanationEvent[],
      effectiveConfig: effectiveConfig as SchedulerConfigEvent,
      conflictEvidence: selection.effectiveConflictConstraints as unknown as ConflictEvidenceEvent[],
      evaluatedAt: input.evaluatedAt ?? this.options.now()
    });

    const startedAt = this.options.now();
    const attempts = selection.nodeIds.map((nodeId) => createAttempt(input, state, nodeId, waveId, startedAt));
    state = await this.options.coordinator.record(
      input.runId,
      attempts.map((attempt) => attempt.startedEvent)
    );

    // Dispatch is fire-and-track: the batch is started, then exactly one
    // completion is settled. A wave used to be a barrier — every node waited
    // for the slowest of its batch even when its own dependencies had long
    // landed — and that barrier is the wall-clock the redesign is reclaiming.
    for (const attempt of attempts) {
      runtime.inFlight.set(attempt.nodeId, {
        attempt,
        settled: this.options.execute(attempt.executionInput).then(
          (outcome) => ({ nodeId: attempt.nodeId, outcome }),
          (error: unknown) => ({ nodeId: attempt.nodeId, error })
        )
      });
    }
    return { dispatched: true, state: await this.settleOne(input, runtime) };
  }

  /**
   * Awaits the first attempt to finish and records it.
   *
   * Settling one at a time is what makes the record path serial without a
   * queue: the losers of the race stay pending and are settled by a later call.
   * Their promises never reject — a failure travels as a value — so a loser
   * that fails while another is being recorded cannot become an unhandled
   * rejection.
   */
  private async settleOne(
    input: PreparedExecutionRunInput,
    runtime: RuntimeReadinessState
  ): Promise<RunProjection> {
    const finished = await Promise.race([...runtime.inFlight.values()].map((entry) => entry.settled));
    const entry = runtime.inFlight.get(finished.nodeId);
    if (entry === undefined) throw new Error(`Settled attempt for ${finished.nodeId} is not in flight.`);
    runtime.inFlight.delete(finished.nodeId);
    if (finished.error !== undefined) throw finished.error;
    const outcome = finished.outcome!;
    applyRuntimeRecovery(runtime, input, entry.attempt, outcome);
    return this.options.coordinator.recordDerived(input.runId, async (current) => {
      const currentFingerprint = outcome.kind === "success"
        ? await this.currentFingerprint(input, entry.attempt, current)
        : entry.attempt.executionInput.inputFingerprint;
      return this.factsForOutcome(input, entry.attempt, outcome, currentFingerprint, current);
    });
  }

  private factsForOutcome(
    run: PreparedExecutionRunInput,
    attempt: PreparedAttempt,
    outcome: V2NodeExecutionOutcome,
    currentFingerprint: string,
    current: RunProjection
  ): Promise<RunEventInput[]> {
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
        attemptId: attempt.attemptId,
        nodeId: attempt.nodeId,
        failureClass,
        observation,
        allowedActions: policy.actions,
        automaticRetryBudget: retryBudgetFor(run, policy.automaticRetryBudget),
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
          attemptId: attempt.attemptId,
          nodeId: attempt.nodeId,
          failureClass,
          observation,
          allowedActions: policy.actions,
          automaticRetryBudget: retryBudgetFor(run, policy.automaticRetryBudget),
          discardCandidate: policy.discardCandidate
        }));
      }
      let failureDecision: DecisionInput | undefined;
      facts.push(isComposite
        ? fact(`${attempt.attemptId}:integration-failed`, at, "integration.failed", {
            attemptId: attempt.attemptId,
            nodeId: attempt.nodeId,
            ...(outcome.integrationManifestId !== undefined ? { manifestId: outcome.integrationManifestId } : {}),
            ...(outcome.candidateCommit !== undefined ? { candidateCommit: outcome.candidateCommit } : {}),
            ...(outcome.evidenceMatrix !== undefined ? { matrix: outcome.evidenceMatrix } : {}),
            reason: outcome.reason,
            decisionRequired: false
          })
        : fact(`${attempt.attemptId}:failed`, at, "attempt.failed", {
            attemptId: attempt.attemptId,
            nodeId: attempt.nodeId,
            reason: outcome.reason,
            // A condition that burns tokens and delivers nothing is exactly the
            // cost the comparative study needs to see.
            ...(outcome.usage !== undefined ? { usage: outcome.usage } : {})
          }));
      const observation = isComposite
        ? { source: "integration" as const, code: "integration_failed", message: outcome.reason }
        : leafFailureObservation(outcome);
      const failureClass = classifyFailure(observation);
      const policy = recoveryPolicyFor(failureClass);
      if (!isComposite && policy.discardCandidate && failureClass === "scope_unexpected_commit") {
        facts.push(fact(`${attempt.attemptId}:discarded`, at, "attempt.discarded", {
          attemptId: attempt.attemptId,
          nodeId: attempt.nodeId,
          reason: `Candidate discarded after ${failureClass}: ${outcome.reason}`
        }));
      }
      const retryBudget = retryBudgetFor(run, policy.automaticRetryBudget);
      const priorFailures = Object.values(current.attempts).filter((candidate) =>
        candidate.nodeId === attempt.nodeId && candidate.status === "failed"
      ).length;
      const retryAllowed = !isComposite && failureClass === "transient" && priorFailures < retryBudget;
      if (isComposite || !retryAllowed || outcome.decision !== undefined) {
        failureDecision = { ...(outcome.decision ?? defaultFailureDecision(attempt, outcome.reason, outcome.failureCause)), raisedAtGraphRevision: run.graph.revision };
        facts.push(fact(`${attempt.attemptId}:decision:${failureDecision.id}`, at, "decision.raised", { decision: failureDecision }));
      }
      if (isComposite) {
        const integrationEvent = facts.find((fact): fact is Extract<RunEventInput, { type: "integration.failed" }> => fact.type === "integration.failed");
        if (integrationEvent !== undefined) integrationEvent.payload.decisionRequired = failureDecision !== undefined;
      }
      return Promise.resolve(facts);
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
      return Promise.resolve(facts);
    }

    // Adopt EVERY artifact contract this node produces, not just its node-result.
    // A planner-declared artifact between siblings compiles into an
    // execution-phase requirement; adopting only the node-result left that
    // requirement permanently unsatisfied, so its consumers never became ready
    // and the run went quiet with no failure and no decision. A stall that
    // reports nothing is worse than a failure -- it looks like work in progress.
    // The verified candidate is the evidence for all of them, so they share its
    // digest and location.
    return this.adoptionFacts(run, attempt, outcome, currentFingerprint, at, facts);
  }

  private async adoptionFacts(
    run: PreparedExecutionRunInput,
    attempt: PreparedAttempt,
    outcome: Extract<V2NodeExecutionOutcome, { kind: "success" }>,
    currentFingerprint: string,
    at: string,
    facts: RunEventInput[]
  ): Promise<RunEventInput[]> {
    const produced = producedArtifactContracts(attempt);
    for (const [index, contract] of produced.entries()) {
      let eligible = false;
      await adoptAttemptResult({
        attempt: {
          schemaVersion: 1,
          attemptId: attempt.attemptId,
          runId: run.runId,
          nodeId: attempt.nodeId,
          inputFingerprint: attempt.executionInput.inputFingerprint,
          createdAt: attempt.startedEvent.occurredAt,
          status: "finished",
          outputDigest: outcome.outputDigest
        },
        currentFingerprint,
        artifact: {
          artifactId: `${contract.id}:${attempt.attemptId}`,
          contract: { id: contract.id, revision: contract.revision },
          kind: "commit",
          location: outcome.artifactLocation
        },
        adoptedAt: at
      }, {
        stage: async (decision) => {
          eligible = decision.eligible;
          facts.push(fact(
            decision.eligible
              ? (index === 0 ? `${attempt.attemptId}:artifact-adopted` : `${attempt.attemptId}:artifact-adopted:${index}`)
              : `${attempt.attemptId}:stale`,
            at,
            decision.event.type,
            decision.event.payload
          ));
        }
      });
      if (!eligible) return facts;
    }
    if (attempt.nodeId === run.graph.rootId) {
      if (outcome.finalManifestId === undefined) throw new Error("The root execution outcome requires a final manifest id.");
      if (outcome.finalManifest === undefined) throw new Error("The root execution outcome requires the complete final artifact manifest.");
      facts.push(fact(`${attempt.attemptId}:final-candidate`, at, "final_candidate.verified", {
        manifestId: outcome.finalManifestId,
        commit: outcome.candidateCommit,
        evidenceMatrixId: outcome.evidenceMatrix.matrixId,
        evidenceEligible: true,
        executionSucceeded: true,
        sourceTargetFingerprint: run.target.sourceTargetFingerprint,
        targetBranch: run.target.targetBranch,
        targetHead: run.target.targetHead,
        ...(outcome.finalManifest !== undefined ? { finalManifest: outcome.finalManifest } : {})
      }));
    }
    return facts;
  }

  private async currentFingerprint(
    initial: PreparedExecutionRunInput,
    attempt: PreparedAttempt,
    current: RunProjection
  ): Promise<string> {
    const loaded = await this.options.loadCurrentInputs();
    const prepared = prepare({
      ...initial,
      graph: loaded.graph,
      contracts: loaded.contracts,
      repositoryContextDigest: loaded.repositoryContextDigest,
      executorProfile: loaded.executorProfile
    });
    if (prepared.graph.nodes[attempt.nodeId] === undefined || !prepared.contractsByNodeId.has(attempt.nodeId)) {
      return `sha256:absent:${prepared.graph.graphId}:${prepared.graph.revision}:${attempt.nodeId}`;
    }
    return fingerprintForNode(prepared, current, attempt.nodeId);
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

interface InFlightAttempt {
  attempt: PreparedAttempt;
  /** Never rejects: a failure is carried so the loser of a race stays safe. */
  settled: Promise<{ nodeId: string; outcome?: V2NodeExecutionOutcome; error?: unknown }>;
}

interface RuntimeReadinessState {
  suspendedNodeIds: Set<string>;
  openCircuitBreakerNodeIds: Set<string>;
  /** Attempts dispatched and not yet settled, keyed by node. */
  inFlight: Map<string, InFlightAttempt>;
}

function createRuntimeState(): RuntimeReadinessState {
  return { suspendedNodeIds: new Set(), openCircuitBreakerNodeIds: new Set(), inFlight: new Map() };
}

function prepare(input: V2ExecutionRunInput): PreparedExecutionRunInput {
  const graph = GraphRevisionSchema.parse(input.graph);
  if (!Number.isInteger(input.effectiveConfig.maxParallel) || input.effectiveConfig.maxParallel < 1) {
    throw new Error("V2 execution requires a persisted positive maxParallel.");
  }
  if (input.effectiveConfig.automaticRetryBudget !== undefined &&
      (!Number.isInteger(input.effectiveConfig.automaticRetryBudget) || input.effectiveConfig.automaticRetryBudget < 0)) {
    throw new Error("V2 execution requires a non-negative integer automaticRetryBudget when configured.");
  }
  const contracts = input.contracts.map((bundle) => TaskContractBundleSchema.parse(bundle));
  const contractsByNodeId = new Map(contracts.map((bundle) => [bundle.task.nodeId, bundle]));
  for (const nodeId of Object.keys(graph.nodes)) {
    if (!contractsByNodeId.has(nodeId)) throw new Error(`Graph node ${nodeId} has no V2 contract bundle.`);
  }
  return { ...input, graph, contracts, contractsByNodeId };
}

function buildReadinessState(input: PreparedExecutionRunInput, state: RunProjection, runtime: RuntimeReadinessState): ReadinessStateV2 {
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
    activeResourceNodeIds: [...new Set([
      ...(input.activeResourceNodeIds ?? []),
      ...Object.values(state.attempts).filter((attempt) => attempt.status === "running").map((attempt) => attempt.nodeId),
      // An attempt the driver dispatched and has not settled is running,
      // whatever the projection says. Under wave scheduling the distinction
      // never surfaced — the batch was awaited before readiness was consulted
      // again — but with continuous dispatch a projection that lags by one
      // event would hand back a node that is running and start it twice.
      ...runtime.inFlight.keys()
    ])],
    budgetAvailable: input.budgetAvailable !== false && budgetAvailableFor(input, state),
    openCircuitBreakerNodeIds: [...new Set([
      ...(input.openCircuitBreakerNodeIds ?? []),
      ...runtime.openCircuitBreakerNodeIds,
      ...(hasUnresolvedRecovery(state, "shared_infrastructure") ? Object.keys(input.graph.nodes) : [])
    ])],
    stoppedNodeIds: state.stoppedNodeIds ?? [],
    availableExecutorNodeIds: input.availableExecutorNodeIds.filter((nodeId) =>
      !suspendedByRecovery(state).has(nodeId) && !runtime.suspendedNodeIds.has(nodeId)
    ),
    adoptedNodeIds: [...new Set(Object.values(state.adoptedArtifacts).map((artifact) => artifact.nodeId))],
    currentContractRevisions,
    requiredContractRevisions
  };
}

function hasUnresolvedRecovery(state: RunProjection, failureClass: "shared_infrastructure"): boolean {
  const affectedNodeIds = new Set(
    state.recoveryHistory
      .filter((entry) => entry.kind === "failure" && entry.failureClass === failureClass && entry.nodeId !== undefined)
      .map((entry) => entry.nodeId!)
  );
  return affectedNodeIds.size > 0 && Object.values(state.decisions).some((decision) =>
    decision.status === "pending" && decision.affectedNodeIds.some((nodeId) => affectedNodeIds.has(nodeId))
  );
}

function suspendedByRecovery(state: RunProjection): Set<string> {
  const pendingNodeIds = new Set(
    Object.values(state.decisions)
      .filter((decision) => decision.status === "pending")
      .flatMap((decision) => decision.affectedNodeIds)
  );
  return new Set(
    state.recoveryHistory
      .filter((entry) => entry.kind === "failure" && entry.failureClass === "environment_auth_executor" && entry.nodeId !== undefined)
      .filter((entry) => pendingNodeIds.has(entry.nodeId!))
      .map((entry) => entry.nodeId!)
  );
}

function budgetAvailableFor(input: PreparedExecutionRunInput, state: RunProjection): boolean {
  const budgetConfigured = input.effectiveConfig.maxTokensTotal !== undefined || input.effectiveConfig.maxCostUsd !== undefined;
  if (budgetConfigured && Object.values(state.attempts).some((attempt) => {
    const usage = attempt.usage;
    return usage === undefined || usage.source === "unavailable" ||
      (input.effectiveConfig.maxTokensTotal !== undefined && usage.tokensTotal === undefined) ||
      (input.effectiveConfig.maxCostUsd !== undefined && usage.costUsd === undefined);
  })) return false;
  const usage = Object.values(state.attempts).reduce((total, attempt) => ({
    tokensTotal: total.tokensTotal + (attempt.usage?.tokensTotal ?? 0),
    costUsd: total.costUsd + (attempt.usage?.costUsd ?? 0)
  }), { tokensTotal: 0, costUsd: 0 });
  return (input.effectiveConfig.maxTokensTotal === undefined || usage.tokensTotal < input.effectiveConfig.maxTokensTotal) &&
    (input.effectiveConfig.maxCostUsd === undefined || usage.costUsd < input.effectiveConfig.maxCostUsd);
}

function schedulerConfigFor(config: PreparedExecutionRunInput["effectiveConfig"]): PreparedExecutionRunInput["effectiveConfig"] {
  return config.maxTokensTotal !== undefined || config.maxCostUsd !== undefined
    ? { ...config, maxParallel: 1 }
    : config;
}

function retryBudgetFor(input: PreparedExecutionRunInput, policyDefault: number): number {
  return input.effectiveConfig.automaticRetryBudget ?? policyDefault;
}

function pendingSchedulerDecision(explanations: ReadinessExplanationV2[]): boolean {
  return explanations.some((explanation) => explanation.reasons.some((reason) =>
    reason.code === "executor_unavailable" || reason.code === "budget_exhausted" || reason.code === "circuit_breaker_open" || reason.code === "active_resource_constraint"
  ));
}

export function orderArtifactRequirementsForMaterialization<T extends GraphRevision["artifactRequirements"][number]>(
  requirements: readonly T[],
  allRequirements: readonly T[]
): T[] {
  const dependencies = new Map<string, Set<string>>();
  for (const requirement of allRequirements) {
    if (requirement.requiredFor !== "execution") continue;
    const producerDependencies = dependencies.get(requirement.consumerNodeId) ?? new Set<string>();
    producerDependencies.add(requirement.producerNodeId);
    dependencies.set(requirement.consumerNodeId, producerDependencies);
  }

  const remaining = [...requirements];
  const ordered: T[] = [];
  while (remaining.length > 0) {
    const ready = remaining.filter((requirement) => {
      const producerDependencies = dependencies.get(requirement.producerNodeId) ?? new Set<string>();
      return !remaining.some((candidate) => candidate !== requirement && producerDependencies.has(candidate.producerNodeId));
    });
    if (ready.length === 0) return [...ordered, ...remaining];
    // Independent siblings have no semantic ordering. Tie-break by the
    // stable requirement id so a crash/restart materializes the same sequence
    // regardless of how the graph revision was assembled.
    const next = ready.slice().sort((left, right) => left.id.localeCompare(right.id))[0]!;
    const nextIndex = remaining.indexOf(next);
    ordered.push(remaining.splice(nextIndex, 1)[0]!);
  }
  return ordered;
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
  const requirements = orderArtifactRequirementsForMaterialization(
    run.graph.artifactRequirements.filter(
      (requirement) => requirement.consumerNodeId === nodeId && phases.has(requirement.requiredFor)
    ),
    run.graph.artifactRequirements
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
  const inputFingerprint = fingerprintForNode(run, state, nodeId);
  const previousAttempt = Object.values(state.attempts)
    .filter((attempt) => attempt.nodeId === nodeId && ["failed", "discarded", "stale"].includes(attempt.status))
    .at(-1);
  const ordinal = Object.values(state.attempts).filter((attempt) => attempt.nodeId === nodeId).length + 1;
  const attemptId = `${run.runId}:attempt:${nodeId}:${ordinal}`;
  const common = { attemptId, nodeId, inputFingerprint, ...(previousAttempt !== undefined ? { retryOfAttemptId: previousAttempt.attemptId } : {}), executorProfile: run.executorProfile };
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
      executorProfile: run.executorProfile,
      ...(run.granularityPolicy === undefined ? {} : { granularityPolicy: run.granularityPolicy })
    }
  };
}

function fingerprintForNode(run: PreparedExecutionRunInput, state: RunProjection, nodeId: string): string {
  const node = run.graph.nodes[nodeId]!;
  const contract = run.contractsByNodeId.get(nodeId)!;
  const phases = node.kind === "root" || node.kind === "composite"
    ? new Set(["execution", "integration"])
    : new Set(["execution"]);
  const requirements = orderArtifactRequirementsForMaterialization(
    run.graph.artifactRequirements.filter(
      (requirement) => requirement.consumerNodeId === nodeId && phases.has(requirement.requiredFor)
    ),
    run.graph.artifactRequirements
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
  const contractRevisions = [contract.task, contract.scope, contract.validation, ...contract.seams, ...contract.artifacts]
    .map(({ id, revision }) => ({ id, revision }));
  return computeInputFingerprint({
    graphId: run.graph.graphId,
    nodeId,
    contractRevisions,
    baseCommit: run.graph.baseCommit,
    consumedArtifacts: consumedArtifacts.map((artifact) => ({ id: artifact.artifactId, digest: artifact.digest })),
    repositoryContextDigest: run.repositoryContextDigest,
    executorProfile: run.executorProfile,
    validationContract: { id: contract.validation.id, revision: contract.validation.revision }
  });
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

function defaultFailureDecision(attempt: PreparedAttempt, reason: string, cause?: V2FailureCause): DecisionInput {
  const affectedNodeIds = [...new Set([attempt.nodeId, ...(cause?.producerNodeId === undefined ? [] : [cause.producerNodeId])])];
  const causeEvidence = [
    ...(cause?.artifactId === undefined ? [] : [`artifact:${cause.artifactId}`]),
    ...(cause?.code === undefined ? [] : [`failure:${cause.code}`])
  ];
  return {
    id: `${attempt.attemptId}:decision`,
    kind: "resolve_conflict",
    question: `The work for ${attempt.executionInput.node.title} needs guidance: ${reason}`,
    options: [
      { id: "retry", label: "Retry with guidance" },
      { id: "stop", label: "Stop this branch" }
    ],
    affectedNodeIds,
    evidenceRefs: [...causeEvidence, attempt.attemptId, `input-fingerprint:${attempt.executionInput.inputFingerprint}`],
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
export function leafFailureObservation(outcome: { reason: string; failureCause?: V2FailureCause }): FailureObservation {
  if (outcome.failureCause !== undefined) {
    return {
      source: outcome.failureCause.source,
      code: outcome.failureCause.code,
      ...(outcome.failureCause.artifactId === undefined ? {} : { artifactId: outcome.failureCause.artifactId }),
      ...(outcome.failureCause.producerNodeId === undefined ? {} : { producerNodeId: outcome.failureCause.producerNodeId }),
      message: outcome.reason
    };
  }
  if (outcome.reason.includes("artifact_empty")) {
    return { source: "artifact", code: "artifact_empty", message: outcome.reason };
  }
  const knownCodes = ["scope_violation", "unexpected_commit", "worktree_pool_unavailable", "transient", "network", "timeout", "auth", "binary_missing", "quota", "executor_unavailable", "model_not_found"];
  const code = knownCodes.find((candidate) =>
    outcome.reason.trimStart().startsWith(`${candidate}:`) || outcome.reason.includes(`: ${candidate}:`)
  ) ?? outcome.reason.split(":", 1)[0]?.trim();
  if (code === "scope_violation" || code === "unexpected_commit") {
    return { source: "scope", code, message: outcome.reason };
  }
  if (outcome.reason.includes("update_ref failed") && outcome.reason.includes("unable to create directory")) {
    return { source: "executor", code: "workspace_ref_rejected", message: outcome.reason };
  }
  if (code === "worktree_pool_unavailable") {
    return { source: "executor", code, message: outcome.reason };
  }
  if (["transient", "network", "timeout"].includes(code ?? "")) {
    return { source: "executor", code: code === "timeout" ? "transient" : code, timedOut: code === "timeout", message: outcome.reason };
  }
  if (["auth", "binary_missing", "quota", "executor_unavailable", "model_not_found"].includes(code ?? "")) {
    return { source: "executor", code, message: outcome.reason };
  }
  return { source: "executor", code: "execution_failed", message: outcome.reason };
}

function applyRuntimeRecovery(
  runtime: RuntimeReadinessState,
  input: PreparedExecutionRunInput,
  attempt: PreparedAttempt,
  outcome: V2NodeExecutionOutcome
): void {
  if (outcome.kind !== "failure") return;
  const observation = attempt.startedEvent.type === "integration.started"
    ? { source: "integration" as const, code: "integration_failed", message: outcome.reason }
    : leafFailureObservation(outcome);
  const failureClass = classifyFailure(observation);
  if (failureClass === "environment_auth_executor") {
    runtime.suspendedNodeIds.add(attempt.nodeId);
  }
  if (failureClass === "shared_infrastructure") {
    for (const nodeId of Object.keys(input.graph.nodes)) runtime.openCircuitBreakerNodeIds.add(nodeId);
  }
}
