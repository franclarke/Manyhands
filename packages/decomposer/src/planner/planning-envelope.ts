import { createHash } from "node:crypto";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { z } from "zod";
import { WorkBreakdownSchema, type WorkBreakdown, type WorkUnit } from "./schema.js";

const NonEmptyStringSchema = z.string().trim().min(1);
const HashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const PLANNING_ENVELOPE_SCHEMA_VERSION = 1 as const;

/**
 * Deterministic constraints supplied to the semantic planner before it proposes
 * a cut. It deliberately has no unit, path, or seam fields: those are semantic
 * claims that only a candidate plan may make and the compiler must validate.
 */
export const PlanningEnvelopeSchema = z.object({
  schemaVersion: z.literal(PLANNING_ENVELOPE_SCHEMA_VERSION),
  policyVersion: NonEmptyStringSchema,
  repositorySnapshotId: NonEmptyStringSchema,
  goalDigest: NonEmptyStringSchema,
  candidateBudget: z.object({
    minimum: z.number().int().min(1),
    maximum: z.number().int().min(1).max(8)
  }).strict(),
  executionBudget: z.object({
    maxLeafContextTokens: z.number().int().positive(),
    maxLeafScopePaths: z.number().int().positive(),
    maxParallelism: z.number().int().positive()
  }).strict(),
  requirements: z.object({
    requireExplicitAcceptanceOwnership: z.literal(true),
    requireCompleteSeamSpecifications: z.literal(true),
    requireObservableLeafValidation: z.literal(true)
  }).strict()
}).strict().superRefine((envelope, context) => {
  if (envelope.candidateBudget.minimum > envelope.candidateBudget.maximum) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "candidateBudget.minimum must not exceed candidateBudget.maximum" });
  }
});

export type PlanningEnvelope = z.infer<typeof PlanningEnvelopeSchema>;

export interface CreatePlanningEnvelopeInput {
  policyVersion: string;
  goal: string;
  repositorySnapshot: Pick<RepositorySnapshot, "snapshotId">;
  maxCandidatePlans?: number;
  maxLeafContextTokens?: number;
  maxLeafScopePaths?: number;
  maxParallelism?: number;
}

export function createPlanningEnvelope(input: CreatePlanningEnvelopeInput): PlanningEnvelope {
  const maximum = input.maxCandidatePlans ?? 3;
  return PlanningEnvelopeSchema.parse({
    schemaVersion: PLANNING_ENVELOPE_SCHEMA_VERSION,
    policyVersion: input.policyVersion,
    repositorySnapshotId: input.repositorySnapshot.snapshotId,
    goalDigest: `sha256:${createHash("sha256").update(input.goal).digest("hex")}`,
    candidateBudget: { minimum: Math.min(2, maximum), maximum },
    executionBudget: {
      maxLeafContextTokens: input.maxLeafContextTokens ?? 24_000,
      maxLeafScopePaths: input.maxLeafScopePaths ?? 40,
      maxParallelism: input.maxParallelism ?? 4
    },
    requirements: {
      requireExplicitAcceptanceOwnership: true,
      requireCompleteSeamSpecifications: true,
      requireObservableLeafValidation: true
    }
  });
}

export const AcceptanceOwnershipSchema = z.object({
  intentId: NonEmptyStringSchema,
  ownerUnitKey: NonEmptyStringSchema,
  role: z.enum(["local", "seam", "global"]),
  rationale: NonEmptyStringSchema
}).strict();

export type AcceptanceOwnership = z.infer<typeof AcceptanceOwnershipSchema>;

export const AcceptanceCriterionSchema = z.object({
  intentId: NonEmptyStringSchema,
  kind: z.enum(["leafAcceptance", "seamAcceptance", "globalAcceptance"]),
  description: NonEmptyStringSchema
}).strict();

export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterionSchema>;

