import { CriterionEvidenceObservationSchema, EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const CriterionEvidenceStatusSchema = z.enum(["satisfied", "failed", "uncovered", "flaky", "not_applicable"]);
export const CriterionEvidenceSchema = z.object({
  criterionId: EntityIdSchema,
  obligationId: EntityIdSchema,
  status: CriterionEvidenceStatusSchema,
  justification: NonEmptyStringSchema,
  evidenceRefs: z.array(NonEmptyStringSchema)
}).strict();

export const EvidenceMatrixRecordSchema = z.object({
  matrixId: EntityIdSchema,
  candidateCommit: NonEmptyStringSchema,
  validationContract: z.object({ id: EntityIdSchema, revision: NonEmptyStringSchema }).strict(),
  criteria: z.array(CriterionEvidenceSchema).min(1),
  outcome: z.enum(["verified", "unverified", "failed"]),
  validationRecipeDigest: NonEmptyStringSchema.optional(),
  observations: z.array(CriterionEvidenceObservationSchema).default([]),
  integrityFindings: z.array(z.object({
    findingId: EntityIdSchema,
    code: z.enum(["test_removed", "test_script_weakened", "test_configuration_changed", "test_skipped", "test_only", "assertion_removed", "required_public_surface_unchanged", "required_public_surface_unrepresented"]),
    path: NonEmptyStringSchema,
    message: NonEmptyStringSchema
  }).strict()).optional(),
  negativeControls: z.array(z.object({
    evidenceId: EntityIdSchema,
    obligationId: EntityIdSchema,
    detectedFailure: z.boolean(),
    outputDigest: NonEmptyStringSchema.regex(/^[a-f0-9]{64}$/u)
  }).strict()).optional()
}).strict().superRefine((matrix, context) => {
  if (matrix.outcome === "verified" && matrix.criteria.some((criterion) => criterion.status === "failed" || criterion.status === "uncovered")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "verified matrix cannot contain failed or uncovered criteria" });
  }
  if (matrix.outcome === "verified" && (matrix.integrityFindings?.length ?? 0) > 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "verified matrix cannot contain test-integrity findings" });
  }
  if (matrix.outcome === "verified" && matrix.negativeControls?.some((control) => !control.detectedFailure) === true) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "verified matrix cannot contain a failed negative control" });
  }
});
export type EvidenceMatrixRecord = z.infer<typeof EvidenceMatrixRecordSchema>;
