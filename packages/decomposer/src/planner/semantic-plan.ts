import { createHash } from "node:crypto";
import { RepoRelativePathSchema } from "@manyhands/contracts";
import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import type { GranularityPlanningBrief } from "../granularity/planning-brief.js";
import { ComplexitySignalsSchema, RepositoryEvidenceSchema, SemanticCutSchema, WorkQuestionSchema, WorkUncertaintySchema, type ComplexitySignals, type RepositoryEvidence } from "./schema.js";

export const SEMANTIC_PLAN_SCHEMA_VERSION = 2 as const;

export type { RepositoryEvidence };

export const SemanticVerificationSchema = z.object({
  kind: z.enum(["existing", "author_test", "manual"]),
  references: z.array(NonEmptyStringSchema).min(1),
  rationale: NonEmptyStringSchema.optional()
}).strict();

export type SemanticVerification = z.infer<typeof SemanticVerificationSchema>;

export const SemanticOutcomeSchema = z.object({
  id: EntityIdSchema,
  description: NonEmptyStringSchema,
  criterionIds: z.array(EntityIdSchema).min(1),
  verification: SemanticVerificationSchema
}).strict();

export type SemanticOutcome = z.infer<typeof SemanticOutcomeSchema>;

const SemanticWorkUnitCommonShape = {
  key: EntityIdSchema,
  title: NonEmptyStringSchema,
  objective: NonEmptyStringSchema,
  concerns: z.array(NonEmptyStringSchema).min(1),
  evidenceIds: z.array(EntityIdSchema),
  plannedPaths: z.array(RepoRelativePathSchema).optional(),
  /**
   * Every file the unit writes, whether or not it already exists.
   *
   * `plannedPaths` only names files that do *not* exist yet, and `evidenceIds`
   * folds a modified file in with the ones merely read, so between them there
   * was no way to say "I change this existing file" as distinct from "I read
   * it". The compiler then had to treat any shared path as a conflict and
   * serialize units that were provably safe to run together (D9). Optional
   * because plans persisted before stage 4 do not carry it.
   */
  writePaths: z.array(RepoRelativePathSchema).optional(),
  complexitySignals: ComplexitySignalsSchema.optional(),
  outcomes: z.array(SemanticOutcomeSchema).min(1)
};

export interface SemanticWorkLeaf {
  key: string;
  kind: "leaf";
  title: string;
  objective: string;
  concerns: string[];
  evidenceIds: string[];
  plannedPaths?: string[] | undefined;
  writePaths?: string[] | undefined;
  complexitySignals?: ComplexitySignals | undefined;
  outcomes: SemanticOutcome[];
}

export interface SemanticWorkComposite {
  key: string;
  kind: "composite";
  title: string;
  objective: string;
  concerns: string[];
  evidenceIds: string[];
  plannedPaths?: string[] | undefined;
  writePaths?: string[] | undefined;
  complexitySignals?: ComplexitySignals | undefined;
  outcomes: SemanticOutcome[];
  cut: z.infer<typeof SemanticCutSchema>;
  children: SemanticWorkUnit[];
}

export type SemanticWorkUnit = SemanticWorkLeaf | SemanticWorkComposite;

export const SemanticWorkUnitSchema: z.ZodType<SemanticWorkUnit> = z.lazy(() => z.union([
  z.object({ ...SemanticWorkUnitCommonShape, kind: z.literal("leaf") }).strict(),
  z.object({
    ...SemanticWorkUnitCommonShape,
    kind: z.literal("composite"),
    cut: SemanticCutSchema,
    children: z.array(SemanticWorkUnitSchema).min(1)
  }).strict()
]));

export const GoalCriterionSchema = z.object({
  id: EntityIdSchema,
  description: NonEmptyStringSchema,
  required: z.boolean()
}).strict();

export type GoalCriterion = z.infer<typeof GoalCriterionSchema>;

export const SemanticSeamSchema = z.object({
  id: EntityIdSchema,
  producerUnitKey: EntityIdSchema,
  consumerUnitKeys: z.array(EntityIdSchema).min(1),
  purpose: NonEmptyStringSchema,
  /** Exact repository paths that materialize this seam. */
  paths: z.array(RepoRelativePathSchema).optional(),
  interface: z.object({
    kind: z.enum(["api", "type", "event", "data", "ui", "command"]),
    promise: NonEmptyStringSchema,
    compatibility: NonEmptyStringSchema,
    materialization: z.enum(["logical", "files", "manifest", "commit"]),
    verification: SemanticVerificationSchema
  }).strict(),
  evidenceIds: z.array(EntityIdSchema).default([])
}).strict();

export type SemanticSeam = z.infer<typeof SemanticSeamSchema>;

