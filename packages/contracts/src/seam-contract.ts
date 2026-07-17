import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { ContractIdentityShape, addDuplicateIssues } from "./contract-identity.js";

export const SeamContractKindSchema = z.enum(["api", "type", "event", "data", "ui", "command"]);

export const SeamCompatibilitySchema = z.object({
  mode: z.enum(["exact", "backward_compatible"]),
  rules: z.array(NonEmptyStringSchema).default([])
}).strict();

export const SeamContractSchema = z.object({
  ...ContractIdentityShape,
  kind: SeamContractKindSchema,
  specification: NonEmptyStringSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeIds: z.array(EntityIdSchema).min(1),
  semanticFacts: z.record(NonEmptyStringSchema).default({}),
  compatibility: SeamCompatibilitySchema,
  baselineArtifactContractId: EntityIdSchema.optional()
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(contract.consumerNodeIds, context, "consumerNodeIds");
  if (contract.consumerNodeIds.includes(contract.producerNodeId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["consumerNodeIds"],
      message: "producerNodeId cannot also be a consumer"
    });
  }
});

export type SeamContract = z.infer<typeof SeamContractSchema>;
