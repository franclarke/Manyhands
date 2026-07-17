import { ContractReferenceSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const ArtifactRequirementSchema = z.object({
  id: EntityIdSchema,
  artifactContract: ContractReferenceSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeId: EntityIdSchema,
  requiredFor: z.enum(["execution", "validation", "integration"])
}).strict().superRefine((requirement, context) => {
  if (requirement.producerNodeId === requirement.consumerNodeId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["consumerNodeId"], message: "an artifact requirement must cross node boundaries" });
  }
});

export type ArtifactRequirement = z.infer<typeof ArtifactRequirementSchema>;

export const SeamBindingSchema = z.object({
  id: EntityIdSchema,
  seamContract: ContractReferenceSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeId: EntityIdSchema,
  producerRevision: NonEmptyStringSchema,
  consumerRevision: NonEmptyStringSchema
}).strict().superRefine((binding, context) => {
  if (binding.producerNodeId === binding.consumerNodeId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["consumerNodeId"], message: "a seam binding must cross node boundaries" });
  }
  if (binding.producerRevision !== binding.seamContract.revision || binding.consumerRevision !== binding.seamContract.revision) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["seamContract", "revision"], message: "producer and consumer must bind the declared seam contract revision" });
  }
});

export type SeamBinding = z.infer<typeof SeamBindingSchema>;

export const ConflictConstraintSchema = z.object({
  id: EntityIdSchema,
  leftNodeId: EntityIdSchema,
  rightNodeId: EntityIdSchema,
  reason: NonEmptyStringSchema,
  risk: z.enum(["low", "medium", "high"])
}).strict().superRefine((constraint, context) => {
  if (constraint.leftNodeId === constraint.rightNodeId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["rightNodeId"], message: "a conflict constraint requires two different nodes" });
  }
});

export type ConflictConstraint = z.infer<typeof ConflictConstraintSchema>;

export const LegacyOrderingConstraintSchema = z.object({
  id: EntityIdSchema,
  fromNodeId: EntityIdSchema,
  toNodeId: EntityIdSchema,
  reason: NonEmptyStringSchema,
  deprecated: z.literal(true),
  requiresReplan: z.literal(true)
}).strict();

export type LegacyOrderingConstraint = z.infer<typeof LegacyOrderingConstraintSchema>;