export const CandidateScopeSchema = z.object({
  unitKey: NonEmptyStringSchema,
  paths: z.array(NonEmptyStringSchema).min(1)
}).strict();

export type CandidateScope = z.infer<typeof CandidateScopeSchema>;

export const CandidateSeamSpecificationSchema = z.object({
  seamId: NonEmptyStringSchema,
  producerUnitKey: NonEmptyStringSchema,
  consumerUnitKeys: z.array(NonEmptyStringSchema).min(1),
  compatibility: NonEmptyStringSchema,
  materialization: z.enum(["logical", "files", "manifest", "commit"]),
  validation: NonEmptyStringSchema
}).strict();

export type CandidateSeamSpecification = z.infer<typeof CandidateSeamSpecificationSchema>;

export const ContractObligationSchema = z.object({
  obligationId: NonEmptyStringSchema,
  kind: z.enum(["cross_layer_contract", "artifact_requirement", "validation"]),
  ownerUnitKey: NonEmptyStringSchema,
  producerUnitKey: NonEmptyStringSchema,
  consumerUnitKeys: z.array(NonEmptyStringSchema).min(1),
  validation: NonEmptyStringSchema
}).strict();

export type ContractObligation = z.infer<typeof ContractObligationSchema>;

export const LeafValidationSchema = z.object({
  unitKey: NonEmptyStringSchema,
  command: NonEmptyStringSchema,
  evidenceRefs: z.array(NonEmptyStringSchema).min(1)
}).strict();

export type LeafValidation = z.infer<typeof LeafValidationSchema>;

export const CandidatePlanDraftSchema = z.object({
  candidateId: NonEmptyStringSchema,
  breakdown: WorkBreakdownSchema,
  scopes: z.array(CandidateScopeSchema).min(1),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).min(1),
  acceptanceOwnership: z.array(AcceptanceOwnershipSchema),
  seamSpecifications: z.array(CandidateSeamSpecificationSchema),
  contractObligations: z.array(ContractObligationSchema),
  leafValidations: z.array(LeafValidationSchema)
}).strict();

export type CandidatePlanDraft = z.infer<typeof CandidatePlanDraftSchema>;

const CandidatePlanContentSchema = z.object({
  ...CandidatePlanDraftSchema.shape,
  repositorySnapshotId: NonEmptyStringSchema,
  goalDigest: HashSchema
}).strict();

export const CandidatePlanSchema = z.object({
  ...CandidatePlanContentSchema.shape,
  candidateHash: HashSchema
}).strict();

export type CandidatePlan = z.infer<typeof CandidatePlanSchema>;

export interface CreateCandidatePlanInput {
  envelope: PlanningEnvelope;
  candidateId: string;
  breakdown: WorkBreakdown;
  scopes: CandidateScope[];
  acceptanceCriteria: AcceptanceCriterion[];
  acceptanceOwnership: AcceptanceOwnership[];
  seamSpecifications: CandidateSeamSpecification[];
  contractObligations: ContractObligation[];
  leafValidations: LeafValidation[];
}

export function createCandidatePlanFromDraft(envelope: PlanningEnvelope, draft: CandidatePlanDraft): CandidatePlan {
  return createCandidatePlan({ envelope, ...CandidatePlanDraftSchema.parse(draft) });
}

export function createCandidatePlan(input: CreateCandidatePlanInput): CandidatePlan {
  const envelope = PlanningEnvelopeSchema.parse(input.envelope);
  const content = CandidatePlanContentSchema.parse({
    candidateId: input.candidateId,
    repositorySnapshotId: envelope.repositorySnapshotId,
    goalDigest: envelope.goalDigest,
    breakdown: input.breakdown,
    scopes: input.scopes,
    acceptanceCriteria: input.acceptanceCriteria,
    acceptanceOwnership: input.acceptanceOwnership,
    seamSpecifications: input.seamSpecifications,
    contractObligations: input.contractObligations,
    leafValidations: input.leafValidations
  });
  return CandidatePlanSchema.parse({
    ...content,
    candidateHash: hashCandidateContent(content)
  });
}

