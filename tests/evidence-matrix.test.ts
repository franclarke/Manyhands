import { describe, expect, it } from "vitest";
import { buildEvidenceMatrix } from "@manyhands/execution-core";
import { EvidenceMatrixRecordSchema } from "@manyhands/run-coordinator";

const obligations = [
  {
    id: "obligation-a", criterionId: "criterion-a", layer: "unit" as const, severity: "required" as const,
    acceptableEvidence: ["test_result" as const], baselinePolicy: "optional" as const, negativeControl: "not_required" as const, flakyPolicy: "allow_with_warning" as const,
    evidence: { kind: "focused_command" as const, selectors: ["tests/a.test.ts"], references: ["tests/a.test.ts"] }
  },
  {
    id: "obligation-b", criterionId: "criterion-b", layer: "static" as const, severity: "required" as const,
    acceptableEvidence: ["static_analysis" as const], baselinePolicy: "required" as const, negativeControl: "not_required" as const, flakyPolicy: "forbid" as const,
    evidence: { kind: "static_proof" as const, references: ["tsconfig.json"] }
  }
];

describe("buildEvidenceMatrix", () => {
  it("does not satisfy a criterion from an unrelated exit-code-zero observation", () => {
    const matrix = buildEvidenceMatrix({ obligations, evidence: [{ evidenceId: "e-other", obligationId: "other", kind: "test_result", passed: true, attempt: 1 }] });
    expect(matrix.criteria).toEqual([
      expect.objectContaining({ criterionId: "criterion-a", status: "uncovered" }),
      expect.objectContaining({ criterionId: "criterion-b", status: "uncovered" })
    ]);
    expect(matrix.outcome).toBe("unverified");
  });

  it("marks pass-after-failure as flaky and keeps uncovered required criteria unverified", () => {
    const matrix = buildEvidenceMatrix({ obligations, evidence: [
      { evidenceId: "e-a-1", obligationId: "obligation-a", criterionId: "criterion-a", kind: "test_result", passed: false, attempt: 1, commandDigest: "a".repeat(64), durationMs: 5, references: ["tests/a.test.ts"] },
      { evidenceId: "e-a-2", obligationId: "obligation-a", criterionId: "criterion-a", kind: "test_result", passed: true, attempt: 2, commandDigest: "a".repeat(64), durationMs: 5, references: ["tests/a.test.ts"] }
    ] });
    expect(matrix.criteria[0]).toMatchObject({ status: "flaky", evidenceRefs: ["e-a-1", "e-a-2"] });
    expect(matrix.criteria[1]).toMatchObject({ status: "uncovered" });
    expect(matrix.outcome).toBe("unverified");
  });

  it("rejects a persisted verified outcome when any criterion is uncovered", () => {
    const parsed = EvidenceMatrixRecordSchema.safeParse({
      matrixId: "matrix-1",
      candidateCommit: "candidate",
      validationContract: { id: "validation-1", revision: "rev-1" },
      criteria: [{ criterionId: "criterion-a", obligationId: "obligation-a", status: "uncovered", justification: "No evidence", evidenceRefs: [] }],
      outcome: "verified"
    });
    expect(parsed.success).toBe(false);
  });

  it("upgrades historical matrices to the canonical empty observation list", () => {
    const parsed = EvidenceMatrixRecordSchema.parse({
      matrixId: "matrix-1",
      candidateCommit: "candidate",
      validationContract: { id: "validation-1", revision: "rev-1" },
      criteria: [{ criterionId: "criterion-a", obligationId: "obligation-a", status: "satisfied", justification: "Passed", evidenceRefs: ["evidence-1"] }],
      outcome: "verified"
    });

    expect(parsed.observations).toEqual([]);
  });

  it("rejects persisted verified outcomes with integrity findings or ineffective negative controls", () => {
    const base = {
      matrixId: "matrix-1",
      candidateCommit: "candidate",
      validationContract: { id: "validation-1", revision: "rev-1" },
      criteria: [{ criterionId: "criterion-a", obligationId: "obligation-a", status: "satisfied", justification: "Passed", evidenceRefs: ["evidence-1"] }],
      outcome: "verified"
    } as const;
    expect(EvidenceMatrixRecordSchema.safeParse({
      ...base,
      integrityFindings: [{ findingId: "finding-1", code: "test_only", path: "tests/a.test.ts", message: "Focused test" }]
    }).success).toBe(false);
    expect(EvidenceMatrixRecordSchema.safeParse({
      ...base,
      negativeControls: [{ evidenceId: "negative-1", obligationId: "obligation-a", detectedFailure: false, outputDigest: "a".repeat(64) }]
    }).success).toBe(false);
  });

  it("records an assertion-count contraction as rebutted when differential evidence proves the rewritten test", () => {
    const obligation = {
      ...obligations[0]!,
      negativeControl: "when_feasible" as const
    };
    const matrix = buildEvidenceMatrix({
      obligations: [obligation],
      evidence: [{
        evidenceId: "candidate-test",
        obligationId: obligation.id,
        criterionId: obligation.criterionId,
        kind: "test_result",
        passed: true,
        attempt: 1,
        commandDigest: "a".repeat(64),
        durationMs: 10,
        references: ["tests/a.test.ts"],
        negativeControl: {
          evidenceId: "negative-control",
          obligationId: obligation.id,
          detectedFailure: true,
          outputDigest: "b".repeat(64)
        }
      }],
      integrityFindings: [{
        findingId: "finding-assertion-count",
        code: "assertion_removed",
        path: "tests/a.test.ts",
        message: "Candidate reduces assertion sites from 51 to 49."
      }]
    });

    expect(matrix.outcome).toBe("verified");
    expect(matrix.integrityFindings).toEqual([expect.objectContaining({
      findingId: "finding-assertion-count",
      disposition: "rebutted",
      rebuttalEvidenceRefs: ["negative-control"]
    })]);
    expect(EvidenceMatrixRecordSchema.safeParse({
      matrixId: "matrix-rebutted-assertion-count",
      candidateCommit: "candidate",
      validationContract: { id: "validation-1", revision: "rev-1" },
      ...matrix
    }).success).toBe(true);
  });

  it("keeps assertion contraction and structural tampering blocking without adequate differential evidence", () => {
    const obligation = { ...obligations[0]!, negativeControl: "when_feasible" as const };
    const evidence = [{
      evidenceId: "candidate-test",
      obligationId: obligation.id,
      criterionId: obligation.criterionId,
      kind: "test_result" as const,
      passed: true,
      attempt: 1,
      commandDigest: "a".repeat(64),
      durationMs: 10,
      references: ["tests/a.test.ts"],
      negativeControl: {
        evidenceId: "negative-control",
        obligationId: obligation.id,
        detectedFailure: true,
        outputDigest: "b".repeat(64)
      }
    }];
    const assertionWithoutControl = buildEvidenceMatrix({
      obligations: [{ ...obligation, negativeControl: "not_required" as const }],
      evidence: evidence.map(({ negativeControl: _negativeControl, ...item }) => item),
      integrityFindings: [{ findingId: "finding-assertion", code: "assertion_removed", path: "tests/a.test.ts", message: "Removed assertion" }]
    });
    const skippedWithControl = buildEvidenceMatrix({
      obligations: [obligation],
      evidence,
      integrityFindings: [{ findingId: "finding-skip", code: "test_skipped", path: "tests/a.test.ts", message: "Skipped test" }]
    });

    expect(assertionWithoutControl.outcome).toBe("failed");
    expect(assertionWithoutControl.integrityFindings).toEqual([expect.objectContaining({ disposition: "blocking" })]);
    expect(skippedWithControl.outcome).toBe("failed");
    expect(skippedWithControl.integrityFindings).toEqual([expect.objectContaining({ disposition: "blocking" })]);
  });

  it("persists a failed matrix containing the observable-public-surface finding", () => {
    const parsed = EvidenceMatrixRecordSchema.safeParse({
      matrixId: "matrix-public-surface",
      candidateCommit: "candidate",
      validationContract: { id: "validation-public-surface", revision: "rev-1" },
      criteria: [{ criterionId: "criterion-public-surface", obligationId: "obligation-public-surface", status: "failed", justification: "API has no named operation", evidenceRefs: [] }],
      outcome: "failed",
      integrityFindings: [{ findingId: "finding-public-surface", code: "required_public_surface_unrepresented", path: "src/api/orders.ts", message: "No named operation" }]
    });

    expect(parsed.success).toBe(true);
  });

  it("keeps a passed command uncovered when its required baseline was not run", () => {
    const matrix = buildEvidenceMatrix({ obligations, evidence: [
      { evidenceId: "e-static", obligationId: "obligation-b", criterionId: "criterion-b", kind: "static_analysis", passed: true, attempt: 1, commandDigest: "b".repeat(64), durationMs: 5, references: ["tsconfig.json"] }
    ] });
    expect(matrix.criteria[1]).toMatchObject({ status: "uncovered", justification: expect.stringMatching(/baseline/i) });
  });

  it("does not let a generic passing command substitute for an exact focused proof", () => {
    const orderObligation = {
      id: "obligation-order",
      criterionId: "criterion-order",
      layer: "unit" as const,
      severity: "required" as const,
      acceptableEvidence: ["test_result" as const],
      baselinePolicy: "optional" as const,
      negativeControl: "not_required" as const,
      flakyPolicy: "forbid" as const,
      evidence: {
        kind: "focused_command" as const,
        selectors: ["tests/projections.test.mjs"],
        references: ["tests/projections.test.mjs"]
      }
    };
    const matrix = buildEvidenceMatrix({
      obligations: [orderObligation],
      evidence: [{
        evidenceId: "generic-pnpm-test",
        obligationId: "obligation-order",
        criterionId: "criterion-order",
        kind: "test_result",
        passed: true,
        attempt: 1,
        commandDigest: "a".repeat(64),
        durationMs: 10,
        references: ["package.json"]
      }]
    });

    expect(matrix.criteria[0]).toMatchObject({ status: "uncovered" });
    expect(matrix.outcome).toBe("unverified");
  });
});
