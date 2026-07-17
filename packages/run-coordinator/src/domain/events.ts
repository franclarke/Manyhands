import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { DecisionInputSchema, DecisionResolutionShape, requireDecisionResolution } from "./decisions.js";
import { DeliveryReceiptSchema } from "./outcomes.js";

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
  event("repository.inspected", z.object({ snapshotId: NonEmptyStringSchema, disposition: z.enum(["complete", "partial", "unavailable"]), snapshot: z.record(z.unknown()) }).strict()),
  event("planning.completed", z.object({ breakdownId: EntityIdSchema, breakdown: z.record(z.unknown()) }).strict()),
  event("graph.compiled", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive(), graph: z.record(z.unknown()), contracts: z.array(z.record(z.unknown())), review: z.record(z.unknown()), trace: z.record(z.unknown()) }).strict()),
  event("planning.critic_recorded", z.object({ critic: NonEmptyStringSchema, findings: z.array(z.record(z.unknown())) }).strict()),
  event("planning.failed", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("graph.revision.proposed", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive() }).strict()),
  event("graph.revision.approved", z.object({ graphId: EntityIdSchema, revision: z.number().int().positive() }).strict()),
  event("decision.raised", z.object({ decision: DecisionInputSchema }).strict()),
  event("decision.resolved", z.object({ decisionId: EntityIdSchema, ...DecisionResolutionShape }).strict().superRefine(requireDecisionResolution)),
  event("readiness.observed", z.object({ readyNodeIds: z.array(EntityIdSchema), pendingDecisionIds: z.array(EntityIdSchema) }).strict()),
  event("run.pause_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("run.resume_requested", z.object({ reason: NonEmptyStringSchema }).strict()),
  event("operation.cancel_requested", z.object({ invalidationReceiptId: EntityIdSchema, reason: NonEmptyStringSchema }).strict()),
  event("operation.interrupted", z.object({ processReceiptId: EntityIdSchema, allDead: z.literal(true) }).strict()),
  event("final_candidate.verified", z.object({ manifestId: EntityIdSchema, commit: NonEmptyStringSchema, evidenceEligible: z.boolean(), executionSucceeded: z.boolean() }).strict()),
  event("delivery.started", z.object({ manifestId: EntityIdSchema }).strict()),
  event("delivery.published", z.object({ receipt: DeliveryReceiptSchema }).strict()),
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
