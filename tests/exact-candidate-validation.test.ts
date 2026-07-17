import { describe, expect, it, vi } from "vitest";
import { validateExactCandidate, type ValidationRecipe } from "@manyhands/execution-core";

const recipe: ValidationRecipe = {
  schemaVersion: 1,
  recipeId: "recipe-1",
  validationContract: { id: "validation-1", revision: "rev-1" },
  repositorySnapshotId: "snapshot-1",
  candidateCommit: "candidate-sha",
  steps: [{ obligationId: "obligation-1", criterionId: "criterion-1", evidenceKind: "test_result", command: { command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }, baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid" }],
  unmaterializedObligationIds: []
};

describe("validateExactCandidate", () => {
  it("runs in a clean sandbox pinned to the exact candidate and cleans it", async () => {
    const create = vi.fn(async () => ({ worktreePath: "C:/sandbox", headCommit: "candidate-sha", clean: true, dispose: vi.fn(async () => undefined) }));
    const run = vi.fn(async () => ({ passed: true, exitCode: 0, output: "ok" }));
    const result = await validateExactCandidate({ recipe, obligations: [{ id: "obligation-1", criterionId: "criterion-1", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid" }] }, { sandbox: { create }, run });
    expect(create).toHaveBeenCalledWith({ candidateCommit: "candidate-sha" });
    expect(run).toHaveBeenCalledWith(recipe.steps[0], expect.objectContaining({ worktreePath: "C:/sandbox" }));
    expect(result.candidateCommit).toBe("candidate-sha");
    expect(result.matrix.outcome).toBe("verified");
  });

  it("rejects a sandbox whose HEAD does not match the candidate", async () => {
    await expect(validateExactCandidate({ recipe, obligations: [] }, {
      sandbox: { create: async () => ({ worktreePath: "C:/sandbox", headCommit: "other", clean: true, dispose: async () => undefined }) },
      run: async () => ({ passed: true, exitCode: 0, output: "ok" })
    })).rejects.toThrow(/exact candidate/i);
  });
});
