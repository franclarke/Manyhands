import { EntityIdSchema, EpistemicAssessmentSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, sortedUniqueStrings, type DigestHasher } from "./canonical-json.js";
import {
  CanonicalContractRefSchema,
  CanonicalDigestSchema,
  RepositorySnapshotRefSchema,
  RepositoryViewRefSchema
} from "./canonical-reference.js";

export { EpistemicAssessmentSchema } from "@manyhands/shared";
export type { EpistemicAssessment } from "@manyhands/shared";

export const GranularityDecisionSchema = z.object({
  disposition: z.enum(["leaf", "split", "frontier"]),
  feasibility: z.object({
    coherentResponsibility: z.boolean(),
    boundedContext: z.enum(["yes", "no", "unknown"]),
    boundedChangeSurface: z.enum(["yes", "no", "unknown"]),
    independentlyValidatable: z.enum(["yes", "no", "unknown"]),
    unresolvedArchitectureDecision: z.boolean()
  }).strict(),
  splitReasons: z.array(z.enum([
    "capacity",
    "independent_delivery",
    "parallelism",
    "risk_isolation",
    "integration_boundary",
    "specialization"
  ])).default([]),
  expectedBenefits: z.array(NonEmptyStringSchema).default([]),
  expectedCosts: z.array(NonEmptyStringSchema).default([]),
  integrationObligationId: EntityIdSchema.optional(),
  evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  epistemic: EpistemicAssessmentSchema
}).strict().superRefine((decision, context) => {
  if (decision.disposition === "split") {
    if (decision.splitReasons.length === 0) issue(context, ["splitReasons"], "split requires at least one reason");
    if (decision.evidenceRefs.length === 0) issue(context, ["evidenceRefs"], "split requires evidence");
    if (decision.integrationObligationId === undefined) {
      issue(context, ["integrationObligationId"], "split requires a parent integration obligation");
    }
  }
  if (decision.disposition === "leaf") {
    const feasibility = decision.feasibility;
    if (!feasibility.coherentResponsibility) issue(context, ["feasibility", "coherentResponsibility"], "leaf must be coherent");
    for (const field of ["boundedContext", "boundedChangeSurface", "independentlyValidatable"] as const) {
      if (feasibility[field] === "no") issue(context, ["feasibility", field], "leaf feasibility cannot be no");
    }
    if (feasibility.unresolvedArchitectureDecision) {
      issue(context, ["feasibility", "unresolvedArchitectureDecision"], "leaf cannot retain an unresolved architecture decision");
    }
  }
});
export type GranularityDecision = z.infer<typeof GranularityDecisionSchema>;

const PlannedOutcomeSchema = z.object({ id: EntityIdSchema, statement: NonEmptyStringSchema }).strict();
const CriterionRefinementSchema = z.object({
  criterionId: EntityIdSchema,
  statement: NonEmptyStringSchema,
  sourceCriterionId: EntityIdSchema
}).strict();

export const WorkUnitSchema = z.object({
  id: EntityIdSchema,
  parentId: EntityIdSchema.optional(),
  role: z.enum(["leaf", "composite"]),
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  boundary: z.object({
    kind: z.enum(["application", "package", "module", "domain", "vertical_slice", "cross_cutting"]),
    evidenceRefs: z.array(NonEmptyStringSchema).default([])
  }).strict(),
  outcomes: z.array(PlannedOutcomeSchema).min(1),
  criteria: z.array(CriterionRefinementSchema).min(1),
  repositorySurface: z.object({
    resourceRefs: z.array(NonEmptyStringSchema).default([]),
    pathHints: z.array(NonEmptyStringSchema).default([])
  }).strict(),
  resourceIntents: z.array(z.object({
    resourceRef: NonEmptyStringSchema,
    access: z.enum(["read", "write", "coordinate"])
  }).strict()).default([]),
  consumes: z.array(EntityIdSchema).default([]),
  produces: z.array(EntityIdSchema).default([]),
  seamRefs: z.array(EntityIdSchema).default([]),
  validation: z.array(z.object({
    obligationId: EntityIdSchema,
    criterionId: EntityIdSchema
  }).strict()).default([]),
  uncertainty: z.array(z.object({
    id: EntityIdSchema,
    statement: NonEmptyStringSchema,
    evidenceRefs: z.array(NonEmptyStringSchema).default([])
  }).strict()).default([]),
  granularity: GranularityDecisionSchema,
  expansion: z.enum(["leaf", "expanded", "frontier"]),
  integration: z.object({ obligationId: EntityIdSchema, strategyRef: EntityIdSchema.optional() }).strict().optional()
}).strict();
export type WorkUnit = z.infer<typeof WorkUnitSchema>;

