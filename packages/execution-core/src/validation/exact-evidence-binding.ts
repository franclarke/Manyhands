import { createHash } from "node:crypto";
import {
  buildEvidenceBinding,
  type CanonicalValidationObligation,
  type CandidateTreeManifest,
  type DigestHasher,
  type EvidenceBinding,
  type GoalContract,
  type ProofStrategy
} from "@manyhands/contracts";
import type { CriterionEvidenceObservation } from "@manyhands/shared";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

interface ExactEvidenceMatrix {
  matrixId: string;
  candidateCommit: string;
  validationRecipeDigest?: string;
  criteria: Array<{
    criterionId: string;
    obligationId: string;
    status: "satisfied" | "failed" | "uncovered" | "flaky" | "not_applicable";
  }>;
  observations: CriterionEvidenceObservation[];
}

/** Turns raw observations into immutable proof records for one retained candidate. */
export function bindExactEvidence(input: {
  goal: GoalContract;
  candidate: CandidateTreeManifest;
  baseline: { commitOid: string; treeOid: string };
  validationObligations: Readonly<Record<string, CanonicalValidationObligation>>;
  proofStrategies: Readonly<Record<string, ProofStrategy>>;
  matrix: ExactEvidenceMatrix;
}, hasher: DigestHasher = sha256): EvidenceBinding[] {
  if (input.matrix.candidateCommit !== input.candidate.commitOid) {
    throw new Error(`Evidence matrix ${input.matrix.matrixId} does not identify retained candidate ${input.candidate.commitOid}.`);
  }
  const recipeDigest = input.matrix.validationRecipeDigest;
  if (recipeDigest === undefined) {
    throw new Error(`Evidence matrix ${input.matrix.matrixId} has no exact validation recipe digest.`);
  }
  return input.matrix.criteria.map((criterion) => {
    const obligation = input.validationObligations[criterion.obligationId];
    if (obligation === undefined) throw new Error(`Evidence criterion ${criterion.obligationId} has no canonical validation obligation.`);
    const strategy = input.proofStrategies[obligation.proofStrategy.id];
    if (
      strategy === undefined ||
      strategy.revision !== obligation.proofStrategy.revision ||
      strategy.digest !== obligation.proofStrategy.digest ||
      strategy.goalContractDigest !== input.goal.digest ||
      strategy.criterionId !== obligation.criterionId ||
      strategy.obligationId !== criterion.obligationId
    ) {
      throw new Error(`Evidence criterion ${criterion.obligationId} has no matching immutable ProofStrategy.`);
    }
    if (strategy.selectorDigest === undefined) {
      throw new Error(`ProofStrategy ${strategy.id} has no selector digest for exact evidence.`);
    }
    const observation = input.matrix.observations.find((candidate) =>
      candidate.criterionIds.includes(criterion.criterionId)
      && candidate.obligationIds.includes(criterion.obligationId)
    );
    if (observation === undefined) {
      throw new Error(`Evidence criterion ${criterion.obligationId} has no exact command observation.`);
    }
    const selectorDigest = digestSelectors(observation.references);
    if (strategy.selectorDigest !== selectorDigest) {
      throw new Error(`ProofStrategy ${strategy.id} selector digest does not match the executed evidence references.`);
    }
    return buildEvidenceBinding({
      id: `evidence:${input.matrix.matrixId}:${criterion.obligationId}`,
      revision: 1,
      goalContractDigest: input.goal.digest,
      criterionId: strategy.criterionId,
      obligationId: criterion.obligationId,
      candidate: {
        manifestDigest: input.candidate.manifestDigest,
        commitOid: input.candidate.commitOid,
        treeOid: input.candidate.treeOid
      },
      baseline: { ...input.baseline },
      proofStrategyDigest: strategy.digest,
      mode: strategy.mode,
      authority: strategy.authority,
      recipeDigest,
      environmentDigest: strategy.environmentPolicyDigest,
      selectorDigest,
      outputDigest: canonicalOutputDigest(observation.outputDigest),
      outcome: evidenceOutcome(criterion.status)
    }, hasher);
  });
}

function evidenceOutcome(status: ExactEvidenceMatrix["criteria"][number]["status"]): EvidenceBinding["outcome"] {
  if (status === "satisfied" || status === "failed" || status === "not_applicable") return status;
  return "inconclusive";
}

function canonicalOutputDigest(value: string): string {
  if (value.startsWith("sha256:")) return value;
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error("Evidence observation outputDigest must be a SHA-256 digest.");
  return `sha256:${value}`;
}

function digestSelectors(references: readonly string[]): string {
  return `sha256:${createHash("sha256").update(JSON.stringify([...references].sort())).digest("hex")}`;
}
