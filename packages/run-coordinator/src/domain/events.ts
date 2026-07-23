import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { DecisionInputSchema, DecisionResolutionShape, requireDecisionResolution } from "./decisions.js";
import { DeliveryApprovalSchema, DeliveryReceiptSchema } from "./outcomes.js";
import { AdoptedArtifactSchema } from "./artifacts.js";
import { FailureClassSchema, FailureObservationSchema } from "./failures.js";
import { EvidenceMatrixRecordSchema } from "./evidence.js";

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
  event("planning.granularity_assessed", z.object({
    formulaVersion: NonEmptyStringSchema,
    weights: z.object({
      scopeRadius: z.number().nonnegative(),
      interfaceImpact: z.number().nonnegative(),
      validationSurface: z.number().nonnegative(),
      contextTokenMass: z.number().nonnegative()
    }).strict(),
    leafThreshold: z.number().positive(),
    assessments: z.array(z.object({
      unitKey: EntityIdSchema,
      nodeId: EntityIdSchema,
      dimensions: z.object({
        scopeRadius: z.number().min(0).max(10),
        interfaceImpact: z.number().min(0).max(10),
        validationSurface: z.number().min(0).max(10),
        contextTokenMass: z.number().min(0).max(10)
      }).strict(),
      signalSource: z.enum(["llm", "clamped", "derived"]),
      complexityScore: z.number().nonnegative(),
      decision: z.enum(["leaf", "composite"]),
      recommendedBranchingFactor: z.number().int().min(2).max(5).optional(),
      rationale: NonEmptyStringSchema
    }).strict()).min(1),
    criticDecisions: z.array(z.object({
      kind: z.enum(["coalesced", "resplit_required"]),
      unitIds: z.array(EntityIdSchema).min(1),
      rationale: NonEmptyStringSchema
    }).strict()),
    metrics: z.object({
      maxGraphDepth: z.number().int().nonnegative(),
      totalLeafCount: z.number().int().positive(),
      averageBranchingFactor: z.number().nonnegative(),
      coalescedUnitsCount: z.number().int().nonnegative()
    }).strict()
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
    changedFiles: z.array(NonEmptyStringSchema)
  }).strict()),
  event("attempt.repair_attempted", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, pass: z.number().int().positive(), evidenceRefs: z.array(NonEmptyStringSchema) }).strict()),
  event("attempt.failed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, reason: NonEmptyStringSchema }).strict()),
  event("attempt.discarded", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, reason: NonEmptyStringSchema }).strict()),
  event("attempt.stale", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, attemptedFingerprint: NonEmptyStringSchema, currentFingerprint: NonEmptyStringSchema, reason: NonEmptyStringSchema }).strict()),
  event("failure.classified", z.object({ nodeId: EntityIdSchema, failureClass: FailureClassSchema, observation: FailureObservationSchema, allowedActions: z.array(NonEmptyStringSchema), automaticRetryBudget: z.number().int().nonnegative(), discardCandidate: z.boolean() }).strict()),
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
    executorProfile: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
    requiredArtifactIds: z.array(EntityIdSchema).min(1)
  }).strict()),
  event("integration.repair_attempted", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, pass: z.number().int().positive(), evidenceRefs: z.array(NonEmptyStringSchema) }).strict()),
  event("integration.completed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, manifestId: EntityIdSchema, candidateCommit: NonEmptyStringSchema, matrix: EvidenceMatrixRecordSchema }).strict()),
  event("integration.failed", z.object({ attemptId: EntityIdSchema, nodeId: EntityIdSchema, manifestId: EntityIdSchema.optional(), reason: NonEmptyStringSchema, decisionRequired: z.boolean() }).strict()),
  event("graph.revision.proposed", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive() }).strict()),
  event("graph.revision.approved", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive() }).strict()),
  event("decision.raised", z.object({ decision: DecisionInputSchema }).strict()),
  event("decision.resolved", z.object({ decisionId: EntityIdSchema, ...DecisionResolutionShape }).strict().superRefine(requireDecisionResolution)),
  event("decision.expired", z.object({ decisionId: EntityIdSchema, supersededByRevision: z.number().int().positive(), reason: NonEmptyStringSchema }).strict()),
  event("readiness.observed", z.object({ readyNodeIds: z.array(EntityIdSchema), pendingDecisionIds: z.array(EntityIdSchema) }).strict()),
  event("wave.selected", z.object({
    waveId: EntityIdSchema,
    nodeIds: z.array(EntityIdSchema).min(1),
    maxParallel: z.number().int().positive()
  }).strict()),
  event("run.pause_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("run.resume_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("run.restart_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("operation.cancel_requested", z.object({ invalidationReceiptId: EntityIdSchema, reason: NonEmptyStringSchema }).strict()),
  event("operation.interrupted", z.object({ processReceiptId: EntityIdSchema, allDead: z.literal(true) }).strict()),
  event("final_candidate.verified", z.object({ manifestId: EntityIdSchema, commit: NonEmptyStringSchema, evidenceMatrixId: EntityIdSchema, evidenceEligible: z.boolean(), executionSucceeded: z.boolean(), sourceTargetFingerprint: NonEmptyStringSchema, targetBranch: NonEmptyStringSchema, targetHead: NonEmptyStringSchema }).strict()),
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
