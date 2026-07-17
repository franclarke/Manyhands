import { describe, expect, it, vi } from "vitest";
import { FinalCandidatePreparer } from "@manyhands/execution-core";

describe("final candidate preparation", () => {
  it("prepares and validates an exact isolated candidate without publishing it", async () => {
    const publish = vi.fn();
    const prepare = vi.fn().mockResolvedValue({
      candidateCommit: "candidate-sha",
      candidateRef: "refs/manyhands/candidates/run-1",
      changedFiles: ["src/app.ts"]
    });
    const validate = vi.fn().mockResolvedValue({ matrixId: "matrix-1", candidateCommit: "candidate-sha", eligible: true });
    const preparer = new FinalCandidatePreparer({ prepare, validate, clock: () => "2026-07-17T00:00:00.000Z" });

    const manifest = await preparer.prepare({
      manifestId: "manifest-1",
      runId: "run-1",
      integratedCommit: "integration-sha",
      sourceTargetFingerprint: "repo@base",
      targetBranch: "main",
      targetHead: "base-sha"
    });

    expect(prepare).toHaveBeenCalledOnce();
    expect(validate).toHaveBeenCalledWith({ candidateCommit: "candidate-sha" });
    expect(manifest).toMatchObject({ candidateCommit: "candidate-sha", evidenceMatrixId: "matrix-1", evidenceEligible: true });
    expect(publish).not.toHaveBeenCalled();
  });

  it("refuses result-ready when validation did not examine the exact candidate", async () => {
    const preparer = new FinalCandidatePreparer({
      prepare: async () => ({ candidateCommit: "candidate-sha", candidateRef: "candidate-ref", changedFiles: [] }),
      validate: async () => ({ matrixId: "matrix-1", candidateCommit: "other-sha", eligible: true }),
      clock: () => "2026-07-17T00:00:00.000Z"
    });
    await expect(preparer.prepare({ manifestId: "manifest-1", runId: "run-1", integratedCommit: "integration", sourceTargetFingerprint: "repo@base", targetBranch: "main", targetHead: "base" }))
      .rejects.toThrow(/exact candidate/i);
  });
});
