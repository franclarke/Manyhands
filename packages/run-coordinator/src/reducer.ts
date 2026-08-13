import type { EffectIntent, PhysicalEffectReceipt } from "@manyhands/contracts";
import type { CommandReceipt } from "./command-envelope.js";
import { DecisionSchema, type Decision } from "./domain/decisions.js";
import { RunEventSchema, type RunEvent } from "./domain/events.js";
import { assertLifecycleTransition, type RunLifecycle } from "./domain/lifecycle.js";
import { INITIAL_RUN_OUTCOMES, type DeliveryApproval, type DeliveryReceipt, type FinalCandidate, type RunOutcomes } from "./domain/outcomes.js";
import type { AdoptedArtifact } from "./domain/artifacts.js";
import type { AttemptUsage, PlanningCandidateEvaluation, PlanningCandidateSelection } from "./domain/events.js";
import type { FailureClass } from "./domain/failures.js";
import type { ProductRunDefinition } from "./product-lifecycle.js";
import type { RunCommandEnvelope } from "./command-envelope.js";

export interface AttemptProjection {
  attemptId: string;
  nodeId: string;
  inputFingerprint: string;
  retryOfAttemptId?: string;
  kind: "execution" | "integration";
  status: "running" | "candidate" | "validated" | "adopted" | "failed" | "discarded" | "stale";
  candidateCommit?: string;
  outputDigest?: string;
  repairPasses: number;
  failureReason?: string;
  usage?: AttemptUsage;
}

export interface IntegrationProjection {
  attemptId: string;
  nodeId: string;
  requiredArtifactIds: string[];
  status: "running" | "completed" | "failed" | "decision_required";
  manifestId?: string;
  candidateCommit?: string;
  evidenceMatrixId?: string;
  repairPasses: number;
  failureReason?: string;
}

export interface GranularityStrategyAssessmentProjection {
  unitKey: string;
  nodeId: string;
  selected: "leaf" | "split" | "semantic_replan";
  leafFeasible: boolean;
  splitViable: boolean;
  /** Which of the three reasons carried the decision. */
  reasons: { doesNotFit: boolean; runsInParallel: boolean; verifiableApart: boolean };
  evidenceRefs: string[];
  rationale: string;
}

export interface GranularityStrategyProjection {
  policyVersion: string;
  condition: "A" | "C";
  candidateTreeHash: string;
  candidateSourceHash?: string;
  config: { maxLeafContextTokens: number; maxLeafScopePaths: number; maxLeafPlannedPaths: number };
  assessments: Record<string, GranularityStrategyAssessmentProjection>;
  metrics: { maxGraphDepth: number; totalLeafCount: number; averageBranchingFactor: number };
}

export interface PlanningEnvelopeProjection {
  schemaVersion: 1;
  policyVersion: string;
  repositorySnapshotId: string;
  goalDigest: string;
  candidateBudget: { minimum: number; maximum: number };
  executionBudget: { maxLeafContextTokens: number; maxLeafScopePaths: number; maxParallelism: number };
  requirements: {
    requireExplicitAcceptanceOwnership: true;
    requireCompleteSeamSpecifications: true;
    requireObservableLeafValidation: true;
  };
}

export interface PlanningCandidatesProjection {
  schemaVersion: 1;
  envelope: Record<string, unknown>;
  policy?: { version: string; condition: "A" | "B" | "C"; scoreBasis: string };
  candidates: PlanningCandidateEvaluation[];
  selection: PlanningCandidateSelection;
}

export type EffectTerminalProjection =
  | { status: "completed"; receiptId: string }
  | { status: "failed"; receiptId: string; reason: string }
  | { status: "interrupted"; receiptId?: string; reason: string };

