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
