import { CanonicalDigestSchema, ExactCandidateSchema } from "@manyhands/contracts";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

/**
 * A human judgment is evidence with explicit operator authority over one exact
 * candidate. Its validity is projected from subsequent candidate events rather
 * than mutating the journaled judgment.
 */
export const HumanReviewInputSchema = z.object({
  reviewId: EntityIdSchema,
  attemptId: EntityIdSchema,
  nodeId: EntityIdSchema,
  candidate: ExactCandidateSchema,
  rubricDigest: CanonicalDigestSchema,
  authority: z.literal("operator"),
  reviewerId: NonEmptyStringSchema,
  decision: z.enum(["approved", "rejected"]),
  reviewedAt: IsoTimestampSchema
}).strict();

export const HumanReviewSchema = HumanReviewInputSchema.extend({
  status: z.enum(["active", "stale"])
}).strict();

export type HumanReviewInput = z.infer<typeof HumanReviewInputSchema>;
export type HumanReview = z.infer<typeof HumanReviewSchema>;
