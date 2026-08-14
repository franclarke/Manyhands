import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

import { RunCommandJsonValueSchema } from "./command-envelope.js";
import { DeliveryApprovalSchema } from "./domain/outcomes.js";
import { HumanReviewInputSchema } from "./domain/human-review.js";

const StageSelectionSchema = z.object({
  executorId: EntityIdSchema,
  model: NonEmptyStringSchema,
  effort: NonEmptyStringSchema.optional()
}).strict();

/**
 * Immutable intake required to reconstruct a productive run without a web
 * process or RunRecord. Configuration remains transitional JSON because the
 * executor-specific contract is replaced in later stages; lifecycle authority
 * does not depend on interpreting it here.
 */
export const ProductRunDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  workspaceId: EntityIdSchema,
  userPrompt: NonEmptyStringSchema,
  acceptanceCriteria: z.array(NonEmptyStringSchema),
  title: NonEmptyStringSchema,
  // Accepted only for journals written by the first Stage 3 candidate. New
  // clients omit it and the actor derives lifecycle time from the envelope.
  createdAt: IsoTimestampSchema.optional(),
  planningSelection: StageSelectionSchema,
  executionSelection: StageSelectionSchema,
  repairSelection: StageSelectionSchema,
  executionConfig: z.record(RunCommandJsonValueSchema),
  granularityCondition: z.enum(["A", "C"]).optional(),
  targetContext: z.record(RunCommandJsonValueSchema)
}).strict();

export type ProductRunDefinition = z.infer<typeof ProductRunDefinitionSchema>;

export const ProductRunCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("create_run"), definition: ProductRunDefinitionSchema }).strict(),
  z.object({ type: z.literal("start_run") }).strict(),
  z.object({ type: z.literal("continue_run") }).strict(),
  z.object({ type: z.literal("pause_run"), reason: NonEmptyStringSchema }).strict(),
  z.object({ type: z.literal("resume_run"), reason: NonEmptyStringSchema }).strict(),
  z.object({ type: z.literal("restart_run"), reason: NonEmptyStringSchema }).strict(),
  z.object({ type: z.literal("cancel_run"), reason: NonEmptyStringSchema }).strict(),
  z.object({
    type: z.literal("resolve_decision"),
    decisionId: EntityIdSchema,
    optionId: EntityIdSchema.optional(),
    answer: NonEmptyStringSchema.optional()
  }).strict(),
  z.object({ type: z.literal("record_human_review"), review: HumanReviewInputSchema }).strict(),
  z.object({ type: z.literal("deliver_run"), approval: DeliveryApprovalSchema }).strict(),
  z.object({ type: z.literal("rename_run"), title: NonEmptyStringSchema }).strict(),
  z.object({ type: z.literal("archive_run") }).strict()
]);

export type ProductRunCommand = z.infer<typeof ProductRunCommandSchema>;
