import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CanonicalValidationObligationSchema,
  buildGoalContract,
  buildProofStrategy,
  validateGoalContract,
  validateProofCoverage,
  validateProofStrategy,
  type DigestHasher
} from "@manyhands/contracts";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("canonical proof authority", () => {
  it("rejects a globally ungrounded proof mode/authority pair with an explicit cause", () => {
    const goal = buildGoalContract(goalMaterial(), sha256);
    const invalid = {
      ...goal,
      acceptanceCriteria: [{
        ...goal.acceptanceCriteria[0]!,
        verification: {
          ...goal.acceptanceCriteria[0]!.verification,
          allowedProofs: [{ mode: "executable" as const, authority: "operator" as const }]
        }
      }]
    };

    expect(validateGoalContract(invalid)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "unsupported_proof_pair", criterionId: "criterion:booking" })]
    });
  });

  it("requires exact goal digest, criterion, proof pair and independence", () => {
    const goal = buildGoalContract(goalMaterial(), sha256);
    const valid = buildProofStrategy(strategyMaterial(goal.digest), sha256);
    expect(validateProofStrategy(goal, valid)).toEqual({ ok: true, issues: [] });

    expect(validateProofStrategy(goal, { ...valid, goalContractDigest: "sha256:other" }).issues)
      .toContainEqual(expect.objectContaining({ code: "goal_digest_mismatch" }));
    expect(validateProofStrategy(goal, { ...valid, authority: "operator" }).issues)
      .toContainEqual(expect.objectContaining({ code: "proof_pair_not_allowed" }));
    expect(validateProofStrategy(goal, { ...valid, independence: "not_applicable" }).issues)
      .toContainEqual(expect.objectContaining({ code: "independence_mismatch" }));
    expect(validateProofStrategy(goal, { ...valid, criterionId: "criterion:missing" }).issues)
      .toContainEqual(expect.objectContaining({ code: "unknown_criterion" }));
  });

  it("reports every uncovered required criterion and ignores optional criteria", () => {
    const goal = buildGoalContract({
      ...goalMaterial(),
      acceptanceCriteria: [
        ...goalMaterial().acceptanceCriteria,
        {
          id: "criterion:optional",
          statement: "Optional operator review",
          required: false,
          level: "quality" as const,
          protectedReferences: [],
          verification: {
            allowedProofs: [{ mode: "human_review" as const, authority: "operator" as const }],
            independence: "human_authority" as const
          }
        }
      ]
    }, sha256);

    expect(validateProofCoverage(goal, [])).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "required_criterion_uncovered", criterionId: "criterion:booking" })]
    });
    const strategy = buildProofStrategy(strategyMaterial(goal.digest), sha256);
    expect(validateProofCoverage(goal, [strategy])).toEqual({ ok: true, issues: [] });
  });

  it("keeps canonical validation obligations separate from evidence observations", () => {
    const obligation = {
      id: "obligation:booking",
      revision: 1,
      digest: "sha256:obligation",
      criterionId: "criterion:booking",
      ownerNodeId: "node:booking",
      required: true,
      proofStrategy: { id: "proof:booking", revision: 1, digest: "sha256:proof" }
    };
    expect(CanonicalValidationObligationSchema.safeParse(obligation).success).toBe(true);
    expect(CanonicalValidationObligationSchema.safeParse({ ...obligation, evidence: { outcome: "satisfied" } }).success).toBe(false);
  });
});

function goalMaterial() {
  return {
    id: "goal:booking",
    revision: 1,
    goal: "Implement reliable booking",
    acceptanceCriteria: [{
      id: "criterion:booking",
      statement: "A slot can be booked exactly once",
      required: true,
      level: "product" as const,
      protectedReferences: ["tests/protected/booking-oracle.ts"],
      verification: {
        allowedProofs: [{ mode: "executable" as const, authority: "orchestrator_deterministic" as const }],
        independence: "independent_required" as const
      }
    }],
    constraints: [],
    qualityAttributes: [],
    target: { repositoryId: "repo:manyhands", baseCommit: "a".repeat(40), treeSha: "b".repeat(40) }
  };
}

function strategyMaterial(goalContractDigest: string) {
  return {
    id: "proof:booking",
    revision: 1,
    goalContractDigest,
    criterionId: "criterion:booking",
    obligationId: "obligation:booking",
    mode: "executable" as const,
    authority: "orchestrator_deterministic" as const,
    repositoryViewDigest: "sha256:view",
    procedureRef: "command:test-booking",
    selectorDigest: "sha256:selector",
    environmentPolicyDigest: "sha256:environment-policy",
    independence: "independent_required" as const
  };
}
