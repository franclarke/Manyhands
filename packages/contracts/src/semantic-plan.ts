import { EntityIdSchema, EpistemicAssessmentSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { ArtifactMaterializationSchema } from "./artifact-contract.js";
import { computeCanonicalDigest, sortedUniqueStrings, type DigestHasher } from "./canonical-json.js";
import {
  CanonicalContractRefSchema,
  CanonicalDigestSchema,
  RepositorySnapshotRefSchema,
  RepositoryViewRefSchema
} from "./canonical-reference.js";
import { SeamCompatibilitySchema, SeamContractKindSchema } from "./seam-contract.js";
import { AcceptableEvidenceKindSchema, ValidationLayerSchema } from "./validation-contract.js";

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
    "capacity", "independent_delivery", "parallelism", "risk_isolation",
    "integration_boundary", "specialization"
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

export const PlannedOutcomeSchema = z.object({ id: EntityIdSchema, statement: NonEmptyStringSchema }).strict();
export const CriterionRefinementSchema = z.object({
  criterionId: EntityIdSchema,
  statement: NonEmptyStringSchema,
  sourceCriterionId: EntityIdSchema
}).strict();

export const PlannedResourceIntentSchema = z.discriminatedUnion("access", [
  z.object({
    resourceId: EntityIdSchema,
    access: z.literal("observe"),
    inputArtifactId: EntityIdSchema.optional(),
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    epistemic: EpistemicAssessmentSchema
  }).strict(),
  z.object({
    resourceId: EntityIdSchema,
    access: z.literal("modify"),
    ownerPhase: z.enum(["implementation", "integration"]),
    inputArtifactId: EntityIdSchema.optional(),
    outputArtifactId: EntityIdSchema,
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    epistemic: EpistemicAssessmentSchema
  }).strict()
]);
export type PlannedResourceIntent = z.infer<typeof PlannedResourceIntentSchema>;

export const PlannedValidationObligationSchema = z.object({
  obligationId: EntityIdSchema,
  criterionId: EntityIdSchema,
  proofStrategyId: EntityIdSchema,
  layer: ValidationLayerSchema,
  severity: z.enum(["required", "advisory"]),
  acceptableEvidence: z.array(AcceptableEvidenceKindSchema).min(1),
  baselinePolicy: z.enum(["required", "optional", "not_required"]),
  negativeControl: z.enum(["required", "when_feasible", "not_required"]),
  flakyPolicy: z.enum(["forbid", "allow_with_warning"])
}).strict();
export type PlannedValidationObligation = z.infer<typeof PlannedValidationObligationSchema>;

export const PlannedIntegrationSchema = z.object({
  obligationId: EntityIdSchema,
  objective: NonEmptyStringSchema,
  criterionIds: z.array(EntityIdSchema).min(1),
  proofStrategyId: EntityIdSchema,
  artifactIds: z.array(EntityIdSchema).default([]),
  seamIds: z.array(EntityIdSchema).default([])
}).strict();
export type PlannedIntegration = z.infer<typeof PlannedIntegrationSchema>;

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
  resourceIntents: z.array(PlannedResourceIntentSchema).default([]),
  consumes: z.array(EntityIdSchema).default([]),
  produces: z.array(EntityIdSchema).default([]),
  seamRefs: z.array(EntityIdSchema).default([]),
  validation: z.array(PlannedValidationObligationSchema).default([]),
  uncertainty: z.array(z.object({
    id: EntityIdSchema,
    statement: NonEmptyStringSchema,
    evidenceRefs: z.array(NonEmptyStringSchema).default([]),
    disposition: z.enum(["bounded", "decision_required", "unsupported"])
  }).strict()).default([]),
  granularity: GranularityDecisionSchema,
  expansion: z.enum(["leaf", "expanded", "frontier"]),
  integration: PlannedIntegrationSchema.optional()
}).strict();
export type WorkUnit = z.infer<typeof WorkUnitSchema>;

export const PlannedSeamSchema = z.object({
  id: EntityIdSchema,
  kind: SeamContractKindSchema,
  specification: NonEmptyStringSchema,
  producerUnitId: EntityIdSchema,
  consumerUnitIds: z.array(EntityIdSchema).min(1),
  semanticFacts: z.record(NonEmptyStringSchema).default({}),
  compatibility: SeamCompatibilitySchema,
  artifactId: EntityIdSchema,
  validationObligationIds: z.array(EntityIdSchema).min(1)
}).strict();
export type PlannedSeam = z.infer<typeof PlannedSeamSchema>;

export const PlannedArtifactSchema = z.object({
  id: EntityIdSchema,
  producerUnitId: EntityIdSchema,
  consumerUnitIds: z.array(EntityIdSchema).default([]),
  artifactType: NonEmptyStringSchema,
  mediaType: NonEmptyStringSchema.optional(),
  materialization: ArtifactMaterializationSchema,
  expectedPaths: z.array(NonEmptyStringSchema).default([])
}).strict();
export type PlannedArtifact = z.infer<typeof PlannedArtifactSchema>;

