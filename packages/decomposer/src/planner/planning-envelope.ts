import { createHash } from "node:crypto";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { z } from "zod";
import {
  AcceptanceOwnershipSchema,
  CandidateSeamSpecificationSchema,
  WorkBreakdownSchema,
  type AcceptanceOwnership,
  type CandidateSeamSpecification,
  type WorkUnit
} from "./schema.js";

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
    maxLeafPlannedPaths: z.number().int().positive(),
    maxParallelism: z.number().int().positive()
  }).strict(),
  requirements: z.object({
    requireExplicitAcceptanceOwnership: z.literal(true),
    requireCompleteSeamSpecifications: z.literal(true),
    requireObservableLeafValidation: z.literal(true),
    requireCrossLeafMaterialization: z.literal(true),
    requireCompilerApproval: z.literal(true)
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
  maxLeafPlannedPaths?: number;
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
      maxLeafPlannedPaths: input.maxLeafPlannedPaths ?? 12,
      maxParallelism: input.maxParallelism ?? 4
    },
    requirements: {
      requireExplicitAcceptanceOwnership: true,
      requireCompleteSeamSpecifications: true,
      requireObservableLeafValidation: true,
      requireCrossLeafMaterialization: true,
      requireCompilerApproval: true
    }
  });
}

export {
  AcceptanceOwnershipSchema,
  CandidateSeamSpecificationSchema
};
export type {
  AcceptanceOwnership,
  CandidateSeamSpecification
};

