import { EntityIdSchema } from "@manyhands/shared";
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

export const AcceptableEvidenceKindSchema = z.enum([
  "static_analysis",
  "test_result",
  "runtime_observation",
  "artifact_inspection",
  "manual_attestation"
]);

export const ValidationObligationSchema = z.object({
  id: EntityIdSchema,
  criterionId: EntityIdSchema,
  layer: ValidationLayerSchema,
  severity: z.enum(["required", "advisory"]),
  acceptableEvidence: z.array(AcceptableEvidenceKindSchema).min(1),
  baselinePolicy: z.enum(["required", "optional", "not_required"]),
  negativeControl: z.enum(["required", "when_feasible", "not_required"]),
  flakyPolicy: z.enum(["forbid", "allow_with_warning"])
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