export const PlanningDecisionRecordSchema = z.object({
  id: EntityIdSchema,
  statement: NonEmptyStringSchema,
  selectedOptionId: EntityIdSchema,
  evidenceRefs: z.array(NonEmptyStringSchema).default([])
}).strict();
export const PlanningEvidenceSchema = z.object({
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
  decisions: z.array(PlanningDecisionRecordSchema).default([]),
  evidence: z.array(PlanningEvidenceSchema).default([]),
  status: z.literal("ready")
}).strict();

function validatePlanShape(plan: z.infer<typeof SemanticPlanMaterialObjectSchema>, context: z.RefinementCtx): void {
  if (plan.units[plan.rootUnitId] === undefined) issue(context, ["rootUnitId"], "rootUnitId must resolve to a work unit");
  for (const [key, unit] of Object.entries(plan.units)) {
    if (unit.id !== key) issue(context, ["units", key, "id"], "work unit id must match its record key");
    if (unit.parentId !== undefined && plan.units[unit.parentId] === undefined) {
      issue(context, ["units", key, "parentId"], "parentId must resolve to a work unit");
    }
  }
  for (const [key, seam] of Object.entries(plan.seams)) {
    if (seam.id !== key) issue(context, ["seams", key, "id"], "seam id must match its record key");
  }
  for (const [key, artifact] of Object.entries(plan.artifacts)) {
    if (artifact.id !== key) issue(context, ["artifacts", key, "id"], "artifact id must match its record key");
  }
}

export const SemanticPlanMaterialSchema = SemanticPlanMaterialObjectSchema.superRefine(validatePlanShape);
export const SemanticPlanSchema = SemanticPlanMaterialObjectSchema.extend({ digest: CanonicalDigestSchema })
  .strict().superRefine(validatePlanShape);
export type SemanticPlanMaterial = z.infer<typeof SemanticPlanMaterialSchema>;
export type SemanticPlan = z.infer<typeof SemanticPlanSchema>;

export function buildSemanticPlan(input: SemanticPlanMaterial, hasher: DigestHasher): SemanticPlan {
  const parsed = SemanticPlanMaterialSchema.parse(input);
  const units = Object.fromEntries(Object.entries(parsed.units).map(([id, unit]) => [id, normalizeWorkUnit(unit)]));
  const seams = Object.fromEntries(Object.entries(parsed.seams).map(([id, seam]) => [id, normalizeSeam(seam)]));
  const artifacts = Object.fromEntries(Object.entries(parsed.artifacts).map(([id, artifact]) => [id, normalizeArtifact(artifact)]));
  const material: SemanticPlanMaterial = {
    ...parsed,
    units,
    seams,
    artifacts,
    decisions: parsed.decisions.map((decision) => ({
      ...decision,
      evidenceRefs: sortedUniqueStrings(decision.evidenceRefs)
    })).sort((left, right) => left.id.localeCompare(right.id)),
    evidence: [...parsed.evidence].sort((left, right) => left.id.localeCompare(right.id))
  };
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
    resourceIntents: [...unit.resourceIntents].map((intent) => ({
      ...intent,
      evidenceRefs: sortedUniqueStrings(intent.evidenceRefs)
    })).sort((left, right) => `${left.resourceId}\0${left.access}`.localeCompare(`${right.resourceId}\0${right.access}`)),
    consumes: sortedUniqueStrings(unit.consumes),
    produces: sortedUniqueStrings(unit.produces),
    seamRefs: sortedUniqueStrings(unit.seamRefs),
    validation: [...unit.validation].sort((left, right) => left.obligationId.localeCompare(right.obligationId)),
    granularity: {
      ...unit.granularity,
      splitReasons: [...new Set(unit.granularity.splitReasons)].sort(),
      evidenceRefs: sortedUniqueStrings(unit.granularity.evidenceRefs)
    },
    ...(unit.integration === undefined ? {} : {
      integration: {
        ...unit.integration,
        criterionIds: sortedUniqueStrings(unit.integration.criterionIds),
        artifactIds: sortedUniqueStrings(unit.integration.artifactIds),
        seamIds: sortedUniqueStrings(unit.integration.seamIds)
      }
    })
  };
}

function normalizeSeam(seam: PlannedSeam): PlannedSeam {
  return {
    ...seam,
    consumerUnitIds: sortedUniqueStrings(seam.consumerUnitIds),
    validationObligationIds: sortedUniqueStrings(seam.validationObligationIds),
    compatibility: { ...seam.compatibility, rules: sortedUniqueStrings(seam.compatibility.rules) }
  };
}

function normalizeArtifact(artifact: PlannedArtifact): PlannedArtifact {
  return {
    ...artifact,
    consumerUnitIds: sortedUniqueStrings(artifact.consumerUnitIds),
    expectedPaths: sortedUniqueStrings(artifact.expectedPaths)
  };
}

function issue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
