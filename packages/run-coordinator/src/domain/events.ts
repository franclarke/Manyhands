import { EffectIntentSchema, PhysicalEffectReceiptSchema } from "@manyhands/contracts";
import { EntityIdSchema, FinalArtifactManifestSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { CommandReceiptSchema } from "../command-envelope.js";
import { DecisionInputSchema, DecisionResolutionShape, requireDecisionResolution } from "./decisions.js";
import { DeliveryApprovalSchema, DeliveryReceiptSchema } from "./outcomes.js";
import { AdoptedArtifactSchema } from "./artifacts.js";
import { FailureClassSchema, FailureObservationSchema } from "./failures.js";
import { EvidenceMatrixRecordSchema } from "./evidence.js";

/**
 * What one attempt cost. Optional on the event: a provider that reports nothing
 * must still produce a valid journal instead of a fabricated zero, so an absent
 * record stays distinguishable from a measured zero. `source` is required
 * whenever a record exists -- a provider-reported figure and a registry
 * estimate must never be summed as if they were the same measurement.
 */
export const AttemptUsageSchema = z.object({
  tokensIn: z.number().int().nonnegative().optional(),
  tokensTotal: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  source: z.enum(["reported", "estimated", "unavailable"])
}).strict();

export type AttemptUsage = z.infer<typeof AttemptUsageSchema>;

export const PlanningCandidateDiagnosticSchema = z.object({
  code: NonEmptyStringSchema,
  message: NonEmptyStringSchema,
  refs: z.array(NonEmptyStringSchema)
}).strict();

export type PlanningCandidateDiagnostic = z.infer<typeof PlanningCandidateDiagnosticSchema>;

export const PlanningCandidateEvaluationSchema = z.object({
  candidateId: EntityIdSchema,
  candidateHash: NonEmptyStringSchema,
  candidate: z.record(z.unknown()),
  valid: z.boolean(),
  score: z.number().finite().optional(),
  gates: z.array(z.object({
    gate: NonEmptyStringSchema,
    passed: z.boolean(),
    diagnosticCodes: z.array(NonEmptyStringSchema)
  }).strict()).default([]),
  diagnostics: z.array(PlanningCandidateDiagnosticSchema)
}).strict();

export type PlanningCandidateEvaluation = z.infer<typeof PlanningCandidateEvaluationSchema>;

const PlanningCandidateSelectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("selected"),
    candidateId: EntityIdSchema,
    score: z.number().finite(),
    rejectedCandidateIds: z.array(EntityIdSchema),
    tieBreak: z.object({
      kind: z.literal("candidate_id"),
      applied: z.boolean(),
      contenders: z.array(EntityIdSchema)
    }).strict().optional()
  }).strict(),
  z.object({
    kind: z.literal("replan_required"),
    reason: NonEmptyStringSchema,
    rejectedCandidateIds: z.array(EntityIdSchema),
    diagnostics: z.array(PlanningCandidateDiagnosticSchema)
  }).strict()
]);

export type PlanningCandidateSelection = z.infer<typeof PlanningCandidateSelectionSchema>;

const SchedulerReasonSchema = z.object({ code: NonEmptyStringSchema }).passthrough();
const SchedulerExplanationSchema = z.object({
  nodeId: EntityIdSchema,
  ready: z.boolean(),
  reasons: z.array(SchedulerReasonSchema),
  deferred: z.boolean().optional()
}).strict();
export type SchedulerExplanationEvent = z.infer<typeof SchedulerExplanationSchema>;
const SchedulerConfigSchema = z.object({
  maxParallel: z.number().int().positive().optional(),
  maxTokensTotal: z.number().int().positive().optional(),
  maxCostUsd: z.number().nonnegative().optional()
}).passthrough();
export type SchedulerConfigEvent = z.infer<typeof SchedulerConfigSchema>;
const SchedulerStateSchema = z.object({
  materializableNodeIds: z.array(EntityIdSchema),
  activeResourceNodeIds: z.array(EntityIdSchema),
  openCircuitBreakerNodeIds: z.array(EntityIdSchema),
  availableExecutorNodeIds: z.array(EntityIdSchema),
  stoppedNodeIds: z.array(EntityIdSchema),
  budgetAvailable: z.boolean()
}).strict();
export type SchedulerStateEvent = z.infer<typeof SchedulerStateSchema>;
const ConflictEvidenceSchema = z.object({
  id: EntityIdSchema,
  leftNodeId: EntityIdSchema,
  rightNodeId: EntityIdSchema,
  reason: NonEmptyStringSchema,
  risk: z.string().min(1),
  mode: z.string().min(1).optional(),
  resourceId: NonEmptyStringSchema.optional()
}).passthrough();
export type ConflictEvidenceEvent = z.infer<typeof ConflictEvidenceSchema>;