export const SemanticPlanDraftSchema = z.object({
  root: SemanticWorkUnitSchema,
  seams: z.array(SemanticSeamSchema).default([]),
  repositoryEvidence: z.array(RepositoryEvidenceSchema).default([]),
  uncertainties: z.array(WorkUncertaintySchema).default([]),
  questions: z.array(WorkQuestionSchema).default([])
}).strict();

export type SemanticPlanDraft = z.infer<typeof SemanticPlanDraftSchema>;

const SemanticPlanShape = {
  planId: EntityIdSchema,
  goal: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  criteria: z.array(GoalCriterionSchema).min(1),
  root: SemanticWorkUnitSchema,
  seams: z.array(SemanticSeamSchema).default([]),
  repositoryEvidence: z.array(RepositoryEvidenceSchema).default([]),
  uncertainties: z.array(WorkUncertaintySchema).default([]),
  questions: z.array(WorkQuestionSchema).default([])
};

const SemanticPlanV2Schema = z.object({ schemaVersion: z.literal(2), ...SemanticPlanShape }).strict();
const SemanticPlanV1Schema = z.object({ schemaVersion: z.literal(1), ...SemanticPlanShape }).strict();

/**
 * V1 remains parseable for audit/replay, but the productive compiler rejects
 * it unless an explicit legacy replay path is used. New plans are always V2.
 */
export const SemanticPlanSchema = z.union([SemanticPlanV2Schema, SemanticPlanV1Schema]).superRefine((plan, context) => {
  const units = flattenSemanticWorkUnits(plan.root);
  checkUnique(units.map((unit) => unit.key), "semantic unit key", context);
  checkUnique(plan.criteria.map((criterion) => criterion.id), "goal criterion id", context);
  checkUnique(plan.repositoryEvidence.map((evidence) => evidence.id), "repository evidence id", context);
  checkUnique(plan.seams.map((seam) => seam.id), "semantic seam id", context);
  const outcomes = units.flatMap((unit) => unit.outcomes.map((outcome) => ({ unit, outcome })));
  checkUnique(outcomes.map(({ outcome }) => outcome.id), "semantic outcome id", context);

  const unitKeys = new Set(units.map((unit) => unit.key));
  const criterionIds = new Set(plan.criteria.map((criterion) => criterion.id));
  const evidenceIds = new Set(plan.repositoryEvidence.map((evidence) => evidence.id));
  const pathEvidenceIds = new Set(plan.repositoryEvidence.filter((evidence) => evidence.kind === "path").map((evidence) => evidence.id));
  const outcomeCountByCriterion = new Map<string, number>();

  for (const unit of units) {
    for (const evidenceId of unit.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `semantic unit ${unit.key} references unknown evidence ${evidenceId}`);
    if (unit.kind === "leaf" && (unit.plannedPaths?.length ?? 0) === 0 && !unit.evidenceIds.some((id) => pathEvidenceIds.has(id))) {
      addIssue(context, `semantic leaf ${unit.key} must reference an existing path or declare a planned path`);
    }
    for (const outcome of unit.outcomes) {
      for (const criterionId of outcome.criterionIds) {
        if (!criterionIds.has(criterionId)) addIssue(context, `semantic outcome ${outcome.id} references unknown criterion ${criterionId}`);
        outcomeCountByCriterion.set(criterionId, (outcomeCountByCriterion.get(criterionId) ?? 0) + 1);
      }
    }
  }
  for (const criterion of plan.criteria) {
    const count = outcomeCountByCriterion.get(criterion.id) ?? 0;
    if (criterion.required && count !== 1) addIssue(context, `required criterion ${criterion.id} must be owned by exactly one semantic outcome`);
  }
  for (const seam of plan.seams) {
    if (!unitKeys.has(seam.producerUnitKey)) addIssue(context, `semantic seam ${seam.id} references unknown producer ${seam.producerUnitKey}`);
    for (const consumer of seam.consumerUnitKeys) {
      if (!unitKeys.has(consumer)) addIssue(context, `semantic seam ${seam.id} references unknown consumer ${consumer}`);
      if (consumer === seam.producerUnitKey) addIssue(context, `semantic seam ${seam.id} cannot consume its own output`);
    }
    if ((seam.interface.kind === "api" || seam.interface.kind === "type" || seam.interface.kind === "command") && seam.interface.materialization === "logical") {
      addIssue(context, `executable semantic seam ${seam.id} must materialize files, a manifest, or a commit`);
    }
    for (const evidenceId of seam.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `semantic seam ${seam.id} references unknown evidence ${evidenceId}`);
  }
  for (const item of [...plan.questions, ...plan.uncertainties]) {
    for (const evidenceId of item.evidenceIds) if (!evidenceIds.has(evidenceId)) addIssue(context, `${item.id} references unknown evidence ${evidenceId}`);
  }
});

export type SemanticPlan = z.infer<typeof SemanticPlanSchema>;

