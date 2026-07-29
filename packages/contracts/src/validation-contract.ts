import { EntityIdSchema, NonEmptyStringSchema, ValidationEvidenceKindSchema } from "@manyhands/shared";
import { z } from "zod";
import { ContractIdentityShape, addDuplicateIssues } from "./contract-identity.js";

export const ValidationLayerSchema = z.enum([
  "static",
  "unit",
  "integration",
  "e2e",
  "security",
  "accessibility",
  "manual"
]);

export const AcceptableEvidenceKindSchema = ValidationEvidenceKindSchema;

export const ValidationEvidenceBindingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("focused_command"),
    selectors: z.array(NonEmptyStringSchema).min(1),
    references: z.array(NonEmptyStringSchema).min(1)
  }).strict(),
  z.object({
    kind: z.literal("static_proof"),
    references: z.array(NonEmptyStringSchema).min(1)
  }).strict(),
  z.object({
    kind: z.literal("shared_command"),
    criterionIds: z.array(EntityIdSchema).min(1),
    references: z.array(NonEmptyStringSchema).min(1),
    rationale: NonEmptyStringSchema
  }).strict()
]);

export const ValidationObligationSchema = z.object({
  id: EntityIdSchema,
  criterionId: EntityIdSchema,
  layer: ValidationLayerSchema,
  severity: z.enum(["required", "advisory"]),
  acceptableEvidence: z.array(AcceptableEvidenceKindSchema).min(1),
  baselinePolicy: z.enum(["required", "optional", "not_required"]),
  negativeControl: z.enum(["required", "when_feasible", "not_required"]),
  flakyPolicy: z.enum(["forbid", "allow_with_warning"]),
  evidence: ValidationEvidenceBindingSchema.optional()
}).strict();

export type ValidationObligation = z.infer<typeof ValidationObligationSchema>;

export const ValidationContractSchema = z.object({
  ...ContractIdentityShape,
  nodeId: EntityIdSchema,
  obligations: z.array(ValidationObligationSchema).min(1)
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(contract.obligations.map((obligation) => obligation.id), context, "obligations");
});

export type ValidationContract = z.infer<typeof ValidationContractSchema>;