export interface CandidatePlanDiagnostic {
  candidateId?: string;
  code:
    | "candidate_budget_not_met"
    | "candidate_not_typed"
    | "candidate_hash_mismatch"
    | "snapshot_mismatch"
    | "goal_digest_mismatch"
    | "scope_declaration_incomplete"
    | "unknown_scope_unit"
    | "acceptance_criteria_incomplete"
    | "leaf_validation_incomplete"
    | "acceptance_ownership_incomplete"
    | "unknown_acceptance_intent"
    | "unknown_acceptance_owner"
    | "duplicate_acceptance_owner"
    | "global_owner_must_integrate"
    | "local_owner_must_be_leaf"
    | "missing_seam_specification"
    | "orphan_seam_specification"
    | "leaf_without_local_acceptance";
  message: string;
  refs: string[];
}

export interface CandidatePlanSetValidation {
  validCandidates: CandidatePlan[];
  diagnostics: CandidatePlanDiagnostic[];
}

export interface CandidatePlanSetInput {
  envelope: PlanningEnvelope;
  candidates: CandidatePlan[];
}

export interface PlannerCandidateSetInput {
  envelope: PlanningEnvelope;
  candidates: readonly unknown[];
}

export interface PlannerCandidateSetValidation {
  validCandidates: CandidatePlan[];
  diagnostics: CandidatePlanDiagnostic[];
}

/**
 * Applies the fail-closed structural gates before a policy is allowed to score
 * a semantic plan. It does not score, rewrite, create, or partition plans.
 */
export function validateCandidatePlanSet(input: CandidatePlanSetInput): CandidatePlanSetValidation {
  const envelope = PlanningEnvelopeSchema.parse(input.envelope);
  const candidates = input.candidates.map((candidate) => CandidatePlanSchema.parse(candidate));
  const diagnostics: CandidatePlanDiagnostic[] = [];
  if (candidates.length < envelope.candidateBudget.minimum || candidates.length > envelope.candidateBudget.maximum) {
    diagnostics.push({
      code: "candidate_budget_not_met",
      message: `Candidate set has ${candidates.length} plans but the envelope requires ${envelope.candidateBudget.minimum}..${envelope.candidateBudget.maximum}.`,
      refs: []
    });
  }
  const validCandidates = candidates.filter((candidate) => {
    const issues = validateCandidate(envelope, candidate);
    diagnostics.push(...issues);
    return issues.length === 0;
  });
  return { validCandidates, diagnostics: sortDiagnostics(diagnostics) };
}

/**
 * Parses the planner boundary without allowing a raw WorkBreakdown to reach
 * policy scoring. Semantic ownership and seam data must be supplied by the
 * planner/compiler contract; this adapter never infers them from tree shape.
 */
export function validatePlannerCandidateSet(input: PlannerCandidateSetInput): PlannerCandidateSetValidation {
  const candidates: CandidatePlan[] = [];
  const diagnostics: CandidatePlanDiagnostic[] = [];
  for (const candidate of input.candidates) {
    const parsed = CandidatePlanSchema.safeParse(candidate);
    if (parsed.success) {
      candidates.push(parsed.data);
      continue;
    }
    const candidateId = candidateIdOf(candidate);
    diagnostics.push({
      ...(candidateId === undefined ? {} : { candidateId }),
      code: "candidate_not_typed",
      message: "Planner output is not a complete CandidatePlan with explicit ownership and seam specifications.",
      refs: parsed.error.issues.map((issue) => issue.path.join(".") || "candidate")
    });
  }
  const structural = validateCandidatePlanSet({ envelope: input.envelope, candidates });
  return {
    validCandidates: structural.validCandidates,
    diagnostics: sortDiagnostics([...diagnostics, ...structural.diagnostics])
  };
}

