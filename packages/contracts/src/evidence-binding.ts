import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { computeCanonicalDigest, type DigestHasher } from "./canonical-json.js";
import { CanonicalDigestSchema } from "./canonical-reference.js";
import { ProofAuthoritySchema, ProofModeSchema } from "./goal-contract.js";

export const EvidenceOutcomeSchema = z.enum([
  "satisfied",
  "failed",
  "inconclusive",
  "not_run",
  "not_applicable"
]);

const ExactCandidateSchema = z.object({
  manifestDigest: CanonicalDigestSchema,
  commitOid: NonEmptyStringSchema,
  treeOid: NonEmptyStringSchema
}).strict();

export const EvidenceBindingMaterialSchema = z.object({
  id: EntityIdSchema,
  revision: z.number().int().positive(),
  goalContractDigest: CanonicalDigestSchema,
  criterionId: EntityIdSchema,
  obligationId: EntityIdSchema,
  candidate: ExactCandidateSchema,
  proofStrategyDigest: CanonicalDigestSchema,
  mode: ProofModeSchema,
  authority: ProofAuthoritySchema,
  recipeDigest: CanonicalDigestSchema,
  environmentDigest: CanonicalDigestSchema,
  selectorDigest: CanonicalDigestSchema,
  outputDigest: CanonicalDigestSchema,
  outcome: EvidenceOutcomeSchema
}).strict();

export const EvidenceBindingSchema = EvidenceBindingMaterialSchema.extend({ digest: CanonicalDigestSchema }).strict();
export type EvidenceBindingMaterial = z.infer<typeof EvidenceBindingMaterialSchema>;
export type EvidenceBinding = z.infer<typeof EvidenceBindingSchema>;

export function buildEvidenceBinding(input: EvidenceBindingMaterial, hasher: DigestHasher): EvidenceBinding {
  const material = EvidenceBindingMaterialSchema.parse(input);
  return { ...material, digest: computeCanonicalDigest(material, hasher) };
}

export interface EvidenceFreshnessExpectation {
  goalContractDigest: string;
  criterionId: string;
  obligationId: string;
  mode: z.infer<typeof ProofModeSchema>;
  authority: z.infer<typeof ProofAuthoritySchema>;
  candidate: z.infer<typeof ExactCandidateSchema>;
  proofStrategyDigest: string;
  recipeDigest: string;
  environmentDigest: string;
  selectorDigest: string;
  outputDigest: string;
}

export type EvidenceFreshnessIssueCode =
  | "schema_invalid"
  | "evidence_digest_mismatch"
  | "stale_contract_binding"
  | "stale_proof_pair"
  | "stale_candidate_tree"
  | "stale_proof_strategy"
  | "stale_recipe"
  | "stale_environment"
  | "stale_selector"
  | "stale_output";

export interface EvidenceFreshnessIssue { code: EvidenceFreshnessIssueCode; message: string; }
export interface EvidenceFreshnessResult { ok: boolean; issues: EvidenceFreshnessIssue[]; }

export function validateEvidenceFreshness(
  input: unknown,
  expected: EvidenceFreshnessExpectation,
  hasher: DigestHasher
): EvidenceFreshnessResult {
  const parsed = EvidenceBindingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, issues: [{ code: "schema_invalid", message: "evidence binding does not match the canonical schema" }] };
  }
  const evidence = parsed.data;
  const issues: EvidenceFreshnessIssue[] = [];
  const { digest, ...material } = evidence;
  if (computeCanonicalDigest(material, hasher) !== digest) {
    issues.push({
      code: "evidence_digest_mismatch",
      message: "evidence digest does not identify the canonical immutable binding material"
    });
  }
  if (
    evidence.goalContractDigest !== expected.goalContractDigest ||
    evidence.criterionId !== expected.criterionId ||
    evidence.obligationId !== expected.obligationId
  ) {
    issues.push({ code: "stale_contract_binding", message: "evidence is bound to a different goal criterion or obligation" });
  }
  if (evidence.mode !== expected.mode || evidence.authority !== expected.authority) {
    issues.push({ code: "stale_proof_pair", message: "evidence proof mode/authority differs from the expected strategy" });
  }
  if (
    evidence.candidate.manifestDigest !== expected.candidate.manifestDigest ||
    evidence.candidate.commitOid !== expected.candidate.commitOid ||
    evidence.candidate.treeOid !== expected.candidate.treeOid
  ) {
    issues.push({ code: "stale_candidate_tree", message: "evidence was observed on a different candidate manifest/commit/tree" });
  }
  compareDigest(issues, "stale_proof_strategy", "proof strategy", evidence.proofStrategyDigest, expected.proofStrategyDigest);
  compareDigest(issues, "stale_recipe", "recipe", evidence.recipeDigest, expected.recipeDigest);
  compareDigest(issues, "stale_environment", "environment", evidence.environmentDigest, expected.environmentDigest);
  compareDigest(issues, "stale_selector", "selector", evidence.selectorDigest, expected.selectorDigest);
  compareDigest(issues, "stale_output", "output", evidence.outputDigest, expected.outputDigest);
  return { ok: issues.length === 0, issues };
}

function compareDigest(
  issues: EvidenceFreshnessIssue[],
  code: EvidenceFreshnessIssueCode,
  label: string,
  actual: string,
  expected: string
): void {
  if (actual !== expected) issues.push({ code, message: `evidence ${label} digest is stale` });
}
