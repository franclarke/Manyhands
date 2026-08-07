import { RepoRelativePathSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

export const PlanningArchitectureVersionSchema = z.enum(["v1", "v2"]);
export type PlanningArchitectureVersion = z.infer<typeof PlanningArchitectureVersionSchema>;

export const SemanticCutSchema = z.object({
  criterion: z.enum(["cohesion", "integration", "risk", "verifiability"]),
  rationale: NonEmptyStringSchema
}).strict();

/**
 * Raw complexity signals for one unit, emitted by the semantic Planner (LLM)
 * and validated deterministically against the unit's declared surface before
 * the adaptive C_task policy decides leaf vs composite. Each dimension is a
 * 0..10 magnitude; the policy — not the planner — owns the decision boundary.
 */
export const ComplexitySignalsSchema = z.object({
  scopeRadius: z.number().min(0).max(10),
  interfaceImpact: z.number().min(0).max(10),
  validationSurface: z.number().min(0).max(10),
  contextTokenMass: z.number().min(0).max(10),
  rationale: NonEmptyStringSchema.optional()
}).strict();

export type ComplexitySignals = z.infer<typeof ComplexitySignalsSchema>;

const WorkUnitCommonShape = {
  key: EntityIdSchema,
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  concerns: z.array(NonEmptyStringSchema).min(1),
  expectedOutcomes: z.array(NonEmptyStringSchema).min(1),
  acceptanceIntentIds: z.array(EntityIdSchema).min(1),
  evidenceIds: z.array(EntityIdSchema),
  plannedPaths: z.array(RepoRelativePathSchema).optional(),
  /** Every file the unit writes, existing or not. See SemanticWorkUnit. */
  writePaths: z.array(RepoRelativePathSchema).optional(),
  complexitySignals: ComplexitySignalsSchema.optional()
};

export interface WorkUnitLeaf {
  key: string;
  kind: "leaf";
  title: string;
  objective: string;
  concerns: string[];
  expectedOutcomes: string[];
  acceptanceIntentIds: string[];
  evidenceIds: string[];
  plannedPaths?: string[] | undefined;
  writePaths?: string[] | undefined;
  complexitySignals?: ComplexitySignals | undefined;
}

export interface WorkUnitComposite {
  key: string;
  kind: "composite";
  title: string;
  objective: string;
  concerns: string[];
  expectedOutcomes: string[];
  acceptanceIntentIds: string[];
  evidenceIds: string[];
  plannedPaths?: string[] | undefined;
  writePaths?: string[] | undefined;
  complexitySignals?: ComplexitySignals | undefined;
  cut: z.infer<typeof SemanticCutSchema>;
  children: WorkUnit[];
}

export type WorkUnit = WorkUnitLeaf | WorkUnitComposite;

const WorkUnitLeafSchema = z.object({
  ...WorkUnitCommonShape,
  kind: z.literal("leaf")
}).strict();

export const WorkUnitSchema: z.ZodType<WorkUnit> = z.lazy(() => z.union([
  WorkUnitLeafSchema,
  z.object({
    ...WorkUnitCommonShape,
    kind: z.literal("composite"),
    cut: SemanticCutSchema,
    children: z.array(WorkUnitSchema).min(1)
  }).strict()
]));

export const AcceptanceIntentSchema = z.object({
  id: EntityIdSchema,
  description: NonEmptyStringSchema,
  required: z.boolean()
}).strict();

export const RepositoryEvidenceSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["path", "symbol", "script", "stack", "diagnostic"]),
  reference: NonEmptyStringSchema,
  observation: NonEmptyStringSchema,
  confidence: z.number().min(0).max(1)
}).strict();

export type RepositoryEvidence = z.infer<typeof RepositoryEvidenceSchema>;

export const CandidateArtifactSchema = z.object({
  id: EntityIdSchema,
  artifactType: NonEmptyStringSchema,
  producerUnitKey: EntityIdSchema,
  consumerUnitKeys: z.array(EntityIdSchema).min(1),
  purpose: NonEmptyStringSchema,
  materializationHint: z.enum(["logical", "files", "manifest", "commit"]),
  evidenceIds: z.array(EntityIdSchema).default([])
}).strict();