export type CandidatePlanSelection =
  | {
      kind: "selected";
      candidate: CandidatePlan;
      score: number;
      rejectedCandidateIds: string[];
      diagnostics: CandidatePlanDiagnostic[];
    }
  | {
      kind: "replan_required";
      diagnosis: {
        code: "acceptance_ownership_incomplete" | "no_structurally_valid_candidate";
        message: string;
        rejectedCandidateIds: string[];
        diagnostics: CandidatePlanDiagnostic[];
      };
    };

export interface SelectCandidatePlanInput extends CandidatePlanSetInput {
  score(candidate: CandidatePlan): number;
}

export interface SelectPlannerCandidateInput extends PlannerCandidateSetInput {
  score(candidate: CandidatePlan): number;
}

/** Deterministic tie-breaking makes policy replay independent of LLM order. */
export function selectCandidatePlan(input: SelectCandidatePlanInput): CandidatePlanSelection {
  const validation = validateCandidatePlanSet(input);
  const invalidIds = input.candidates
    .filter((candidate) => !validation.validCandidates.some((valid) => valid.candidateId === candidate.candidateId))
    .map((candidate) => candidate.candidateId)
    .sort();
  if (validation.validCandidates.length === 0) {
    const ownershipFailure = validation.diagnostics.some((diagnostic) => diagnostic.code === "acceptance_ownership_incomplete");
    return {
      kind: "replan_required",
      diagnosis: {
        code: ownershipFailure ? "acceptance_ownership_incomplete" : "no_structurally_valid_candidate",
        message: ownershipFailure
          ? "Every candidate lacks a complete, compatible acceptance ownership matrix."
          : "No candidate passed the structural planning gates.",
        rejectedCandidateIds: invalidIds,
        diagnostics: validation.diagnostics
      }
    };
  }
  const ranked = validation.validCandidates.map((candidate) => {
    const score = input.score(candidate);
    if (!Number.isFinite(score)) throw new TypeError(`Candidate ${candidate.candidateId} received a non-finite policy score.`);
    return { candidate, score };
  }).sort((left, right) => right.score - left.score || left.candidate.candidateId.localeCompare(right.candidate.candidateId));
  const selected = ranked[0]!;
  return {
    kind: "selected",
    candidate: selected.candidate,
    score: selected.score,
    rejectedCandidateIds: [...invalidIds, ...ranked.slice(1).map(({ candidate }) => candidate.candidateId)].sort(),
    diagnostics: validation.diagnostics
  };
}

/** Selects only candidates that crossed the typed planner boundary. */
export function selectPlannerCandidate(input: SelectPlannerCandidateInput): CandidatePlanSelection {
  const validation = validatePlannerCandidateSet(input);
  const selection = selectCandidatePlan({
    envelope: input.envelope,
    candidates: validation.validCandidates,
    score: input.score
  });
  if (selection.kind === "selected") {
    return {
      ...selection,
      diagnostics: sortDiagnostics([...validation.diagnostics, ...selection.diagnostics])
    };
  }
  return {
    ...selection,
    diagnosis: {
      ...selection.diagnosis,
      diagnostics: sortDiagnostics([...validation.diagnostics, ...selection.diagnosis.diagnostics])
    }
  };
}