export interface CreateSemanticPlanInput {
  goal: string;
  repositorySnapshotId: string;
  criteria: GoalCriterion[];
  draft: SemanticPlanDraft;
}

export function createSemanticPlan(input: CreateSemanticPlanInput): SemanticPlan {
  const draft = SemanticPlanDraftSchema.parse(input.draft);
  const canonical = {
    schemaVersion: SEMANTIC_PLAN_SCHEMA_VERSION,
    goal: input.goal,
    repositorySnapshotId: input.repositorySnapshotId,
    criteria: input.criteria,
    root: draft.root,
    seams: draft.seams,
    repositoryEvidence: draft.repositoryEvidence,
    uncertainties: draft.uncertainties,
    questions: draft.questions
  } as const;
  const planId = `semantic-${stableHash(canonical).slice(0, 24)}`;
  return SemanticPlanSchema.parse({ planId, ...canonical });
}

export function semanticPlanHash(plan: SemanticPlan): string {
  return stableHash(SemanticPlanSchema.parse(plan));
}

export function flattenSemanticWorkUnits(root: SemanticWorkUnit): SemanticWorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenSemanticWorkUnits)];
}

export interface SemanticPlanPromptInput {
  goal: string;
  criteria: readonly GoalCriterion[];
  constraints: readonly string[];
  repositorySnapshot: { snapshotId: string; inspectionDisposition: "complete" | "partial" | "unavailable"; evidence: readonly RepositoryEvidence[] };
  granularityBrief: GranularityPlanningBrief;
  candidate: { index: number; total: number; priorPlanHashes: readonly string[] };
  questionAnswers?: Readonly<Record<string, string>>;
}

export function buildSemanticPlanPrompt(input: SemanticPlanPromptInput): { system: string; user: string } {
  const criteria = input.criteria.map((criterion) => `- ${criterion.id}: ${criterion.description}`).join("\n");
  const evidence = input.repositorySnapshot.evidence.map((item) => `- ${item.id} [${item.kind}] ${item.reference}: ${item.observation}`).join("\n");
  const constraints = input.constraints.length === 0 ? "- None supplied." : input.constraints.map((constraint) => `- ${constraint}`).join("\n");
  const answers = input.questionAnswers === undefined || Object.keys(input.questionAnswers).length === 0
    ? "- No prior answers."
    : Object.entries(input.questionAnswers).map(([id, answer]) => `- ${id}: ${answer}`).join("\n");
  return {
    system: [
      "You are the semantic Planner for a software implementation system.",
      "Return one JSON object and nothing else after any planning.node progress lines.",
      "Produce a SemanticPlan draft. Do not emit WorkBreakdown, CandidatePlan, scopes, acceptance ownership, artifact lists, seam specifications, contract obligations, or leaf validation lists.",
      "A semantic unit owns its outcomes. Every required criterion must appear in exactly one outcome. The compiler derives ownership, scopes, artifact requirements, contracts, validation obligations, conflicts, identities, and revisions.",
      "Every cross-unit dependency appears once as a seam. A seam holds producer, consumers, promise, compatibility, materialization, verification, and evidence together.",
      "An api, type, or command seam that a consumer compiles or executes against must materialize files, manifest, or commit; logical is only for non-executable facts.",
      "Use only supplied evidence ids. A leaf needs existing path evidence or a concrete planned path. Do not call tools or invent repository state.",
      "Emit planning.node lines parent-first before the final object: {\"type\":\"planning.node\",\"unit\":{\"key\":\"...\",\"parentKey\":null,\"kind\":\"composite|leaf\",\"title\":\"...\",\"objective\":\"...\",\"siblingIndex\":0,\"siblingCount\":1}}."
    ].join("\n"),
    user: [
      `Goal:\n${input.goal}`,
      `Repository snapshot: ${input.repositorySnapshot.snapshotId} (${input.repositorySnapshot.inspectionDisposition})`,
      `Required criteria:\n${criteria}`,
      `Constraints:\n${constraints}`,
      `Repository evidence:\n${evidence}`,
      `Granularity brief:\n${JSON.stringify(input.granularityBrief)}`,
      `Candidate ${input.candidate.index} of ${input.candidate.total}. Do not reproduce these prior plan hashes: ${input.candidate.priorPlanHashes.join(", ") || "none"}.`,
      `Prior answers:\n${answers}`,
      "Return this exact top-level shape: { root, seams, repositoryEvidence, uncertainties, questions }. Each unit has { key, kind, title, objective, concerns, evidenceIds, plannedPaths?, complexitySignals?, outcomes }; composites also have { cut, children }. Each outcome has { id, description, criterionIds, verification }. Each seam has { id, producerUnitKey, consumerUnitKeys, purpose, interface, evidenceIds }."
    ].join("\n\n")
  };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
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
