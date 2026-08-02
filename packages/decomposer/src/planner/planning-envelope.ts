import { createHash } from "node:crypto";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { z } from "zod";
import { WorkBreakdownSchema, type WorkBreakdown, type WorkUnit } from "./schema.js";

const NonEmptyStringSchema = z.string().trim().min(1);

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

export const CandidateSeamSpecificationSchema = z.object({
  seamId: NonEmptyStringSchema,
  compatibility: NonEmptyStringSchema,
  validation: NonEmptyStringSchema
}).strict();

export type CandidateSeamSpecification = z.infer<typeof CandidateSeamSpecificationSchema>;

export const CandidatePlanSchema = z.object({
  candidateId: NonEmptyStringSchema,
  breakdown: WorkBreakdownSchema,
  acceptanceOwnership: z.array(AcceptanceOwnershipSchema),
  seamSpecifications: z.array(CandidateSeamSpecificationSchema)
}).strict();

export type CandidatePlan = z.infer<typeof CandidatePlanSchema>;

export interface CandidatePlanDiagnostic {
  candidateId?: string;
  code:
    | "candidate_budget_not_met"
    | "snapshot_mismatch"
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

/**
 * Applies the fail-closed structural gates before a policy is allowed to score
 * a semantic plan. It does not score, rewrite, create, or partition plans.
 */
export function validateCandidatePlanSet(input: CandidatePlanSetInput): CandidatePlanSetValidation {
  const envelope = PlanningEnvelopeSchema.parse(input.envelope);
  const candidates = input.candidates.map((candidate) => CandidatePlanSchema.parse(candidate));
  const diagnostics: CandidatePlanDiagnostic[] = [];
  if (candidates.length > envelope.candidateBudget.maximum) {
    diagnostics.push({
      code: "candidate_budget_not_met",
      message: `Candidate set has ${candidates.length} plans but the envelope permits at most ${envelope.candidateBudget.maximum}.`,
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

function validateCandidate(envelope: PlanningEnvelope, candidate: CandidatePlan): CandidatePlanDiagnostic[] {
  const diagnostics: CandidatePlanDiagnostic[] = [];
  if (candidate.breakdown.repositorySnapshotId !== envelope.repositorySnapshotId) {
    diagnostics.push({
      candidateId: candidate.candidateId,
      code: "snapshot_mismatch",
      message: "Candidate breakdown was planned against a different repository snapshot.",
      refs: [candidate.breakdown.repositorySnapshotId, envelope.repositorySnapshotId]
    });
  }
  const units = flattenUnits(candidate.breakdown.root);
  const unitByKey = new Map(units.map((unit) => [unit.key, unit]));
  const intents = new Set(candidate.breakdown.acceptanceIntents.map((intent) => intent.id));
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
  const specifications = new Set(candidate.seamSpecifications.map((specification) => specification.seamId));
  for (const seamId of seams) if (!specifications.has(seamId)) diagnostics.push(issue(candidate, "missing_seam_specification", `Seam ${seamId} has no compatibility and validation specification.`, [seamId]));
  for (const seamId of specifications) if (!seams.has(seamId)) diagnostics.push(issue(candidate, "orphan_seam_specification", `Seam specification ${seamId} has no candidate seam.`, [seamId]));
  return diagnostics;
}

function issue(candidate: CandidatePlan, code: CandidatePlanDiagnostic["code"], message: string, refs: string[]): CandidatePlanDiagnostic {
  return { candidateId: candidate.candidateId, code, message, refs };
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