function validateCandidate(envelope: PlanningEnvelope, candidate: CandidatePlan): CandidatePlanDiagnostic[] {
  const diagnostics: CandidatePlanDiagnostic[] = [];
  const { candidateHash, ...content } = candidate;
  if (hashCandidateContent(content) !== candidateHash) {
    diagnostics.push(issue(candidate, "candidate_hash_mismatch", "Candidate hash does not match its immutable planning content.", [candidate.candidateHash]));
  }
  if (candidate.breakdown.repositorySnapshotId !== envelope.repositorySnapshotId) {
    diagnostics.push({
      candidateId: candidate.candidateId,
      code: "snapshot_mismatch",
      message: "Candidate breakdown was planned against a different repository snapshot.",
      refs: [candidate.breakdown.repositorySnapshotId, envelope.repositorySnapshotId]
    });
  }
  if (candidate.repositorySnapshotId !== envelope.repositorySnapshotId) {
    diagnostics.push(issue(candidate, "snapshot_mismatch", "Candidate identity was created against a different repository snapshot.", [candidate.repositorySnapshotId, envelope.repositorySnapshotId]));
  }
  if (candidate.goalDigest !== envelope.goalDigest) {
    diagnostics.push(issue(candidate, "goal_digest_mismatch", "Candidate identity was created for a different goal digest.", [candidate.goalDigest, envelope.goalDigest]));
  }
  const units = flattenUnits(candidate.breakdown.root);
  const unitByKey = new Map(units.map((unit) => [unit.key, unit]));
  const leafKeys = new Set(units.filter((unit) => unit.kind === "leaf").map((unit) => unit.key));
  const scopeKeys = new Set<string>();
  for (const scope of candidate.scopes) {
    if (!unitByKey.has(scope.unitKey)) {
      diagnostics.push(issue(candidate, "unknown_scope_unit", `Scope references unknown unit ${scope.unitKey}.`, [scope.unitKey]));
      continue;
    }
    scopeKeys.add(scope.unitKey);
  }
  for (const leafKey of leafKeys) {
    if (!scopeKeys.has(leafKey)) diagnostics.push(issue(candidate, "scope_declaration_incomplete", `Leaf ${leafKey} has no declared scope.`, [leafKey]));
  }
  const validationByLeaf = new Map(candidate.leafValidations.map((validation) => [validation.unitKey, validation]));
  for (const leafKey of leafKeys) {
    if (!validationByLeaf.has(leafKey)) diagnostics.push(issue(candidate, "leaf_validation_incomplete", `Leaf ${leafKey} has no observable validation contract.`, [leafKey]));
  }
  for (const unitKey of validationByLeaf.keys()) {
    if (!leafKeys.has(unitKey)) diagnostics.push(issue(candidate, "leaf_validation_incomplete", `Validation contract references non-leaf unit ${unitKey}.`, [unitKey]));
  }
  const intents = new Set(candidate.breakdown.acceptanceIntents.map((intent) => intent.id));
  const criteriaByIntent = new Map<string, AcceptanceCriterion[]>();
  for (const criterion of candidate.acceptanceCriteria) {
    if (!intents.has(criterion.intentId)) {
      diagnostics.push(issue(candidate, "acceptance_criteria_incomplete", `Acceptance criterion references unknown intent ${criterion.intentId}.`, [criterion.intentId]));
      continue;
    }
    const criteria = criteriaByIntent.get(criterion.intentId) ?? [];
    criteria.push(criterion);
    criteriaByIntent.set(criterion.intentId, criteria);
  }
  for (const intent of candidate.breakdown.acceptanceIntents) {
    if ((criteriaByIntent.get(intent.id) ?? []).length !== 1) {
      diagnostics.push(issue(candidate, "acceptance_criteria_incomplete", `Acceptance intent ${intent.id} must have exactly one explicit criterion kind.`, [intent.id]));
    }
  }
  const ownershipByIntent = new Map<string, AcceptanceOwnership[]>();
  for (const ownership of candidate.acceptanceOwnership) {
    if (!intents.has(ownership.intentId)) {
      diagnostics.push(issue(candidate, "unknown_acceptance_intent", `Ownership references unknown acceptance intent ${ownership.intentId}.`, [ownership.intentId]));
      continue;
    }
    const owner = unitByKey.get(ownership.ownerUnitKey);
    if (owner === undefined) {
      diagnostics.push(issue(candidate, "unknown_acceptance_owner", `Ownership references unknown unit ${ownership.ownerUnitKey}.`, [ownership.ownerUnitKey]));
      continue;
    }
    if (ownership.role === "global" && owner.kind !== "composite") {
      diagnostics.push(issue(candidate, "global_owner_must_integrate", `Global acceptance ${ownership.intentId} must be owned by an integration composite, not ${ownership.ownerUnitKey}.`, [ownership.intentId, ownership.ownerUnitKey]));
    }
    if (ownership.role === "local" && owner.kind !== "leaf") {
      diagnostics.push(issue(candidate, "local_owner_must_be_leaf", `Local acceptance ${ownership.intentId} must be owned by a leaf, not ${ownership.ownerUnitKey}.`, [ownership.intentId, ownership.ownerUnitKey]));
    }
    const owners = ownershipByIntent.get(ownership.intentId) ?? [];
    owners.push(ownership);
    ownershipByIntent.set(ownership.intentId, owners);
  }
  for (const intent of candidate.breakdown.acceptanceIntents) {
    const owners = ownershipByIntent.get(intent.id) ?? [];
    if (owners.length === 0) {
      diagnostics.push(issue(candidate, "acceptance_ownership_incomplete", `Acceptance intent ${intent.id} has no explicit owner.`, [intent.id]));
      continue;
    }
    if (owners.filter((owner) => owner.role === "local").length > 1 || owners.filter((owner) => owner.role === "global").length > 1) {
      diagnostics.push(issue(candidate, "duplicate_acceptance_owner", `Acceptance intent ${intent.id} has incompatible owners for the same role.`, [intent.id]));
    }
  }
  for (const unit of units.filter((unit) => unit.kind === "leaf")) {
    const hasLocalAcceptance = candidate.acceptanceOwnership.some((ownership) => ownership.ownerUnitKey === unit.key && ownership.role === "local");
    if (!hasLocalAcceptance) diagnostics.push(issue(candidate, "leaf_without_local_acceptance", `Leaf ${unit.key} has no local acceptance ownership.`, [unit.key]));
  }
  const seams = new Set(candidate.breakdown.candidateSeams.map((seam) => seam.id));
  const specifications = new Map(candidate.seamSpecifications.map((specification) => [specification.seamId, specification]));
  for (const seam of candidate.breakdown.candidateSeams) {
    const specification = specifications.get(seam.id);
    if (specification === undefined) {
      diagnostics.push(issue(candidate, "missing_seam_specification", `Seam ${seam.id} has no compatibility and validation specification.`, [seam.id]));
      continue;
    }
    if (specification.producerUnitKey !== seam.producerUnitKey ||
        specification.consumerUnitKeys.join("\u0000") !== seam.consumerUnitKeys.join("\u0000")) {
      diagnostics.push(issue(candidate, "missing_seam_specification", `Seam ${seam.id} specification participants do not match the semantic seam.`, [seam.id]));
    }
  }
  for (const seamId of specifications.keys()) if (!seams.has(seamId)) diagnostics.push(issue(candidate, "orphan_seam_specification", `Seam specification ${seamId} has no candidate seam.`, [seamId]));
  return diagnostics;
}

function issue(candidate: CandidatePlan, code: CandidatePlanDiagnostic["code"], message: string, refs: string[]): CandidatePlanDiagnostic {
  return { candidateId: candidate.candidateId, code, message, refs };
}

function candidateIdOf(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("candidateId" in value)) return undefined;
  const candidateId = (value as { candidateId?: unknown }).candidateId;
  return typeof candidateId === "string" ? candidateId : undefined;
}

function hashCandidateContent(content: Omit<CandidatePlan, "candidateHash">): string {
  return `sha256:${createHash("sha256").update(stableSerialize(content)).digest("hex")}`;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value === undefined) return "undefined";
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function sortDiagnostics(diagnostics: CandidatePlanDiagnostic[]): CandidatePlanDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    (left.candidateId ?? "").localeCompare(right.candidateId ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