const BaseEventShape = {
  eventId: EntityIdSchema,
  runId: EntityIdSchema,
  sequence: z.number().int().positive(),
  occurredAt: IsoTimestampSchema
};

function event<T extends string, S extends z.ZodTypeAny>(type: T, payload: S) {
  return z.object({ ...BaseEventShape, type: z.literal(type), payload }).strict();
}

export const RunEventSchema = z.discriminatedUnion("type", [
  event("run.created", z.object({ goal: NonEmptyStringSchema }).strict()),
  event("command.accepted", z.object({ receipt: CommandReceiptSchema }).strict()),
  event("effect.requested", z.object({ intent: EffectIntentSchema }).strict()),
  event("effect.observed", z.object({ receipt: PhysicalEffectReceiptSchema }).strict()),
  event("legacy.run_imported", z.object({
    sourceHash: NonEmptyStringSchema,
    importerVersion: z.literal(1),
    approvedBy: NonEmptyStringSchema,
    sourceStatus: NonEmptyStringSchema,
    disposition: z.literal("requires_revalidation"),
    warnings: z.array(NonEmptyStringSchema)
  }).strict()),
  event("repository.inspected", z.object({ snapshotId: NonEmptyStringSchema, disposition: z.enum(["complete", "partial", "unavailable"]), snapshot: z.record(z.unknown()) }).strict()),
  event("planning.attempt_started", z.object({ attempt: z.number().int().positive() }).strict()),
  event("planning.node_discovered", z.object({
    attempt: z.number().int().positive(),
    node: z.object({
      nodeId: EntityIdSchema,
      parentNodeId: EntityIdSchema.nullable(),
      key: EntityIdSchema,
      parentKey: EntityIdSchema.nullable(),
      kind: z.enum(["composite", "leaf"]),
      title: NonEmptyStringSchema,
      objective: NonEmptyStringSchema,
      siblingIndex: z.number().int().nonnegative(),
      siblingCount: z.number().int().positive()
    }).strict()
  }).strict()),
  event("planning.attempt_failed", z.object({ attempt: z.number().int().positive(), reason: NonEmptyStringSchema }).strict()),
  /**
   * A unit the planner could not cut. Recorded in place so one failure does not
   * discard the units that already resolved above and beside it, and so the
   * exact property that blocked it survives in the journal.
   */
  event("planning.unit_unresolved", z.object({
    nodeId: EntityIdSchema,
    key: EntityIdSchema,
    parentKey: EntityIdSchema.nullable(),
    depth: z.number().int().nonnegative(),
    diagnostics: z.array(NonEmptyStringSchema).min(1)
  }).strict()),
  event("planning.granularity_strategy_selected", z.object({
    policyVersion: NonEmptyStringSchema,
    condition: z.enum(["A", "C"]),
    candidateTreeHash: NonEmptyStringSchema,
    candidateTree: z.object({
      root: z.unknown(),
      candidateArtifacts: z.array(z.unknown()),
      candidateSeams: z.array(z.unknown())
    }).strict().optional(),
    candidateSourceHash: NonEmptyStringSchema.optional(),
    config: z.object({
      maxLeafContextTokens: z.number().int().positive(),
      maxLeafScopePaths: z.number().int().positive(),
      maxLeafPlannedPaths: z.number().int().positive()
    }).strict(),
    assessments: z.array(z.object({
      unitKey: EntityIdSchema,
      nodeId: EntityIdSchema,
      selected: z.enum(["leaf", "split", "semantic_replan"]),
      leafFeasible: z.boolean(),
      splitViable: z.boolean(),
      /** Which of the three reasons carried the decision. */
      reasons: z.object({
        doesNotFit: z.boolean(),
        runsInParallel: z.boolean(),
        verifiableApart: z.boolean()
      }).strict(),
      evidenceRefs: z.array(NonEmptyStringSchema),
      rationale: NonEmptyStringSchema
    }).strict()).min(1),
    metrics: z.object({
      maxGraphDepth: z.number().int().nonnegative(),
      totalLeafCount: z.number().int().positive(),
      averageBranchingFactor: z.number().nonnegative()
    }).strict()
  }).strict()),
  event("planning.envelope_created", z.object({
    schemaVersion: z.literal(1),
    policyVersion: NonEmptyStringSchema,
    repositorySnapshotId: NonEmptyStringSchema,
    goalDigest: NonEmptyStringSchema,
    candidateBudget: z.object({
      minimum: z.number().int().positive(),
      maximum: z.number().int().positive().max(8)
    }).strict(),
    executionBudget: z.object({
      maxLeafContextTokens: z.number().int().positive(),
      maxLeafScopePaths: z.number().int().positive(),
      maxParallelism: z.number().int().positive()
    }).strict(),
    requirements: z.object({
      requireExplicitAcceptanceOwnership: z.literal(true),
      requireCompleteSeamSpecifications: z.literal(true),
      requireObservableLeafValidation: z.literal(true)
    }).strict()
  }).strict().superRefine((envelope, context) => {
    if (envelope.candidateBudget.minimum > envelope.candidateBudget.maximum) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "candidateBudget.minimum must not exceed candidateBudget.maximum" });
    }
  })),
  event("planning.candidates_evaluated", z.object({
    schemaVersion: z.literal(1),
    envelope: z.record(z.unknown()),
    policy: z.object({
      version: NonEmptyStringSchema,
      condition: z.enum(["A", "B", "C"]),
      scoreBasis: NonEmptyStringSchema
    }).strict().optional(),
    candidates: z.array(PlanningCandidateEvaluationSchema).min(1),
    selection: PlanningCandidateSelectionSchema
  }).strict()),
  event("planning.completed", z.object({ breakdownId: EntityIdSchema, breakdown: z.record(z.unknown()) }).strict()),
  event("graph.compiled", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive(), graph: z.record(z.unknown()), contracts: z.array(z.record(z.unknown())), review: z.record(z.unknown()), trace: z.record(z.unknown()) }).strict()),
  event("planning.critic_recorded", z.object({ critic: NonEmptyStringSchema, findings: z.array(z.record(z.unknown())) }).strict()),
  event("planning.failed", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("attempt.started", z.object({
    attemptId: EntityIdSchema,
    nodeId: EntityIdSchema,
    inputFingerprint: NonEmptyStringSchema,
    retryOfAttemptId: EntityIdSchema.optional(),
    executorProfile: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict()
  }).strict()),
  event("attempt.candidate_created", z.object({
    attemptId: EntityIdSchema,
    nodeId: EntityIdSchema,
    candidateCommit: NonEmptyStringSchema,
    outputDigest: NonEmptyStringSchema,
    changedFiles: z.array(NonEmptyStringSchema),
    usage: AttemptUsageSchema.optional()
  }).strict()),
  event("attempt.repair_attempted", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, pass: z.number().int().positive(), evidenceRefs: z.array(NonEmptyStringSchema) }).strict()),
  event("attempt.failed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, reason: NonEmptyStringSchema, usage: AttemptUsageSchema.optional() }).strict()),
  event("attempt.discarded", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, reason: NonEmptyStringSchema }).strict()),
  event("attempt.stale", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, attemptedFingerprint: NonEmptyStringSchema, currentFingerprint: NonEmptyStringSchema, reason: NonEmptyStringSchema }).strict()),
  event("failure.classified", z.object({ attemptId: EntityIdSchema.optional(), nodeId: EntityIdSchema, failureClass: FailureClassSchema, observation: FailureObservationSchema, allowedActions: z.array(NonEmptyStringSchema), automaticRetryBudget: z.number().int().nonnegative(), discardCandidate: z.boolean() }).strict()),
  event("graph.amendment.proposed", z.object({ proposalId: EntityIdSchema, graphId: EntityIdSchema, sourceRevision: z.number().int().positive(), kind: z.enum(["artifact_requirement", "graph_revision"]), rationale: NonEmptyStringSchema, evidenceRefs: z.array(NonEmptyStringSchema).min(1), operations: z.array(z.record(z.unknown())).min(1) }).strict()),
  event("evidence.matrix_recorded", z.object({ matrix: EvidenceMatrixRecordSchema }).strict()),
  event("validation.started", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, validationContract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(), candidateCommit: NonEmptyStringSchema }).strict()),
  event("validation.evidence_recorded", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, evidenceId: EntityIdSchema, obligationId: EntityIdSchema, kind: NonEmptyStringSchema, passed: z.boolean() }).strict()),
  event("validation.completed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, matrix: EvidenceMatrixRecordSchema }).strict()),
  event("artifact.adopted", z.object({ artifact: AdoptedArtifactSchema }).strict()),
  event("integration.started", z.object({
    attemptId: EntityIdSchema,
    nodeId: EntityIdSchema,
    inputFingerprint: NonEmptyStringSchema,
    retryOfAttemptId: EntityIdSchema.optional(),
    executorProfile: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
    requiredArtifactIds: z.array(EntityIdSchema).min(1)
  }).strict()),
  event("integration.repair_attempted", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, pass: z.number().int().positive(), evidenceRefs: z.array(NonEmptyStringSchema) }).strict()),
  event("integration.completed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, manifestId: EntityIdSchema, candidateCommit: NonEmptyStringSchema, matrix: EvidenceMatrixRecordSchema }).strict()),
  event("integration.failed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, manifestId: EntityIdSchema.optional(), candidateCommit: NonEmptyStringSchema.optional(), matrix: EvidenceMatrixRecordSchema.optional(), reason: NonEmptyStringSchema, decisionRequired: z.boolean() }).strict()),
  event("graph.revision.proposed", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive() }).strict()),
  event("graph.revision.approved", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive() }).strict()),
  event("decision.raised", z.object({ decision: DecisionInputSchema }).strict()),
  event("decision.resolved", z.object({ decisionId: EntityIdSchema, ...DecisionResolutionShape }).strict().superRefine(requireDecisionResolution)),
  event("decision.expired", z.object({ decisionId: EntityIdSchema, supersededByRevision: z.number().int().positive(), reason: NonEmptyStringSchema }).strict()),
  event("readiness.observed", z.object({
    readyNodeIds: z.array(EntityIdSchema),
    pendingDecisionIds: z.array(EntityIdSchema),
    explanations: z.array(SchedulerExplanationSchema).optional(),
    effectiveConfig: SchedulerConfigSchema.optional(),
    schedulerState: SchedulerStateSchema.optional(),
    budgetAvailable: z.boolean().optional(),
    conflictEvidence: z.array(ConflictEvidenceSchema).optional(),
    evaluatedAt: IsoTimestampSchema.optional()
  }).strict()),
  event("wave.selected", z.object({
    waveId: EntityIdSchema,
    nodeIds: z.array(EntityIdSchema).min(1),
    maxParallel: z.number().int().positive(),
    blocked: z.array(SchedulerExplanationSchema).optional(),
    effectiveConfig: SchedulerConfigSchema.optional(),
    conflictEvidence: z.array(ConflictEvidenceSchema).optional(),
    evaluatedAt: IsoTimestampSchema.optional()
  }).strict()),
  event("run.pause_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("run.resume_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("run.restart_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("operation.cancel_requested", z.object({ invalidationReceiptId: EntityIdSchema, reason: NonEmptyStringSchema }).strict()),
  event("operation.interrupted", z.object({ processReceiptId: EntityIdSchema, allDead: z.literal(true) }).strict()),
  event("final_candidate.verified", z.object({
    manifestId: EntityIdSchema,
    commit: NonEmptyStringSchema,
    evidenceMatrixId: EntityIdSchema,
    evidenceEligible: z.boolean(),
    executionSucceeded: z.boolean(),
    sourceTargetFingerprint: NonEmptyStringSchema,
    targetBranch: NonEmptyStringSchema,
    targetHead: NonEmptyStringSchema,
    finalManifest: FinalArtifactManifestSchema.optional()
  }).strict()),
  event("delivery.started", z.object({ approval: DeliveryApprovalSchema }).strict()),
  event("delivery.published", z.object({ receipt: DeliveryReceiptSchema }).strict()),
  event("delivery.failed", z.object({ manifestId: EntityIdSchema, reason: NonEmptyStringSchema, retryable: z.boolean() }).strict()),
  event("run.failed", z.object({ reason: NonEmptyStringSchema, area: z.enum(["execution", "artifact", "delivery", "domain"]) }).strict())
]);

export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent["type"];
export type RunEventDraft = RunEvent extends infer E
  ? E extends RunEvent
    ? Pick<E, "type" | "payload">
    : never
  : never;
export type RunEventInput = RunEvent extends infer E
  ? E extends RunEvent
    ? Omit<E, "runId" | "sequence">
    : never
  : never;