export interface RunProjection {
  runId: string;
  goal: string;
  definition?: ProductRunDefinition;
  title?: string;
  archivedAt?: string;
  lifecycle: RunLifecycle;
  sequence: number;
  createdAt: string;
  updatedAt: string;
  appliedEventIds: string[];
  graphId?: string;
  graphRevision?: number;
  approvedGraphRevision?: number;
  granularityStrategy?: GranularityStrategyProjection;
  planningEnvelope?: PlanningEnvelopeProjection;
  planningCandidates?: PlanningCandidatesProjection;
  commandReceipts: Record<string, CommandReceipt>;
  commandEnvelopes: Record<string, RunCommandEnvelope>;
  effectIntents: Record<string, EffectIntent>;
  physicalEffectReceipts: Record<string, PhysicalEffectReceipt>;
  effectTerminals: Record<string, EffectTerminalProjection>;
  decisions: Record<string, Decision>;
  stoppedNodeIds?: string[];
  readiness: { readyNodeIds: string[]; pendingDecisionIds: string[]; explanations?: Array<Record<string, unknown>>; effectiveConfig?: Record<string, unknown>; schedulerState?: Record<string, unknown>; budgetAvailable?: boolean; conflictEvidence?: Array<Record<string, unknown>>; evaluatedAt?: string };
  selectedWaves: Array<{ waveId: string; nodeIds: string[]; maxParallel: number; blocked?: Array<Record<string, unknown>>; effectiveConfig?: Record<string, unknown>; conflictEvidence?: Array<Record<string, unknown>>; evaluatedAt?: string }>;
  attempts: Record<string, AttemptProjection>;
  adoptedArtifacts: Record<string, AdoptedArtifact>;
  nodeEvidenceMatrixIds: Record<string, string>;
  integrations: Record<string, IntegrationProjection>;
  recoveryHistory: Array<{ eventId: string; attemptId?: string; nodeId?: string; kind: "failure" | "amendment"; failureClass?: FailureClass }>;
  evidenceMatrices: string[];
  evidenceMatrixSummaries: Record<string, { candidateCommit: string; outcome: "verified" | "unverified" | "failed"; validationRecipeDigest?: string }>;
  outcomes: RunOutcomes;
  finalCandidate?: FinalCandidate;
  deliveryReceipt?: DeliveryReceipt;
  deliveryApproval?: DeliveryApproval;
  lifecycleBeforePause?: Extract<RunLifecycle, "running" | "waiting_for_input">;
  failureReason?: string;
}

export function foldRun(rawEvents: readonly RunEvent[]): RunProjection {
  if (rawEvents.length === 0) throw new Error("Cannot fold a run without run.created.");
  let state: RunProjection | undefined;
  const seenEventIds = new Set<string>();
  for (const rawEvent of rawEvents) {
    const event = RunEventSchema.parse(rawEvent);
    if (seenEventIds.has(event.eventId)) throw new Error(`Duplicate run event id ${event.eventId}.`);
    seenEventIds.add(event.eventId);
    if (state === undefined) {
      if (event.type !== "run.created" || event.sequence !== 1) throw new Error("The first run event must be run.created at sequence 1.");
      state = {
        runId: event.runId,
        goal: event.payload.goal,
        ...(event.payload.definition === undefined
          ? {}
          : { definition: structuredClone(event.payload.definition), title: event.payload.definition.title }),
        lifecycle: "planning",
        sequence: 1,
        createdAt: event.occurredAt,
        updatedAt: event.occurredAt,
        appliedEventIds: [event.eventId],
        commandReceipts: {},
        commandEnvelopes: {},
        effectIntents: {},
        physicalEffectReceipts: {},
        effectTerminals: {},
        decisions: {},
        stoppedNodeIds: [],
        readiness: { readyNodeIds: [], pendingDecisionIds: [] },
        selectedWaves: [],
        attempts: {},
        adoptedArtifacts: {},
        nodeEvidenceMatrixIds: {},
        integrations: {},
        recoveryHistory: [],
        evidenceMatrices: [],
        outcomes: { ...INITIAL_RUN_OUTCOMES },
        evidenceMatrixSummaries: {}
      };
      continue;
    }
    if (event.runId !== state.runId) throw new Error(`Event ${event.eventId} belongs to another run.`);
    if (event.sequence !== state.sequence + 1) throw new Error(`Expected run event sequence ${state.sequence + 1}, received ${event.sequence}.`);
    state = reduceRun(state, event);
  }
  return state as RunProjection;
}

