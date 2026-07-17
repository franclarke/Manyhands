import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
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
  outcome: z.enum(["verified", "unverified", "failed"])
}).strict().superRefine((matrix, context) => {
  if (matrix.outcome === "verified" && matrix.criteria.some((criterion) => criterion.status === "failed" || criterion.status === "uncovered")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["outcome"], message: "verified matrix cannot contain failed or uncovered criteria" });
  }
});
export type EvidenceMatrixRecord = z.infer<typeof EvidenceMatrixRecordSchema>;
