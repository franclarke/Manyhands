import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const DecisionOptionSchema = z.object({
  id: EntityIdSchema,
  label: NonEmptyStringSchema,
  description: NonEmptyStringSchema.optional()
}).strict();

export const DecisionInputSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["clarify_goal", "approve_plan", "approve_amendment", "resolve_conflict", "approve_delivery"]),
  question: NonEmptyStringSchema,
  options: z.array(DecisionOptionSchema).min(2),
  affectedNodeIds: z.array(EntityIdSchema).min(1),
  evidenceRefs: z.array(NonEmptyStringSchema),
  impact: z.enum(["behavior", "architecture", "scope", "risk", "acceptance"]),
  // The graph revision the decision was raised against. When a later revision is
  // approved, a still-pending decision tied to an older revision has a stale
  // premise and is expired rather than silently applied. Optional because
  // pre-graph decisions (e.g. goal clarification) have no revision basis.
  raisedAtGraphRevision: z.number().int().positive().optional()
}).strict();

export type DecisionInput = z.infer<typeof DecisionInputSchema>;

export const DecisionResolutionShape = {
  optionId: EntityIdSchema.optional(),
  answer: NonEmptyStringSchema.optional()
};

export const DecisionResolutionSchema = z.object(DecisionResolutionShape).strict().superRefine((resolution, context) => {
  if (resolution.optionId === undefined && resolution.answer === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "decision resolution requires an option or answer" });
  }
});

export function requireDecisionResolution(
  resolution: { optionId?: string | undefined; answer?: string | undefined },
  context: z.RefinementCtx
): void {
  if (resolution.optionId === undefined && resolution.answer === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "decision resolution requires an option or answer" });
  }
}

export const DecisionSchema = DecisionInputSchema.extend({
  status: z.enum(["pending", "resolved", "expired"]),
  resolution: DecisionResolutionSchema.optional()
}).strict();

export type Decision = z.infer<typeof DecisionSchema>;

export function decisionBlocksNode(decision: Decision, nodeId: string): boolean {
  return decision.status === "pending" && decision.affectedNodeIds.includes(nodeId);
}

/**
 * Pending decisions whose premise a newly approved revision supersedes: those
 * raised against a strictly older graph revision. Decisions without a revision
 * basis (pre-graph clarifications) are never auto-expired.
 */
export function supersededDecisionIds(
  decisions: Record<string, Decision>,
  newApprovedRevision: number
): string[] {
  return Object.values(decisions)
    .filter((decision) =>
      decision.status === "pending" &&
      decision.raisedAtGraphRevision !== undefined &&
      decision.raisedAtGraphRevision < newApprovedRevision
    )
    .map((decision) => decision.id)
    .sort();
}