export function reduceRun(state: RunProjection, event: RunEvent): RunProjection {
  const next = structuredClone(state);
  next.updatedAt = event.occurredAt;
  switch (event.type) {
    case "run.created":
      throw new Error("run.created can only be the first event.");
    case "run.renamed":
      next.title = event.payload.title;
      break;
    case "run.archived":
      if (["planning", "running", "waiting_for_input", "cancelling", "delivering"].includes(next.lifecycle)) {
        throw new Error(`Cannot archive a run while ${next.lifecycle}.`);
      }
      next.archivedAt = event.payload.archivedAt;
      break;
    case "command.accepted": {
      const receipt = event.payload.receipt;
      if (receipt.runId !== next.runId) throw new Error(`Command ${receipt.commandId} belongs to another run.`);
      if (next.commandReceipts[receipt.commandId] !== undefined) throw new Error(`Command ${receipt.commandId} already has an acceptance receipt.`);
      if (
        next.physicalEffectReceipts[receipt.receiptId] !== undefined
        || Object.values(next.commandReceipts).some((existing) => existing.receiptId === receipt.receiptId)
      ) {
        throw new Error(`Command receipt ${receipt.receiptId} already exists.`);
      }
      next.commandReceipts[receipt.commandId] = structuredClone(receipt);
      if (event.payload.command !== undefined) {
        const command = event.payload.command;
        if (
          command.commandId !== receipt.commandId
          || command.runId !== receipt.runId
          || command.commandDigest !== receipt.commandDigest
        ) {
          throw new Error(`Command envelope ${command.commandId} does not bind to its acceptance receipt.`);
        }
        next.commandEnvelopes[command.commandId] = structuredClone(command);
      }
      break;
    }
    case "effect.requested": {
      const intent = event.payload.intent;
      if (intent.runId !== next.runId) throw new Error(`Effect ${intent.effectId} belongs to another run.`);
      if (next.effectIntents[intent.effectId] !== undefined) throw new Error(`Effect ${intent.effectId} already exists.`);
      next.effectIntents[intent.effectId] = structuredClone(intent);
      break;
    }
    case "effect.observed": {
      const receipt = event.payload.receipt;
      if (
        next.physicalEffectReceipts[receipt.receiptId] !== undefined
        || Object.values(next.commandReceipts).some((existing) => existing.receiptId === receipt.receiptId)
      ) throw new Error(`Receipt ${receipt.receiptId} already exists.`);
      const intent = next.effectIntents[receipt.effectId];
      if (intent === undefined) throw new Error(`Physical effect receipt ${receipt.receiptId} has no requested effect ${receipt.effectId}.`);
      if (receipt.inputDigest !== intent.inputDigest) throw new Error(`Physical effect receipt ${receipt.receiptId} does not match effect ${receipt.effectId} input digest.`);
      next.physicalEffectReceipts[receipt.receiptId] = structuredClone(receipt);
      break;
    }
    case "effect.completed": {
      const { effectId, receiptId } = event.payload;
      const receipt = assertEffectTerminalLink(next, effectId, receiptId);
      if (receipt.observation !== "succeeded") {
        throw new Error(`Effect ${effectId} can only complete from a succeeded physical receipt.`);
      }
      next.effectTerminals[effectId] = { status: "completed", receiptId };
      break;
    }
    case "effect.failed": {
      const { effectId, receiptId, reason } = event.payload;
      const receipt = assertEffectTerminalLink(next, effectId, receiptId);
      if (receipt.observation !== "failed") {
        throw new Error(`Effect ${effectId} can only fail from a failed physical receipt.`);
      }
      next.effectTerminals[effectId] = { status: "failed", receiptId, reason };
      break;
    }
    case "effect.interrupted": {
      const { effectId, receiptId, reason } = event.payload;
      assertEffectIntentPending(next, effectId);
      if (receiptId !== undefined) assertEffectReceiptLink(next, effectId, receiptId);
      next.effectTerminals[effectId] = receiptId === undefined
        ? { status: "interrupted", reason }
        : { status: "interrupted", receiptId, reason };
      break;
    }
    case "legacy.run_imported":
      if (next.sequence !== 1 || next.lifecycle !== "planning") throw new Error("A legacy import must immediately follow run.created.");
      next.outcomes.execution = "interrupted";
      next.lifecycle = "interrupted";
      break;
    case "repository.inspected":
    case "planning.attempt_started":
    case "planning.node_discovered":
    case "planning.attempt_failed":
    case "planning.unit_unresolved":
    case "planning.completed":
    case "graph.compiled":
    case "planning.critic_recorded":
      if (next.lifecycle !== "planning" && next.lifecycle !== "needs_approval" && next.lifecycle !== "running") throw new Error(`Cannot record planning facts while ${next.lifecycle}.`);
      break;
    case "planning.granularity_strategy_selected":
      if (next.lifecycle !== "planning" && next.lifecycle !== "needs_approval" && next.lifecycle !== "running") throw new Error(`Cannot record planning facts while ${next.lifecycle}.`);
      next.granularityStrategy = {
        policyVersion: event.payload.policyVersion,
        condition: event.payload.condition,
        candidateTreeHash: event.payload.candidateTreeHash,
        ...(event.payload.candidateSourceHash === undefined ? {} : { candidateSourceHash: event.payload.candidateSourceHash }),
        config: { ...event.payload.config },
        assessments: Object.fromEntries(event.payload.assessments.map((assessment) => [assessment.nodeId, {
          ...assessment,
          reasons: { ...assessment.reasons },
          evidenceRefs: [...assessment.evidenceRefs]
        }])),
        metrics: { ...event.payload.metrics }
      };
      break;
    case "planning.envelope_created":
      if (next.lifecycle !== "planning" && next.lifecycle !== "needs_approval" && next.lifecycle !== "running") throw new Error(`Cannot record planning facts while ${next.lifecycle}.`);
      next.planningEnvelope = {
        schemaVersion: event.payload.schemaVersion,
        policyVersion: event.payload.policyVersion,
        repositorySnapshotId: event.payload.repositorySnapshotId,
        goalDigest: event.payload.goalDigest,
        candidateBudget: { ...event.payload.candidateBudget },
        executionBudget: { ...event.payload.executionBudget },
        requirements: { ...event.payload.requirements }
      };
      break;
    case "planning.candidates_evaluated":
      if (next.lifecycle !== "planning" && next.lifecycle !== "needs_approval" && next.lifecycle !== "running") throw new Error(`Cannot record planning facts while ${next.lifecycle}.`);
      next.planningCandidates = {
        schemaVersion: event.payload.schemaVersion,
        envelope: structuredClone(event.payload.envelope),
        ...(event.payload.policy === undefined ? {} : { policy: { ...event.payload.policy } }),
        candidates: event.payload.candidates.map((candidate) => ({
          ...candidate,
          candidate: structuredClone(candidate.candidate),
          gates: candidate.gates.map((gate) => ({ ...gate, diagnosticCodes: [...gate.diagnosticCodes] })),
          diagnostics: candidate.diagnostics.map((diagnostic) => ({ ...diagnostic, refs: [...diagnostic.refs] }))
        })),
        selection: structuredClone(event.payload.selection)
      };
      break;
    case "planning.failed":
      next.failureReason = event.payload.reason;
      transition(next, "failed");
      break;
    case "attempt.started":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot record execution artifacts while ${next.lifecycle}.`);
      if (next.attempts[event.payload.attemptId] !== undefined) throw new Error(`Attempt ${event.payload.attemptId} already exists.`);
      next.attempts[event.payload.attemptId] = {
        attemptId: event.payload.attemptId,
        nodeId: event.payload.nodeId,
        inputFingerprint: event.payload.inputFingerprint,
        ...(event.payload.retryOfAttemptId !== undefined ? { retryOfAttemptId: event.payload.retryOfAttemptId } : {}),
        kind: "execution",
        status: "running",
        repairPasses: 0
      };
      break;
    case "attempt.repair_attempted": {
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      attempt.repairPasses = Math.max(attempt.repairPasses, event.payload.pass);
      break;
    }
    case "attempt.candidate_created": {
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      if (attempt.status !== "running") throw new Error(`Attempt ${attempt.attemptId} cannot create a candidate while ${attempt.status}.`);
      attempt.status = "candidate";
      attempt.candidateCommit = event.payload.candidateCommit;
      attempt.outputDigest = event.payload.outputDigest;
      if (event.payload.usage !== undefined) attempt.usage = { ...event.payload.usage };
      break;
    }
    case "attempt.failed": {
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      attempt.status = "failed";
      attempt.failureReason = event.payload.reason;
      if (event.payload.usage !== undefined) attempt.usage = { ...event.payload.usage };
      break;
    }
    case "attempt.discarded": {
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      attempt.status = "discarded";
      attempt.failureReason = event.payload.reason;
      break;
    }
    case "attempt.stale": {
      const attempt = next.attempts[event.payload.attemptId];
      if (attempt !== undefined) attempt.status = "stale";
      break;
    }
    case "validation.started":
    case "validation.evidence_recorded":
      requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      break;
    case "validation.completed": {
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      if (attempt.status !== "candidate") throw new Error(`Attempt ${attempt.attemptId} cannot complete validation while ${attempt.status}.`);
      attempt.status = "validated";
      next.nodeEvidenceMatrixIds[event.payload.nodeId] = event.payload.matrix.matrixId;
      if (!next.evidenceMatrices.includes(event.payload.matrix.matrixId)) next.evidenceMatrices.push(event.payload.matrix.matrixId);
      next.evidenceMatrixSummaries[event.payload.matrix.matrixId] = {
        candidateCommit: event.payload.matrix.candidateCommit,
        outcome: event.payload.matrix.outcome,
        ...(event.payload.matrix.validationRecipeDigest !== undefined ? { validationRecipeDigest: event.payload.matrix.validationRecipeDigest } : {})
      };
      break;
    }
    case "artifact.adopted": {
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot record execution artifacts while ${next.lifecycle}.`);
      const artifact = event.payload.artifact;
      if (next.adoptedArtifacts[artifact.artifactId] !== undefined) throw new Error(`Artifact ${artifact.artifactId} already exists.`);
      next.adoptedArtifacts[artifact.artifactId] = structuredClone(artifact);
      const attempt = next.attempts[artifact.producerAttemptId];
      if (attempt !== undefined) attempt.status = "adopted";
      break;
    }
    case "integration.started":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot integrate while ${next.lifecycle}.`);
      if (next.attempts[event.payload.attemptId] !== undefined) throw new Error(`Attempt ${event.payload.attemptId} already exists.`);
      next.attempts[event.payload.attemptId] = { attemptId: event.payload.attemptId, nodeId: event.payload.nodeId, inputFingerprint: event.payload.inputFingerprint, ...(event.payload.retryOfAttemptId !== undefined ? { retryOfAttemptId: event.payload.retryOfAttemptId } : {}), kind: "integration", status: "running", repairPasses: 0 };
      next.integrations[event.payload.nodeId] = { attemptId: event.payload.attemptId, nodeId: event.payload.nodeId, requiredArtifactIds: [...event.payload.requiredArtifactIds], status: "running", repairPasses: 0 };
      break;
    case "integration.repair_attempted": {
      const integration = requireIntegration(next, event.payload.attemptId, event.payload.nodeId);
      integration.repairPasses = Math.max(integration.repairPasses, event.payload.pass);
      break;
    }
    case "integration.completed": {
      const integration = requireIntegration(next, event.payload.attemptId, event.payload.nodeId);
      integration.status = "completed";
      if (event.payload.manifestId !== undefined) integration.manifestId = event.payload.manifestId;
      integration.candidateCommit = event.payload.candidateCommit;
      integration.evidenceMatrixId = event.payload.matrix.matrixId;
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      attempt.status = "validated";
      attempt.candidateCommit = event.payload.candidateCommit;
      next.nodeEvidenceMatrixIds[event.payload.nodeId] = event.payload.matrix.matrixId;
      if (!next.evidenceMatrices.includes(event.payload.matrix.matrixId)) next.evidenceMatrices.push(event.payload.matrix.matrixId);
      next.evidenceMatrixSummaries[event.payload.matrix.matrixId] = {
        candidateCommit: event.payload.matrix.candidateCommit,
        outcome: event.payload.matrix.outcome,
        ...(event.payload.matrix.validationRecipeDigest !== undefined ? { validationRecipeDigest: event.payload.matrix.validationRecipeDigest } : {})
      };
      break;
    }
    case "integration.failed": {
      const integration = requireIntegration(next, event.payload.attemptId, event.payload.nodeId);
      integration.status = event.payload.decisionRequired ? "decision_required" : "failed";
      if (event.payload.manifestId !== undefined) integration.manifestId = event.payload.manifestId;
      if (event.payload.candidateCommit !== undefined) {
        integration.candidateCommit = event.payload.candidateCommit;
        const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
        attempt.candidateCommit = event.payload.candidateCommit;
      }
      if (event.payload.matrix !== undefined) {
        integration.evidenceMatrixId = event.payload.matrix.matrixId;
        next.nodeEvidenceMatrixIds[event.payload.nodeId] = event.payload.matrix.matrixId;
        if (!next.evidenceMatrices.includes(event.payload.matrix.matrixId)) next.evidenceMatrices.push(event.payload.matrix.matrixId);
        next.evidenceMatrixSummaries[event.payload.matrix.matrixId] = {
          candidateCommit: event.payload.matrix.candidateCommit,
          outcome: event.payload.matrix.outcome,
          ...(event.payload.matrix.validationRecipeDigest !== undefined ? { validationRecipeDigest: event.payload.matrix.validationRecipeDigest } : {})
        };
      }
      integration.failureReason = event.payload.reason;
      const attempt = requireAttempt(next, event.payload.attemptId, event.payload.nodeId);
      attempt.status = "failed";
      attempt.failureReason = event.payload.reason;
      break;
    }
    case "failure.classified":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot classify execution failure while ${next.lifecycle}.`);
      next.recoveryHistory.push({ eventId: event.eventId, ...(event.payload.attemptId !== undefined ? { attemptId: event.payload.attemptId } : {}), nodeId: event.payload.nodeId, kind: "failure", failureClass: event.payload.failureClass });
      break;
    case "graph.amendment.proposed":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot propose an amendment while ${next.lifecycle}.`);
      next.recoveryHistory.push({ eventId: event.eventId, kind: "amendment" });
      break;
    case "evidence.matrix_recorded":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot record validation evidence while ${next.lifecycle}.`);
      if (next.evidenceMatrices.includes(event.payload.matrix.matrixId)) throw new Error(`Evidence matrix ${event.payload.matrix.matrixId} already exists.`);
      next.evidenceMatrices.push(event.payload.matrix.matrixId);
      next.evidenceMatrixSummaries[event.payload.matrix.matrixId] = {
        candidateCommit: event.payload.matrix.candidateCommit,
        outcome: event.payload.matrix.outcome,
        ...(event.payload.matrix.validationRecipeDigest !== undefined ? { validationRecipeDigest: event.payload.matrix.validationRecipeDigest } : {})
      };
      break;
    case "graph.revision.proposed":
      if (next.lifecycle !== "planning" && next.lifecycle !== "needs_approval" && next.lifecycle !== "running") throw new Error(`Cannot propose a graph while ${next.lifecycle}.`);
      next.graphId = event.payload.graphId;
      next.graphRevision = event.payload.revision;
      transition(next, "needs_approval");
      break;
    case "graph.revision.approved":
      if (next.graphId !== event.payload.graphId || next.graphRevision !== event.payload.revision) throw new Error(`Cannot approve graph ${event.payload.graphId} revision ${event.payload.revision}; current graph is ${next.graphId ?? "none"} revision ${next.graphRevision ?? "none"}.`);
      next.approvedGraphRevision = event.payload.revision;
      transition(next, "running");
      break;
    case "decision.raised":
      if (next.decisions[event.payload.decision.id] !== undefined) throw new Error(`Decision ${event.payload.decision.id} already exists.`);
      next.decisions[event.payload.decision.id] = DecisionSchema.parse({ ...event.payload.decision, status: "pending" });
      // A decision blocks the nodes it names, not the run: independent work keeps
      // moving while an operator answers. Only `readiness.observed` parks the run,
      // and only when nothing is ready and a decision is pending.
      break;
    case "decision.resolved": {
      const decision = next.decisions[event.payload.decisionId];
      if (decision === undefined || decision.status !== "pending") throw new Error(`Decision ${event.payload.decisionId} is not pending.`);
      if (event.payload.optionId !== undefined && !decision.options.some((option) => option.id === event.payload.optionId)) throw new Error(`Decision ${decision.id} has no option ${event.payload.optionId}.`);
      decision.status = "resolved";
      decision.resolution = {
        ...(event.payload.optionId !== undefined ? { optionId: event.payload.optionId } : {}),
        ...(event.payload.answer !== undefined ? { answer: event.payload.answer } : {})
      };
      next.readiness.pendingDecisionIds = next.readiness.pendingDecisionIds
        .filter((decisionId) => decisionId !== decision.id);
      if (event.payload.optionId === "stop") {
        next.stoppedNodeIds = [...new Set([...(next.stoppedNodeIds ?? []), ...decision.affectedNodeIds])].sort();
      }
      break;
    }
    case "decision.expired": {
      const decision = next.decisions[event.payload.decisionId];
      if (decision === undefined) throw new Error(`Decision ${event.payload.decisionId} does not exist.`);
      if (decision.status !== "pending") throw new Error(`Decision ${event.payload.decisionId} is not pending.`);
      decision.status = "expired";
      break;
    }
    case "readiness.observed": {
      for (const decisionId of event.payload.pendingDecisionIds) {
        if (next.decisions[decisionId]?.status !== "pending") throw new Error(`Readiness references non-pending decision ${decisionId}.`);
      }
      next.readiness = {
        readyNodeIds: [...new Set(event.payload.readyNodeIds)].sort(),
        pendingDecisionIds: [...new Set(event.payload.pendingDecisionIds)].sort(),
        ...(event.payload.explanations !== undefined ? { explanations: structuredClone(event.payload.explanations) } : {}),
        ...(event.payload.effectiveConfig !== undefined ? { effectiveConfig: structuredClone(event.payload.effectiveConfig) } : {}),
        ...(event.payload.schedulerState !== undefined ? { schedulerState: structuredClone(event.payload.schedulerState) } : {}),
        ...(event.payload.budgetAvailable !== undefined ? { budgetAvailable: event.payload.budgetAvailable } : {}),
        ...(event.payload.conflictEvidence !== undefined ? { conflictEvidence: structuredClone(event.payload.conflictEvidence) } : {}),
        ...(event.payload.evaluatedAt !== undefined ? { evaluatedAt: event.payload.evaluatedAt } : {})
      };
      if (next.lifecycle === "running" || next.lifecycle === "waiting_for_input") {
        transition(next, next.readiness.readyNodeIds.length === 0 && next.readiness.pendingDecisionIds.length > 0 ? "waiting_for_input" : "running");
      }
      break;
    }
    case "wave.selected": {
      if (next.lifecycle !== "running") throw new Error(`Cannot select a wave while ${next.lifecycle}.`);
      if (event.payload.nodeIds.length > event.payload.maxParallel) throw new Error(`Wave ${event.payload.waveId} exceeds maxParallel.`);
      if (event.payload.nodeIds.some((nodeId) => !next.readiness.readyNodeIds.includes(nodeId))) throw new Error(`Wave ${event.payload.waveId} contains a node not present in observed readiness.`);
      if (next.selectedWaves.some((wave) => wave.waveId === event.payload.waveId)) throw new Error(`Wave ${event.payload.waveId} already exists.`);
      const selectedWave = {
        waveId: event.payload.waveId,
        nodeIds: [...event.payload.nodeIds],
        maxParallel: event.payload.maxParallel,
        ...(event.payload.blocked !== undefined ? { blocked: structuredClone(event.payload.blocked) } : {}),
        ...(event.payload.effectiveConfig !== undefined ? { effectiveConfig: structuredClone(event.payload.effectiveConfig) } : {}),
        ...(event.payload.conflictEvidence !== undefined ? { conflictEvidence: structuredClone(event.payload.conflictEvidence) } : {}),
        ...(event.payload.evaluatedAt !== undefined ? { evaluatedAt: event.payload.evaluatedAt } : {})
      };
      next.selectedWaves.push(selectedWave);
      break;
    }
    case "run.pause_requested":
      if (next.lifecycle !== "running" && next.lifecycle !== "waiting_for_input") throw new Error(`Cannot pause while ${next.lifecycle}.`);
      next.lifecycleBeforePause = next.lifecycle;
      transition(next, "paused");
      break;
    case "run.resume_requested":
      if (next.lifecycle !== "paused") throw new Error(`Cannot resume while ${next.lifecycle}.`);
      transition(next, next.readiness.readyNodeIds.length === 0 && next.readiness.pendingDecisionIds.length > 0 ? "waiting_for_input" : "running");
      delete next.lifecycleBeforePause;
      break;
    case "run.restart_requested":
      if (next.lifecycle !== "interrupted") throw new Error(`Cannot restart while ${next.lifecycle}.`);
      next.outcomes.execution = "pending";
      delete next.failureReason;
      transition(next, "running");
      break;
    case "operation.cancel_requested":
      transition(next, "cancelling");
      break;
    case "operation.interrupted":
      next.outcomes.execution = "interrupted";
      transition(next, "interrupted");
      break;
    case "final_candidate.verified":
      if (!event.payload.executionSucceeded) throw new Error("A final candidate cannot be verified before execution succeeds.");
      if (!event.payload.evidenceEligible) throw new Error("A final candidate requires eligible evidence.");
      if (next.evidenceMatrixSummaries[event.payload.evidenceMatrixId]?.outcome !== "verified"
        || next.evidenceMatrixSummaries[event.payload.evidenceMatrixId]?.candidateCommit !== event.payload.commit) {
        throw new Error("A final candidate requires a verified evidence matrix for the exact candidate commit.");
      }
      if (event.payload.finalManifest !== undefined) {
        const matrix = next.evidenceMatrixSummaries[event.payload.evidenceMatrixId];
        if (event.payload.finalManifest.commitSha !== event.payload.commit
          || event.payload.finalManifest.evidenceMatrixId !== event.payload.evidenceMatrixId
          || event.payload.finalManifest.deliveryTarget !== event.payload.targetBranch
          || event.payload.finalManifest.graphRevision !== next.graphRevision
          || matrix?.validationRecipeDigest !== event.payload.finalManifest.validationRecipeDigest) {
          throw new Error("The final artifact manifest does not match the approved graph, evidence, candidate, or delivery target.");
        }
      }
      if (Object.values(next.decisions).some((decision) => decision.status === "pending")) throw new Error("A final candidate cannot become ready with pending decisions.");
      next.finalCandidate = { manifestId: event.payload.manifestId, commit: event.payload.commit, evidenceMatrixId: event.payload.evidenceMatrixId, sourceTargetFingerprint: event.payload.sourceTargetFingerprint, targetBranch: event.payload.targetBranch, targetHead: event.payload.targetHead, evidenceEligible: true, ...(event.payload.finalManifest !== undefined ? { finalManifest: event.payload.finalManifest } : {}) };
      next.outcomes = { execution: "succeeded", artifact: "verified", delivery: "ready" };
      transition(next, "result_ready");
      break;
    case "delivery.started":
      if (next.finalCandidate?.manifestId !== event.payload.approval.manifestId || next.finalCandidate.commit !== event.payload.approval.finalSha) throw new Error(`Delivery manifest ${event.payload.approval.manifestId} is not the verified final candidate.`);
      if (next.finalCandidate.sourceTargetFingerprint !== event.payload.approval.targetFingerprint || next.finalCandidate.targetBranch !== event.payload.approval.targetBranch || next.finalCandidate.targetHead !== event.payload.approval.targetHead) throw new Error("Delivery approval does not match the candidate target snapshot.");
      next.deliveryApproval = event.payload.approval;
      delete next.failureReason;
      transition(next, "delivering");
      break;
    case "delivery.published":
      if (!event.payload.receipt.confirmed) throw new Error("Delivery receipt must be confirmed before completed.");
      if (next.finalCandidate?.evidenceEligible !== true || next.finalCandidate.manifestId !== event.payload.receipt.manifestId) throw new Error("Delivery receipt does not match an evidence-eligible final candidate.");
      if (event.payload.receipt.disposition !== undefined && event.payload.receipt.disposition !== "delivered") throw new Error("Delivery receipt must have delivered disposition before completed.");
      if (event.payload.receipt.finalSha !== undefined && event.payload.receipt.finalSha !== next.deliveryApproval?.finalSha) throw new Error("Delivery receipt final SHA does not match the approved candidate.");
      if (event.payload.receipt.targetBranch !== undefined && event.payload.receipt.targetBranch !== next.deliveryApproval?.targetBranch) throw new Error("Delivery receipt target branch does not match the approval.");
      if (event.payload.receipt.targetHeadBefore !== undefined && event.payload.receipt.targetHeadBefore !== next.deliveryApproval?.targetHead) throw new Error("Delivery receipt target head does not match the approval.");
      next.deliveryReceipt = event.payload.receipt;
      next.outcomes.delivery = "published";
      delete next.failureReason;
      transition(next, "completed");
      break;
    case "delivery.failed":
      if (next.deliveryApproval?.manifestId !== event.payload.manifestId) throw new Error(`Delivery failure does not match the active approval for ${event.payload.manifestId}.`);
      next.outcomes.delivery = "failed";
      next.failureReason = event.payload.reason;
      transition(next, "result_ready");
      break;
    case "run.failed":
      if (event.payload.area === "execution") next.outcomes.execution = "failed";
      if (event.payload.area === "artifact") next.outcomes.artifact = "failed";
      if (event.payload.area === "delivery") next.outcomes.delivery = "failed";
      next.failureReason = event.payload.reason;
      transition(next, "failed");
      break;
  }
  next.sequence = event.sequence;
  next.appliedEventIds.push(event.eventId);
  return next;
}

