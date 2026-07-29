import { describe, expect, it, vi } from "vitest";
import { compileValidationRecipe, validateExactCandidate, type ValidationRecipe } from "@manyhands/execution-core";
import type { ValidationContract } from "@manyhands/contracts";
import type { RepositoryCapabilities } from "@manyhands/repository-index";

const recipe: ValidationRecipe = {
  schemaVersion: 1,
  recipeId: "recipe-1",
  validationContract: { id: "validation-1", revision: "rev-1" },
  repositorySnapshotId: "snapshot-1",
  candidateCommit: "candidate-sha",
  steps: [{
    obligationId: "obligation-1", criterionId: "criterion-1", evidenceKind: "test_result",
    command: { command: "pnpm", args: ["test", "tests/a.test.ts"], timeoutMs: 60_000, cwd: "worktree" },
    baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid",
    attributions: [{
      obligationId: "obligation-1", criterionId: "criterion-1", evidenceKind: "test_result",
      baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid",
      references: ["tests/a.test.ts"], rationale: "Focused test."
    }]
  }],
  unmaterializedObligationIds: []
};

describe("validateExactCandidate", () => {
  it("runs in a clean sandbox pinned to the exact candidate and cleans it", async () => {
    const create = vi.fn(async () => ({ worktreePath: "C:/sandbox", headCommit: "candidate-sha", clean: true, dispose: vi.fn(async () => undefined) }));
    const run = vi.fn(async () => ({ passed: true, exitCode: 0, output: "ok" }));
    const result = await validateExactCandidate({ recipe, obligations: [{ id: "obligation-1", criterionId: "criterion-1", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid", evidence: { kind: "focused_command", selectors: ["tests/a.test.ts"], references: ["tests/a.test.ts"] } }] }, { sandbox: { create }, run });
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
        steps: recipe.steps.map((step) => ({
          ...step,
          negativeControl: "required",
          attributions: step.attributions?.map((attribution) => ({ ...attribution, negativeControl: "required" }))
        }))
      };
      const result = await validateExactCandidate({
        recipe: controlledRecipe,
        obligations: [{ id: "obligation-1", criterionId: "criterion-1", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "required", flakyPolicy: "forbid", evidence: { kind: "focused_command", selectors: ["tests/a.test.ts"], references: ["tests/a.test.ts"] } }]
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

  it("executes declared shared evidence once and attributes the exact observation to every listed criterion", async () => {
    const shared = {
      kind: "shared_command",
      criterionIds: ["criterion-order", "criterion-values"],
      references: ["tests/projections.test.ts"],
      rationale: "The value-aware projection test asserts both ordering and values."
    } as const;
    const contract = {
      schemaVersion: 2,
      id: "validation-shared",
      revision: "rev-shared",
      provenance: "compiled",
      nodeId: "node-shared",
      obligations: [
        { id: "obligation-order", criterionId: "criterion-order", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "not_required", negativeControl: "not_required", flakyPolicy: "forbid", evidence: shared },
        { id: "obligation-values", criterionId: "criterion-values", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "not_required", negativeControl: "not_required", flakyPolicy: "forbid", evidence: shared }
      ]
    } as ValidationContract;
    const capabilities = {
      packageManager: { name: "pnpm", evidence: "pnpm-lock.yaml" },
      scripts: { test: "vitest run" },
      baselineCommands: [{ kind: "test", command: "pnpm", args: ["test"], sourceScript: "test" }],
      languages: [],
      stack: []
    } satisfies RepositoryCapabilities;
    const sharedRecipe = compileValidationRecipe({
      contract,
      capabilities,
      repositorySnapshotId: "snapshot-shared",
      candidateCommit: "candidate-sha"
    });
    const run = vi.fn(async () => ({ passed: true, exitCode: 0, output: "2 tests passed" }));

    const result = await validateExactCandidate({
      recipe: sharedRecipe,
      obligations: contract.obligations
    }, {
      sandbox: { create: async () => ({ worktreePath: "C:/sandbox", headCommit: "candidate-sha", clean: true, dispose: async () => undefined }) },
      run
    });

    expect(sharedRecipe.steps).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(result.matrix.outcome).toBe("verified");
    expect(result.matrix.criteria.map((criterion) => criterion.status)).toEqual(["satisfied", "satisfied"]);
    expect(result.matrix.criteria[0]?.evidenceRefs).toEqual(result.matrix.criteria[1]?.evidenceRefs);
    expect(result.matrix.observations).toEqual([
      expect.objectContaining({
        commandDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        durationMs: expect.any(Number),
        criterionIds: ["criterion-order", "criterion-values"],
        obligationIds: ["obligation-order", "obligation-values"],
        references: ["tests/projections.test.ts"]
      })
    ]);
  });
});