const PlannedSeamSchema = z.object({ id: EntityIdSchema, contract: CanonicalContractRefSchema }).strict();
const PlannedArtifactSchema = z.object({ id: EntityIdSchema, contract: CanonicalContractRefSchema }).strict();
const PlanningDecisionSchema = z.object({ id: EntityIdSchema, statement: NonEmptyStringSchema }).strict();
const PlanningEvidenceSchema = z.object({
  id: EntityIdSchema,
  snapshotId: EntityIdSchema,
  kind: z.enum(["file", "symbol", "relationship", "test", "command", "convention", "diagnostic"]),
  locator: NonEmptyStringSchema,
  digest: CanonicalDigestSchema,
  epistemic: EpistemicAssessmentSchema
}).strict();

const SemanticPlanMaterialObjectSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  goalContract: CanonicalContractRefSchema,
  repositorySnapshot: RepositorySnapshotRefSchema,
  repositoryView: RepositoryViewRefSchema,
  rootUnitId: EntityIdSchema,
  units: z.record(WorkUnitSchema),
  seams: z.record(PlannedSeamSchema),
  artifacts: z.record(PlannedArtifactSchema),
  decisions: z.array(PlanningDecisionSchema).default([]),
  evidence: z.array(PlanningEvidenceSchema).default([]),
  status: z.enum(["ready", "needs_input", "rejected"])
}).strict();

export const SemanticPlanMaterialSchema = SemanticPlanMaterialObjectSchema.superRefine((plan, context) => {
  if (plan.units[plan.rootUnitId] === undefined) issue(context, ["rootUnitId"], "rootUnitId must resolve to a work unit");
  for (const [key, unit] of Object.entries(plan.units)) {
    if (unit.id !== key) issue(context, ["units", key, "id"], "work unit id must match its record key");
    if (unit.parentId !== undefined && plan.units[unit.parentId] === undefined) {
      issue(context, ["units", key, "parentId"], "parentId must resolve to a work unit");
    }
  }
});

export const SemanticPlanSchema = SemanticPlanMaterialObjectSchema.extend({ digest: CanonicalDigestSchema }).strict().superRefine((plan, context) => {
  if (plan.units[plan.rootUnitId] === undefined) issue(context, ["rootUnitId"], "rootUnitId must resolve to a work unit");
  for (const [key, unit] of Object.entries(plan.units)) {
    if (unit.id !== key) issue(context, ["units", key, "id"], "work unit id must match its record key");
    if (unit.parentId !== undefined && plan.units[unit.parentId] === undefined) {
      issue(context, ["units", key, "parentId"], "parentId must resolve to a work unit");
    }
  }
});
export type SemanticPlanMaterial = z.infer<typeof SemanticPlanMaterialSchema>;
export type SemanticPlan = z.infer<typeof SemanticPlanSchema>;

export function buildSemanticPlan(input: SemanticPlanMaterial, hasher: DigestHasher): SemanticPlan {
  const parsed = SemanticPlanMaterialSchema.parse(input);
  const units = Object.fromEntries(Object.entries(parsed.units).map(([id, unit]) => [id, normalizeWorkUnit(unit)]));
  const material: SemanticPlanMaterial = { ...parsed, units };
  return { ...material, digest: computeCanonicalDigest(material, hasher) };
}

function normalizeWorkUnit(unit: WorkUnit): WorkUnit {
  return {
    ...unit,
    boundary: { ...unit.boundary, evidenceRefs: sortedUniqueStrings(unit.boundary.evidenceRefs) },
    repositorySurface: {
      resourceRefs: sortedUniqueStrings(unit.repositorySurface.resourceRefs),
      pathHints: sortedUniqueStrings(unit.repositorySurface.pathHints)
    },
    resourceIntents: [...unit.resourceIntents].sort((left, right) =>
      `${left.resourceRef}\0${left.access}`.localeCompare(`${right.resourceRef}\0${right.access}`)
    ),
    consumes: sortedUniqueStrings(unit.consumes),
    produces: sortedUniqueStrings(unit.produces),
    seamRefs: sortedUniqueStrings(unit.seamRefs),
    granularity: {
      ...unit.granularity,
      splitReasons: [...new Set(unit.granularity.splitReasons)].sort(),
      evidenceRefs: sortedUniqueStrings(unit.granularity.evidenceRefs)
    }
  };
}

function issue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