function assertEffectIntentPending(state: RunProjection, effectId: string): EffectIntent {
  const intent = state.effectIntents[effectId];
  if (intent === undefined) throw new Error(`Terminal effect ${effectId} has no requested intent.`);
  if (state.effectTerminals[effectId] !== undefined) throw new Error(`Effect ${effectId} is already terminal.`);
  return intent;
}

function assertEffectReceiptLink(
  state: RunProjection,
  effectId: string,
  receiptId: string
): PhysicalEffectReceipt {
  const receipt = state.physicalEffectReceipts[receiptId];
  if (receipt === undefined) {
    throw new Error(`Terminal effect ${effectId} references missing physical receipt ${receiptId}.`);
  }
  if (receipt.effectId !== effectId) {
    throw new Error(`Physical receipt ${receiptId} belongs to effect ${receipt.effectId}, not ${effectId}.`);
  }
  return receipt;
}

function assertEffectTerminalLink(
  state: RunProjection,
  effectId: string,
  receiptId: string
): PhysicalEffectReceipt {
  assertEffectIntentPending(state, effectId);
  return assertEffectReceiptLink(state, effectId, receiptId);
}

function requireAttempt(state: RunProjection, attemptId: string, nodeId: string): AttemptProjection {
  const attempt = state.attempts[attemptId];
  if (attempt === undefined || attempt.nodeId !== nodeId) throw new Error(`Attempt ${attemptId} does not belong to node ${nodeId}.`);
  return attempt;
}

function requireIntegration(state: RunProjection, attemptId: string, nodeId: string): IntegrationProjection {
  const integration = state.integrations[nodeId];
  if (integration === undefined || integration.attemptId !== attemptId) throw new Error(`Integration attempt ${attemptId} does not belong to node ${nodeId}.`);
  return integration;
}

function transition(state: RunProjection, target: RunLifecycle): void {
  assertLifecycleTransition(state.lifecycle, target);
  state.lifecycle = target;
}
