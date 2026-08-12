import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, sortedUniqueStrings, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";

export const ProofModeSchema = z.enum([
  "executable",
  "static",
  "external_oracle",
  "human_review",
  "observational"
]);
export type ProofMode = z.infer<typeof ProofModeSchema>;

export const ProofAuthoritySchema = z.enum([
  "orchestrator_deterministic",
  "protected_external_oracle",
  "operator"
]);
export type ProofAuthority = z.infer<typeof ProofAuthoritySchema>;

export const ProofIndependenceSchema = z.enum([
  "independent_required",
  "protected_baseline_or_negative_control",
  "human_authority",
  "not_applicable"
]);
export type ProofIndependence = z.infer<typeof ProofIndependenceSchema>;

export const AllowedProofSchema = z.object({
  mode: ProofModeSchema,
  authority: ProofAuthoritySchema
}).strict();
export type AllowedProof = z.infer<typeof AllowedProofSchema>;

export const VerificationPolicySchema = z.object({
  allowedProofs: z.array(AllowedProofSchema).min(1),
  independence: ProofIndependenceSchema
}).strict();
export type VerificationPolicy = z.infer<typeof VerificationPolicySchema>;

export const GoalAcceptanceCriterionSchema = z.object({
  id: EntityIdSchema,
  statement: NonEmptyStringSchema,
  required: z.boolean(),
  level: z.enum(["product", "quality", "constraint"]),
  protectedReferences: z.array(NonEmptyStringSchema).default([]),
  verification: VerificationPolicySchema
}).strict();

export const GoalContractMaterialSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  goal: NonEmptyStringSchema,
  acceptanceCriteria: z.array(GoalAcceptanceCriterionSchema).min(1),
  constraints: z.array(NonEmptyStringSchema).default([]),
  qualityAttributes: z.array(z.object({
    kind: z.enum(["security", "accessibility", "performance", "compatibility", "maintainability", "operability"]),
    statement: NonEmptyStringSchema
  }).strict()).default([]),
  target: z.object({
    repositoryId: EntityIdSchema,
    baseCommit: NonEmptyStringSchema,
    treeSha: NonEmptyStringSchema
  }).strict()
}).strict();

export const GoalContractSchema = GoalContractMaterialSchema.extend({
  digest: CanonicalDigestSchema
}).strict();

export type GoalContractMaterial = z.infer<typeof GoalContractMaterialSchema>;
export type GoalContract = z.infer<typeof GoalContractSchema>;

export function buildGoalContract(input: GoalContractMaterial, hasher: DigestHasher): GoalContract {
  const parsed = GoalContractMaterialSchema.parse(input);
  const material: GoalContractMaterial = {
    ...parsed,
    constraints: sortedUniqueStrings(parsed.constraints),
    acceptanceCriteria: parsed.acceptanceCriteria.map((criterion) => ({
      ...criterion,
      protectedReferences: sortedUniqueStrings(criterion.protectedReferences),
      verification: {
        ...criterion.verification,
        allowedProofs: uniqueProofPairs(criterion.verification.allowedProofs)
      }
    }))
  };
  return { ...material, digest: computeCanonicalDigest(material, hasher) };
}

export type GoalContractIssueCode =
  | "schema_invalid"
  | "duplicate_criterion"
  | "duplicate_proof_pair"
  | "unsupported_proof_pair";

export interface GoalContractIssue {
  code: GoalContractIssueCode;
  message: string;
  criterionId?: string;
}

export interface GoalContractValidationResult {
  ok: boolean;
  issues: GoalContractIssue[];
}

export function validateGoalContract(input: unknown): GoalContractValidationResult {
  const parsed = GoalContractSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        code: "schema_invalid",
        message: `${issue.path.join(".")}: ${issue.message}`
      }))
    };
  }

  const issues: GoalContractIssue[] = [];
  const criterionIds = new Set<string>();
  for (const criterion of parsed.data.acceptanceCriteria) {
    if (criterionIds.has(criterion.id)) {
      issues.push({ code: "duplicate_criterion", criterionId: criterion.id, message: `criterion ${criterion.id} is repeated` });
    }
    criterionIds.add(criterion.id);
    const proofPairs = new Set<string>();
    for (const proof of criterion.verification.allowedProofs) {
      const key = proofPairKey(proof);
      if (proofPairs.has(key)) {
        issues.push({ code: "duplicate_proof_pair", criterionId: criterion.id, message: `proof pair ${key} is repeated` });
      }
      proofPairs.add(key);
      if (!SUPPORTED_PROOF_PAIRS.has(key)) {
        issues.push({
          code: "unsupported_proof_pair",
          criterionId: criterion.id,
          message: `${proof.mode}/${proof.authority} is not a grounded proof pair`
        });
      }
    }
  }
  return { ok: issues.length === 0, issues };
}

export const SUPPORTED_PROOF_PAIRS: ReadonlySet<string> = new Set([
  "executable\0orchestrator_deterministic",
  "static\0orchestrator_deterministic",
  "external_oracle\0protected_external_oracle",
  "human_review\0operator",
  "observational\0orchestrator_deterministic",
  "observational\0operator"
]);

export function proofPairKey(proof: AllowedProof): string {
  return `${proof.mode}\0${proof.authority}`;
}

function uniqueProofPairs(proofs: readonly AllowedProof[]): AllowedProof[] {
  const keyed = new Map(proofs.map((proof) => [proofPairKey(proof), proof]));
  return [...keyed.values()].sort((left, right) =>
    `${left.mode}\0${left.authority}`.localeCompare(`${right.mode}\0${right.authority}`)
  );
}
