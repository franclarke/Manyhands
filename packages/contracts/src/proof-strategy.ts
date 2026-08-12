import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";
import {
  GoalContractSchema,
  ProofAuthoritySchema,
  ProofIndependenceSchema,
  ProofModeSchema,
  proofPairKey,
  type GoalContract
} from "./goal-contract.js";

export const ProofStrategyMaterialSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  goalContractDigest: CanonicalDigestSchema,
  criterionId: EntityIdSchema,
  obligationId: EntityIdSchema,
  mode: ProofModeSchema,
  authority: ProofAuthoritySchema,
  repositoryViewDigest: CanonicalDigestSchema,
  procedureRef: NonEmptyStringSchema,
  selectorDigest: CanonicalDigestSchema.optional(),
  environmentPolicyDigest: CanonicalDigestSchema,
  independence: ProofIndependenceSchema
}).strict();

export const ProofStrategySchema = ProofStrategyMaterialSchema.extend({ digest: CanonicalDigestSchema }).strict();
export type ProofStrategyMaterial = z.infer<typeof ProofStrategyMaterialSchema>;
export type ProofStrategy = z.infer<typeof ProofStrategySchema>;

export function buildProofStrategy(input: ProofStrategyMaterial, hasher: DigestHasher): ProofStrategy {
  const material = ProofStrategyMaterialSchema.parse(input);
  return { ...material, digest: computeCanonicalDigest(material, hasher) };
}

export type ProofValidationIssueCode =
  | "schema_invalid"
  | "goal_digest_mismatch"
  | "unknown_criterion"
  | "proof_pair_not_allowed"
  | "independence_mismatch"
  | "required_criterion_uncovered";

export interface ProofValidationIssue {
  code: ProofValidationIssueCode;
  message: string;
  criterionId?: string;
  strategyId?: string;
}

export interface ProofValidationResult {
  ok: boolean;
  issues: ProofValidationIssue[];
}

export function validateProofStrategy(goalInput: GoalContract, strategyInput: ProofStrategy): ProofValidationResult {
  const goal = GoalContractSchema.safeParse(goalInput);
  const strategy = ProofStrategySchema.safeParse(strategyInput);
  const issues: ProofValidationIssue[] = [];
  if (!goal.success) {
    return { ok: false, issues: goal.error.issues.map((item) => ({ code: "schema_invalid", message: `goal.${item.path.join(".")}: ${item.message}` })) };
  }
  if (!strategy.success) {
    return { ok: false, issues: strategy.error.issues.map((item) => ({ code: "schema_invalid", message: `strategy.${item.path.join(".")}: ${item.message}` })) };
  }

  const candidate = strategy.data;
  if (candidate.goalContractDigest !== goal.data.digest) {
    issues.push({
      code: "goal_digest_mismatch",
      strategyId: candidate.id,
      criterionId: candidate.criterionId,
      message: "proof strategy is bound to a different GoalContract digest"
    });
  }
  const criterion = goal.data.acceptanceCriteria.find((item) => item.id === candidate.criterionId);
  if (criterion === undefined) {
    issues.push({
      code: "unknown_criterion",
      strategyId: candidate.id,
      criterionId: candidate.criterionId,
      message: `proof strategy references unknown criterion ${candidate.criterionId}`
    });
    return { ok: false, issues };
  }
  const candidatePair = proofPairKey(candidate);
  if (!criterion.verification.allowedProofs.some((allowed) => proofPairKey(allowed) === candidatePair)) {
    issues.push({
      code: "proof_pair_not_allowed",
      strategyId: candidate.id,
      criterionId: candidate.criterionId,
      message: `${candidate.mode}/${candidate.authority} is not accepted by the criterion`
    });
  }
  if (candidate.independence !== criterion.verification.independence) {
    issues.push({
      code: "independence_mismatch",
      strategyId: candidate.id,
      criterionId: candidate.criterionId,
      message: `proof independence ${candidate.independence} does not match ${criterion.verification.independence}`
    });
  }
  return { ok: issues.length === 0, issues };
}

export function validateProofCoverage(goal: GoalContract, strategies: readonly ProofStrategy[]): ProofValidationResult {
  const issues: ProofValidationIssue[] = [];
  const validCriterionIds = new Set<string>();
  for (const strategy of strategies) {
    const result = validateProofStrategy(goal, strategy);
    issues.push(...result.issues);
    if (result.ok) validCriterionIds.add(strategy.criterionId);
  }
  for (const criterion of goal.acceptanceCriteria) {
    if (criterion.required && !validCriterionIds.has(criterion.id)) {
      issues.push({
        code: "required_criterion_uncovered",
        criterionId: criterion.id,
        message: `required criterion ${criterion.id} has no valid ProofStrategy`
      });
    }
  }
  return { ok: issues.length === 0, issues };
}