export const CandidateSeamSchema = z.object({
  id: EntityIdSchema,
  kind: z.enum(["api", "type", "event", "data", "ui", "command"]),
  specification: NonEmptyStringSchema,
  producerUnitKey: EntityIdSchema,
  consumerUnitKeys: z.array(EntityIdSchema).min(1),
  evidenceIds: z.array(EntityIdSchema).default([])
}).strict();

export const WorkUncertaintySchema = z.object({
  id: EntityIdSchema,
  description: NonEmptyStringSchema,
  impact: NonEmptyStringSchema,
  requiresHumanDecision: z.boolean(),
  evidenceIds: z.array(EntityIdSchema).default([])
}).strict();

export const WorkQuestionSchema = z.object({
  id: EntityIdSchema,
  question: NonEmptyStringSchema,
  reason: NonEmptyStringSchema,
  impact: z.enum(["behavior", "architecture", "scope", "risk", "acceptance"]),
  options: z.array(NonEmptyStringSchema).min(2),
  evidenceIds: z.array(EntityIdSchema).default([])
}).strict();

export const WorkBreakdownSchema = z.object({
  schemaVersion: z.literal(2),
  breakdownId: EntityIdSchema,
  objective: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  acceptanceIntents: z.array(AcceptanceIntentSchema).min(1),
  root: WorkUnitSchema,
  candidateArtifacts: z.array(CandidateArtifactSchema).default([]),
  candidateSeams: z.array(CandidateSeamSchema).default([]),
  repositoryEvidence: z.array(RepositoryEvidenceSchema).default([]),
  uncertainties: z.array(WorkUncertaintySchema).default([]),
  questions: z.array(WorkQuestionSchema).default([])
}).strict().superRefine((breakdown, context) => {
  const units = flattenUnits(breakdown.root);
  checkUnique(units.map((unit) => unit.key), "unit key", context);
  checkUnique(breakdown.acceptanceIntents.map((intent) => intent.id), "acceptance intent id", context);
  checkUnique(breakdown.repositoryEvidence.map((evidence) => evidence.id), "repository evidence id", context);
  checkUnique([
    ...breakdown.candidateArtifacts.map((candidate) => candidate.id),
    ...breakdown.candidateSeams.map((candidate) => candidate.id)
  ], "candidate relation id", context);

  const unitKeys = new Set(units.map((unit) => unit.key));
  const acceptanceIds = new Set(breakdown.acceptanceIntents.map((intent) => intent.id));
  const evidenceIds = new Set(breakdown.repositoryEvidence.map((evidence) => evidence.id));
  const pathEvidenceIds = new Set(breakdown.repositoryEvidence.filter((evidence) => evidence.kind === "path").map((evidence) => evidence.id));
  for (const unit of units) {
    for (const id of unit.acceptanceIntentIds) if (!acceptanceIds.has(id)) addIssue(context, `unit ${unit.key} references unknown acceptance intent ${id}`);
    for (const evidenceId of unit.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `unit ${unit.key} references unknown evidence ${evidenceId}`);
    if (unit.kind === "leaf" && (unit.plannedPaths?.length ?? 0) === 0 && !unit.evidenceIds.some((evidenceId) => pathEvidenceIds.has(evidenceId))) {
      addIssue(context, `leaf ${unit.key} must reference an existing path or declare at least one planned path`);
    }
  }
  for (const relation of [...breakdown.candidateArtifacts, ...breakdown.candidateSeams]) {
    if (!unitKeys.has(relation.producerUnitKey)) addIssue(context, `candidate ${relation.id} references unknown producer ${relation.producerUnitKey}`);
    for (const consumer of relation.consumerUnitKeys) {
      if (!unitKeys.has(consumer)) addIssue(context, `candidate ${relation.id} references unknown consumer ${consumer}`);
      if (consumer === relation.producerUnitKey) addIssue(context, `candidate ${relation.id} cannot consume its own output`);
    }
    for (const evidenceId of relation.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `candidate ${relation.id} references unknown evidence ${evidenceId}`);
  }
  for (const item of [...breakdown.uncertainties, ...breakdown.questions]) for (const evidenceId of item.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `${item.id} references unknown evidence ${evidenceId}`);
});

export type WorkBreakdown = z.infer<typeof WorkBreakdownSchema>;

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function checkUnique(values: string[], label: string, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) addIssue(context, `duplicate ${label} ${value}`);
    seen.add(value);
  }
}

function addIssue(context: z.RefinementCtx, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, message });
}
