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

  it.each([[false, "failed"], [true, "verified"]] as const)(
    "persists negative-control discrimination=%s as %s",
    async (detectedFailure, outcome) => {
      const controlledRecipe: ValidationRecipe = {
        ...recipe,
        recipeId: `recipe-control-${detectedFailure}`,
        steps: recipe.steps.map((step) => ({ ...step, negativeControl: "required" }))
      };
      const result = await validateExactCandidate({
        recipe: controlledRecipe,
        obligations: [{ id: "obligation-1", criterionId: "criterion-1", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "required", flakyPolicy: "forbid" }]
      }, {
        sandbox: { create: async () => ({ worktreePath: "C:/sandbox", headCommit: "candidate-sha", clean: true, dispose: async () => undefined }) },
        run: async () => ({ passed: true, exitCode: 0, output: "candidate passed" }),
        runNegativeControl: async () => ({ detectedFailure, output: `negative control ${detectedFailure}` })
      });

      expect(result.matrix.outcome).toBe(outcome);
      expect(result.matrix.negativeControls).toEqual([
        expect.objectContaining({ evidenceId: "obligation-1:negative-control", detectedFailure, outputDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) })
      ]);
      expect(result.matrix.criteria[0]?.evidenceRefs).toContain("obligation-1:negative-control");
    }
  );
});