export const CandidatePlanSchema = z.object({
  candidateId: NonEmptyStringSchema,
  breakdown: WorkBreakdownSchema
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
    | "acceptance_owner_missing_intent"
    | "duplicate_acceptance_owner"
    | "global_owner_must_integrate"
    | "global_acceptance_leaked_to_leaf"
    | "local_owner_must_be_leaf"
    | "missing_seam_specification"
    | "orphan_seam_specification"
    | "missing_materialized_seam_artifact"
    | "unknown_acceptance_seam"
    | "seam_owner_must_be_lca"
    | "compiler_rejected"
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
  const candidateBudgetMet = candidates.length >= envelope.candidateBudget.minimum &&
    candidates.length <= envelope.candidateBudget.maximum;
  if (!candidateBudgetMet) {
    diagnostics.push({
      code: "candidate_budget_not_met",
      message: `Candidate set has ${candidates.length} plans but the envelope requires ${envelope.candidateBudget.minimum}-${envelope.candidateBudget.maximum}.`,
      refs: []
    });
  }
  const structurallyValidCandidates = candidates.filter((candidate) => {
    const issues = validateCandidate(envelope, candidate);
    diagnostics.push(...issues);
    return issues.length === 0;
  });
  const validCandidates = candidateBudgetMet ? structurallyValidCandidates : [];
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
  compilerResults?: Record<string, {
    approvable: boolean;
    diagnostics: string[];
  }>;
  score(candidate: CandidatePlan): number;
}

/** Deterministic tie-breaking makes policy replay independent of LLM order. */
export function selectCandidatePlan(input: SelectCandidatePlanInput): CandidatePlanSelection {
  const validation = validateCandidatePlanSet(input);
  const compilerDiagnostics: CandidatePlanDiagnostic[] = [];
  const eligibleCandidates = validation.validCandidates.filter((candidate) => {
    const result = input.compilerResults?.[candidate.candidateId];
    if (result === undefined || result.approvable) return true;
    compilerDiagnostics.push(issue(
      candidate,
      "compiler_rejected",
      `Graph Compiler rejected candidate ${candidate.candidateId}: ${result.diagnostics.join("; ") || "no diagnostic supplied"}.`,
      result.diagnostics
    ));
    return false;
  });
  const diagnostics = sortDiagnostics([...validation.diagnostics, ...compilerDiagnostics]);
  const invalidIds = input.candidates
    .filter((candidate) => !eligibleCandidates.some((valid) => valid.candidateId === candidate.candidateId))
    .map((candidate) => candidate.candidateId)
    .sort();
  if (eligibleCandidates.length === 0) {
    const ownershipFailure = diagnostics.some((diagnostic) => diagnostic.code === "acceptance_ownership_incomplete");
    return {
      kind: "replan_required",
      diagnosis: {
        code: ownershipFailure ? "acceptance_ownership_incomplete" : "no_structurally_valid_candidate",
        message: ownershipFailure
          ? "Every candidate lacks a complete, compatible acceptance ownership matrix."
          : "No candidate passed the structural planning gates.",
        rejectedCandidateIds: invalidIds,
        diagnostics
      }
    };
  }
  const ranked = eligibleCandidates.map((candidate) => {
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
    diagnostics
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
  const parentByKey = parentMap(candidate.breakdown.root);
  const intents = new Set(candidate.breakdown.acceptanceIntents.map((intent) => intent.id));
  const seamsById = new Map(candidate.breakdown.candidateSeams.map((seam) => [seam.id, seam]));
  const specificationBySeamId = new Map(
    (candidate.breakdown.seamSpecifications ?? []).map((specification) => [specification.seamId, specification])
  );
  const ownershipByIntent = new Map<string, AcceptanceOwnership[]>();
  const acceptanceOwnership = candidate.breakdown.acceptanceOwnership ?? [];
  for (const ownership of acceptanceOwnership) {
    if (!intents.has(ownership.intentId)) {
      diagnostics.push(issue(candidate, "unknown_acceptance_intent", `Ownership references unknown acceptance intent ${ownership.intentId}.`, [ownership.intentId]));
      continue;
    }
    const owner = unitByKey.get(ownership.ownerUnitKey);
    if (owner === undefined) {
      diagnostics.push(issue(candidate, "unknown_acceptance_owner", `Ownership references unknown unit ${ownership.ownerUnitKey}.`, [ownership.ownerUnitKey]));
      continue;
    }
    if (!owner.acceptanceIntentIds.includes(ownership.intentId)) {
      diagnostics.push(issue(
        candidate,
        "acceptance_owner_missing_intent",
        `Acceptance owner ${ownership.ownerUnitKey} does not declare intent ${ownership.intentId}.`,
        [ownership.intentId, ownership.ownerUnitKey]
      ));
    }
    if (ownership.role === "seam") {
      const seam = ownership.seamId === undefined ? undefined : seamsById.get(ownership.seamId);
      if (seam === undefined) {
        diagnostics.push(issue(
          candidate,
          "unknown_acceptance_seam",
          `Seam ownership for ${ownership.intentId} references unknown seam ${ownership.seamId ?? "unknown"}.`,
          [ownership.intentId, ownership.seamId ?? "unknown"]
        ));
      } else {
        const expectedOwner = lowestCommonAncestor(
          [seam.producerUnitKey, ...seam.consumerUnitKeys],
          parentByKey,
          candidate.breakdown.root.key
        );
        if (ownership.ownerUnitKey !== expectedOwner) {
          diagnostics.push(issue(
            candidate,
            "seam_owner_must_be_lca",
            `Seam ${seam.id} must be owned by lowest common ancestor ${expectedOwner}, not ${ownership.ownerUnitKey}.`,
            [seam.id, expectedOwner]
          ));
        }
      }
    }
    if (ownership.role === "global" && owner.kind !== "composite") {
      diagnostics.push(issue(candidate, "global_owner_must_integrate", `Global acceptance ${ownership.intentId} must be owned by an integration composite, not ${ownership.ownerUnitKey}.`, [ownership.intentId, ownership.ownerUnitKey]));
    }
    if (ownership.role === "global" && owner.kind === "composite") {
      const leakingLeaves = units.filter((unit) =>
        unit.kind === "leaf" &&
        isAncestor(ownership.ownerUnitKey, unit.key, parentByKey) &&
        unit.acceptanceIntentIds.includes(ownership.intentId)
      );
      for (const leaf of leakingLeaves) {
        diagnostics.push(issue(
          candidate,
          "global_acceptance_leaked_to_leaf",
          `Global acceptance ${ownership.intentId} is duplicated into descendant leaf ${leaf.key}.`,
          [ownership.intentId, leaf.key]
        ));
      }
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
    if (owners.length > 1) {
      diagnostics.push(issue(candidate, "duplicate_acceptance_owner", `Acceptance intent ${intent.id} must have exactly one explicit owner.`, [intent.id]));
    }
  }
  for (const unit of units.filter((unit) => unit.kind === "leaf")) {
    const hasLocalAcceptance = acceptanceOwnership.some((ownership) => ownership.ownerUnitKey === unit.key && ownership.role === "local");
    if (!hasLocalAcceptance) diagnostics.push(issue(candidate, "leaf_without_local_acceptance", `Leaf ${unit.key} has no local acceptance ownership.`, [unit.key]));
  }
  const seams = new Set(seamsById.keys());
  const specifications = new Set(specificationBySeamId.keys());
  for (const seamId of seams) if (!specifications.has(seamId)) diagnostics.push(issue(candidate, "missing_seam_specification", `Seam ${seamId} has no compatibility and validation specification.`, [seamId]));
  for (const seamId of specifications) if (!seams.has(seamId)) diagnostics.push(issue(candidate, "orphan_seam_specification", `Seam specification ${seamId} has no candidate seam.`, [seamId]));
  for (const seam of candidate.breakdown.candidateSeams) {
    if (specificationBySeamId.get(seam.id)?.delivery !== "producer_files") continue;
    const missingConsumers = seam.consumerUnitKeys.filter((consumerUnitKey) =>
      !candidate.breakdown.candidateArtifacts.some((artifact) =>
        artifact.producerUnitKey === seam.producerUnitKey &&
        artifact.consumerUnitKeys.includes(consumerUnitKey) &&
        artifact.materializationHint !== "logical"
      )
    );
    if (missingConsumers.length > 0) {
      diagnostics.push(issue(
        candidate,
        "missing_materialized_seam_artifact",
        `Seam ${seam.id} requires producer files but has no materialized artifact for ${missingConsumers.join(", ")}.`,
        [seam.id, ...missingConsumers]
      ));
    }
  }
  return diagnostics;
}

function issue(candidate: CandidatePlan, code: CandidatePlanDiagnostic["code"], message: string, refs: string[]): CandidatePlanDiagnostic {
  return { candidateId: candidate.candidateId, code, message, refs };
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}

function parentMap(root: WorkUnit): Map<string, string> {
  const output = new Map<string, string>();
  const visit = (unit: WorkUnit): void => {
    if (unit.kind === "leaf") return;
    for (const child of unit.children) {
      output.set(child.key, unit.key);
      visit(child);
    }
  };
  visit(root);
  return output;
}

function lowestCommonAncestor(
  unitKeys: readonly string[],
  parentByKey: ReadonlyMap<string, string>,
  rootKey: string
): string {
  const firstChain = ancestorChain(unitKeys[0] ?? rootKey, parentByKey);
  const chains = unitKeys.map((key) => new Set(ancestorChain(key, parentByKey)));
  return firstChain.find((candidate) => chains.every((chain) => chain.has(candidate))) ?? rootKey;
}

function ancestorChain(unitKey: string, parentByKey: ReadonlyMap<string, string>): string[] {
  const chain: string[] = [];
  let current: string | undefined = unitKey;
  while (current !== undefined) {
    chain.push(current);
    current = parentByKey.get(current);
  }
  return chain;
}

function isAncestor(
  ancestorKey: string,
  descendantKey: string,
  parentByKey: ReadonlyMap<string, string>
): boolean {
  let candidate = parentByKey.get(descendantKey);
  while (candidate !== undefined) {
    if (candidate === ancestorKey) return true;
    candidate = parentByKey.get(candidate);
  }
  return false;
}

function sortDiagnostics(diagnostics: CandidatePlanDiagnostic[]): CandidatePlanDiagnostic[] {
  return [...diagnostics].sort((left, right) =>
    (left.candidateId ?? "").localeCompare(right.candidateId ?? "") ||
    left.code.localeCompare(right.code) ||
    left.message.localeCompare(right.message)
  );
}
