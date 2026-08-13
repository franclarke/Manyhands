import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, sortedUniqueStrings, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";
import { SemanticPlanSchema } from "./semantic-plan.js";

export const PlanningBudgetSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  repositoryQueries: z.number().int().nonnegative(),
  queryBytes: z.number().int().nonnegative(),
  revisions: z.number().int().positive(),
  repairs: z.number().int().nonnegative(),
  expansions: z.number().int().nonnegative()
}).strict();
export type PlanningBudget = z.infer<typeof PlanningBudgetSchema>;

export const PlanningBudgetUsageSchema = z.object({
  modelCalls: z.number().int().nonnegative(),
  repositoryQueries: z.number().int().nonnegative(),
  queryBytes: z.number().int().nonnegative(),
  revisions: z.number().int().nonnegative(),
  repairs: z.number().int().nonnegative(),
  expansions: z.number().int().nonnegative()
}).strict();
export type PlanningBudgetUsage = z.infer<typeof PlanningBudgetUsageSchema>;

export const PlanningFindingSchema = z.object({
  code: NonEmptyStringSchema,
  severity: z.enum(["error", "warning", "advisory"]),
  authority: z.enum(["deterministic", "repository", "model_advisory"]),
  message: NonEmptyStringSchema,
  subjectId: EntityIdSchema.optional(),
  evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  resolution: z.enum(["deterministic_check", "repository_query", "human_decision", "none"])
}).strict().superRefine((finding, context) => {
  if (finding.authority === "model_advisory" && finding.severity !== "advisory") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["severity"], message: "model findings are advisory only" });
  }
  if (finding.authority === "model_advisory" && finding.resolution === "none") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["resolution"], message: "model findings require an explicit resolution route" });
  }
});
export type PlanningFinding = z.infer<typeof PlanningFindingSchema>;

export const DecisionDraftSchema = z.object({
  id: EntityIdSchema,
  question: NonEmptyStringSchema,
  rationale: NonEmptyStringSchema,
  options: z.array(z.object({
    id: EntityIdSchema,
    label: NonEmptyStringSchema,
    consequences: z.array(NonEmptyStringSchema).min(1)
  }).strict()).min(2),
  evidenceRefs: z.array(NonEmptyStringSchema).default([])
}).strict();
export type DecisionDraft = z.infer<typeof DecisionDraftSchema>;

export const PlanningContinuationSchema = z.object({
  requestDigest: CanonicalDigestSchema,
  revisionDigest: CanonicalDigestSchema
}).strict();
export type PlanningContinuation = z.infer<typeof PlanningContinuationSchema>;

export const PlanningAlternativeRefSchema = z.object({
  id: EntityIdSchema,
  proposalDigest: CanonicalDigestSchema,
  summary: NonEmptyStringSchema,
  evidenceRefs: z.array(NonEmptyStringSchema).default([])
}).strict();
export type PlanningAlternativeRef = z.infer<typeof PlanningAlternativeRefSchema>;

const PlanningRevisionMaterialObjectSchema = z.object({
  index: z.number().int().positive(),
  parentDigest: CanonicalDigestSchema.optional(),
  cause: z.enum(["initial", "repository_evidence", "human_decision", "deterministic_repair", "expansion", "amendment"]),
  budget: PlanningBudgetSchema,
  consumed: PlanningBudgetUsageSchema,
  queryReceipts: z.array(NonEmptyStringSchema).default([]),
  evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  changedDecisionIds: z.array(EntityIdSchema).default([]),
  changedFindingCodes: z.array(NonEmptyStringSchema).default([]),
  proposalDigest: CanonicalDigestSchema.optional()
}).strict();

function validatePlanningRevision(
  revision: z.infer<typeof PlanningRevisionMaterialObjectSchema>,
  context: z.RefinementCtx
): void {
  for (const key of Object.keys(revision.consumed) as Array<keyof PlanningBudgetUsage>) {
    if (revision.consumed[key] > revision.budget[key]) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["consumed", key], message: `${key} exceeds the request budget` });
    }
  }
  if (revision.index === 1 && revision.parentDigest !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parentDigest"], message: "the initial revision cannot have a parent" });
  }
  if (revision.index > 1 && revision.parentDigest === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["parentDigest"], message: "a later revision requires its parent digest" });
  }
}

export const PlanningRevisionMaterialSchema = PlanningRevisionMaterialObjectSchema.superRefine(validatePlanningRevision);
export const PlanningRevisionSchema = PlanningRevisionMaterialObjectSchema
  .extend({ digest: CanonicalDigestSchema }).strict().superRefine(validatePlanningRevision);
export type PlanningRevisionMaterial = z.infer<typeof PlanningRevisionMaterialSchema>;
export type PlanningRevision = z.infer<typeof PlanningRevisionSchema>;

export function buildPlanningRevision(input: PlanningRevisionMaterial, hasher: DigestHasher): PlanningRevision {
  const parsed = PlanningRevisionMaterialSchema.parse(input);
  const material: PlanningRevisionMaterial = {
    ...parsed,
    queryReceipts: sortedUniqueStrings(parsed.queryReceipts),
    evidenceRefs: sortedUniqueStrings(parsed.evidenceRefs),
    changedDecisionIds: sortedUniqueStrings(parsed.changedDecisionIds),
    changedFindingCodes: sortedUniqueStrings(parsed.changedFindingCodes)
  };
  return { ...material, digest: computeCanonicalDigest(material, hasher) };
}

export const PlanningTraceSchema = z.object({
  budget: PlanningBudgetSchema,
  consumed: PlanningBudgetUsageSchema,
  revisions: z.array(PlanningRevisionSchema),
  advisoryFindings: z.array(PlanningFindingSchema)
}).strict();
export type PlanningTrace = z.infer<typeof PlanningTraceSchema>;

export const PlanningResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), plan: SemanticPlanSchema, trace: PlanningTraceSchema }).strict(),
  z.object({
    kind: z.literal("needs_input"),
    decisions: z.array(DecisionDraftSchema).min(1),
    continuation: PlanningContinuationSchema,
    trace: PlanningTraceSchema
  }).strict(),
  z.object({
    kind: z.literal("ambiguous"),
    decisions: z.array(DecisionDraftSchema).min(1),
    alternatives: z.array(PlanningAlternativeRefSchema).min(2),
    trace: PlanningTraceSchema
  }).strict(),
  z.object({
    kind: z.literal("unsupported"),
    findings: z.array(PlanningFindingSchema).min(1),
    missingCapabilities: z.array(NonEmptyStringSchema).min(1),
    trace: PlanningTraceSchema
  }).strict(),
  z.object({ kind: z.literal("rejected"), findings: z.array(PlanningFindingSchema).min(1), trace: PlanningTraceSchema }).strict()
]);
export type PlanningResult = z.infer<typeof PlanningResultSchema>;
