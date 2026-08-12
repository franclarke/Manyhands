import { EntityIdSchema } from "@manyhands/shared";
import { z } from "zod";
import { CanonicalContractRefSchema, CanonicalDigestSchema } from "./canonical-reference.js";

/** Planning obligation only. Evidence is an immutable observation elsewhere. */
export const CanonicalValidationObligationSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  digest: CanonicalDigestSchema,
  criterionId: EntityIdSchema,
  ownerNodeId: EntityIdSchema,
  required: z.boolean(),
  proofStrategy: CanonicalContractRefSchema
}).strict();

export type CanonicalValidationObligation = z.infer<typeof CanonicalValidationObligationSchema>;
