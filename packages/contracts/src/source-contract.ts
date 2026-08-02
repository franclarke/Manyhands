import { NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

/**
 * The user-authored planning contract that must survive probabilistic
 * decomposition unchanged. It is deliberately separate from local leaf
 * criteria, which are derived by the planner/compiler.
 */
export const SourceContractSchema = z.object({
  goal: NonEmptyStringSchema,
  acceptanceCriteria: z.array(NonEmptyStringSchema),
  constraints: z.array(NonEmptyStringSchema)
}).strict();

export type SourceContract = z.infer<typeof SourceContractSchema>;
