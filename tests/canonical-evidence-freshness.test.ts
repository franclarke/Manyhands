import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EvidenceBindingSchema,
  buildEvidenceBinding,
  validateEvidenceFreshness,
  type DigestHasher,
  type EvidenceFreshnessExpectation
} from "@manyhands/contracts";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("canonical evidence freshness", () => {
  it.each(["satisfied", "failed", "inconclusive", "not_run", "not_applicable"] as const)(
    "represents the explicit %s outcome without confidence inference",
    (outcome) => {
      const evidence = buildEvidenceBinding({ ...evidenceMaterial(), outcome }, sha256);
      expect(EvidenceBindingSchema.parse(evidence).outcome).toBe(outcome);
      expect(EvidenceBindingSchema.safeParse({ ...evidence, confidence: 0.99 }).success).toBe(false);
    }
  );

  it("accepts evidence only for the exact candidate, strategy, recipe, environment, selector and output", () => {
    const evidence = buildEvidenceBinding(evidenceMaterial(), sha256);
    expect(validateEvidenceFreshness(evidence, expectation(), sha256)).toEqual({ ok: true, issues: [] });
  });

  it("rejects evidence whose material changed without recomputing its canonical digest", () => {
    const evidence = buildEvidenceBinding({ ...evidenceMaterial(), outcome: "failed" }, sha256);
    const tampered = { ...evidence, outcome: "satisfied" };

    expect(validateEvidenceFreshness(tampered, expectation(), sha256).issues)
      .toContainEqual(expect.objectContaining({ code: "evidence_digest_mismatch" }));
  });

  it("reports every stale dimension with a stable cause code", () => {
    const evidence = buildEvidenceBinding(evidenceMaterial(), sha256);
    const stale: EvidenceFreshnessExpectation = {
      ...expectation(),
      candidate: { ...expectation().candidate, treeOid: "f".repeat(40) },
      proofStrategyDigest: "sha256:other-strategy",
      recipeDigest: "sha256:other-recipe",
      environmentDigest: "sha256:other-environment",
      selectorDigest: "sha256:other-selector",
      outputDigest: "sha256:other-output"
    };

    expect(validateEvidenceFreshness(evidence, stale, sha256).issues.map((issue) => issue.code)).toEqual([
      "stale_candidate_tree",
      "stale_proof_strategy",
      "stale_recipe",
      "stale_environment",
      "stale_selector",
      "stale_output"
    ]);
  });
});

function evidenceMaterial() {
  return {
    id: "evidence:booking:1",
    revision: 1,
    goalContractDigest: "sha256:goal",
    criterionId: "criterion:booking",
    obligationId: "obligation:booking",
    candidate: {
      manifestDigest: "sha256:manifest",
      commitOid: "c".repeat(40),
      treeOid: "d".repeat(40)
    },
    proofStrategyDigest: "sha256:strategy",
    mode: "executable" as const,
    authority: "orchestrator_deterministic" as const,
    recipeDigest: "sha256:recipe",
    environmentDigest: "sha256:environment",
    selectorDigest: "sha256:selector",
    outputDigest: "sha256:output",
    outcome: "satisfied" as const
  };
}

function expectation(): EvidenceFreshnessExpectation {
  const evidence = evidenceMaterial();
  return {
    goalContractDigest: evidence.goalContractDigest,
    criterionId: evidence.criterionId,
    obligationId: evidence.obligationId,
    mode: evidence.mode,
    authority: evidence.authority,
    candidate: evidence.candidate,
    proofStrategyDigest: evidence.proofStrategyDigest,
    recipeDigest: evidence.recipeDigest,
    environmentDigest: evidence.environmentDigest,
    selectorDigest: evidence.selectorDigest,
    outputDigest: evidence.outputDigest
  };
}
