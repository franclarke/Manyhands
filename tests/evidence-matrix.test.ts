import { describe, expect, it } from "vitest";
import { buildEvidenceMatrix } from "@manyhands/execution-core";
import { EvidenceMatrixRecordSchema } from "@manyhands/run-coordinator";

const obligations = [
  { id: "obligation-a", criterionId: "criterion-a", layer: "unit" as const, severity: "required" as const, acceptableEvidence: ["test_result" as const], baselinePolicy: "optional" as const, negativeControl: "not_required" as const, flakyPolicy: "allow_with_warning" as const },
  { id: "obligation-b", criterionId: "criterion-b", layer: "static" as const, severity: "required" as const, acceptableEvidence: ["static_analysis" as const], baselinePolicy: "required" as const, negativeControl: "not_required" as const, flakyPolicy: "forbid" as const }
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
      { evidenceId: "e-a-1", obligationId: "obligation-a", kind: "test_result", passed: false, attempt: 1 },
      { evidenceId: "e-a-2", obligationId: "obligation-a", kind: "test_result", passed: true, attempt: 2 }
    ] });
    expect(matrix.criteria[0]).toMatchObject({ status: "flaky", evidenceRefs: ["e-a-1", "e-a-2"] });
    expect(matrix.criteria[1]).toMatchObject({ status: "uncovered" });
    expect(matrix.outcome).toBe("unverified");
  });

  it("rejects a persisted verified outcome when any criterion is uncovered", () => {
    expect(EvidenceMatrixRecordSchema.safeParse({
      matrixId: "matrix-1",
      candidateCommit: "candidate",
      validationContract: { id: "validation-1", revision: "rev-1" },
      criteria: [{ criterionId: "criterion-a", obligationId: "obligation-a", status: "uncovered", justification: "No evidence", evidenceRefs: [] }],
      outcome: "verified"
    }).success).toBe(false);
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

  it("keeps a passed command uncovered when its required baseline was not run", () => {
    const matrix = buildEvidenceMatrix({ obligations, evidence: [
      { evidenceId: "e-static", obligationId: "obligation-b", kind: "static_analysis", passed: true, attempt: 1 }
    ] });
    expect(matrix.criteria[1]).toMatchObject({ status: "uncovered", justification: expect.stringMatching(/baseline/i) });
  });
});
