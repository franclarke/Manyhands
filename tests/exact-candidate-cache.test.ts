import { describe, expect, it, vi } from "vitest";
import {
  InMemoryEvidenceValidationCache,
  validateExactCandidate,
  type ValidationRecipe
} from "@manyhands/execution-core";
import type { ValidationObligation } from "@manyhands/contracts";

const recipe: ValidationRecipe = {
  schemaVersion: 1,
  templateId: "template-1",
  programId: "template-1",
  recipeId: "recipe-1",
  validationContract: { id: "validation-1", revision: "rev-1" },
  repositorySnapshotId: "snapshot-1",
  candidateCommit: "candidate-sha",
  steps: [{
    obligationId: "obligation-1", criterionId: "criterion-1", evidenceKind: "test_result",
    command: { command: "pnpm", args: ["test", "tests/a.test.ts"], timeoutMs: 60_000, cwd: "worktree" },
    baselinePolicy: "not_required", negativeControl: "not_required", flakyPolicy: "forbid",
    attributions: [{
      obligationId: "obligation-1", criterionId: "criterion-1", evidenceKind: "test_result",
      baselinePolicy: "not_required", negativeControl: "not_required", flakyPolicy: "forbid",
      references: ["tests/a.test.ts"], rationale: "Focused test."
    }]
  }],
  unmaterializedObligationIds: []
};

const obligations: ValidationObligation[] = [
  { id: "obligation-1", criterionId: "criterion-1", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "not_required", negativeControl: "not_required", flakyPolicy: "forbid", evidence: { kind: "focused_command", selectors: ["tests/a.test.ts"], references: ["tests/a.test.ts"] } }
];

function fakes() {
  return {
    create: vi.fn(async () => ({ worktreePath: "C:/sandbox", headCommit: "candidate-sha", clean: true, dispose: vi.fn(async () => undefined) })),
    run: vi.fn(async () => ({ passed: true, exitCode: 0, output: "ok" }))
  };
}

describe("validateExactCandidate evidence cache", () => {
  it("reuses a cached result for an identical recipe without re-opening a sandbox", async () => {
    const cache = new InMemoryEvidenceValidationCache();
    const { create, run } = fakes();
    const first = await validateExactCandidate({ recipe, obligations }, { sandbox: { create }, run, cache });
    const second = await validateExactCandidate({ recipe, obligations }, { sandbox: { create }, run, cache });
    expect(second).toEqual(first);
    expect(create).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("re-runs when the recipe identity differs", async () => {
    const cache = new InMemoryEvidenceValidationCache();
    const { create, run } = fakes();
    await validateExactCandidate({ recipe, obligations }, { sandbox: { create }, run, cache });
    await validateExactCandidate({ recipe: { ...recipe, recipeId: "recipe-2" }, obligations }, { sandbox: { create }, run, cache });
    expect(create).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not reuse verified evidence when integrity findings change", async () => {
    const cache = new InMemoryEvidenceValidationCache();
    const { create, run } = fakes();
    await validateExactCandidate({ recipe, obligations }, { sandbox: { create }, run, cache });
    const second = await validateExactCandidate({
      recipe,
      obligations,
      integrityFindings: [{ findingId: "finding-1", code: "test_only", path: "tests/a.test.ts", message: "Focused test" }]
    }, { sandbox: { create }, run, cache });
    expect(second.matrix.outcome).toBe("failed");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("ignores a cache entry bound to a different candidate commit", async () => {
    const { create, run } = fakes();
    const stale = {
      candidateCommit: "other-candidate",
      evidence: [],
      matrix: {
        criteria: [],
        outcome: "verified" as const,
        observations: [],
        integrityFindings: [],
        negativeControls: []
      }
    };
    const cache = {
      get: vi.fn(async () => stale),
      set: vi.fn(async () => undefined)
    };

    const result = await validateExactCandidate({ recipe, obligations }, { sandbox: { create }, run, cache });

    expect(result.candidateCommit).toBe(recipe.candidateCommit);
    expect(create).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });
});

describe("validateExactCandidate baseline sandbox reuse", () => {
  const step = (id: string) => ({
    obligationId: id,
    criterionId: id,
    evidenceKind: "test_result" as const,
    command: { command: "pnpm", args: ["test", `tests/${id}.test.ts`], timeoutMs: 60_000, cwd: "worktree" as const },
    baselinePolicy: "required" as const,
    negativeControl: "not_required" as const,
    flakyPolicy: "forbid" as const,
    attributions: [{
      obligationId: id,
      criterionId: id,
      evidenceKind: "test_result" as const,
      baselinePolicy: "required" as const,
      negativeControl: "not_required" as const,
      flakyPolicy: "forbid" as const,
      references: [`tests/${id}.test.ts`],
      rationale: "Focused test."
    }]
  });
  const baselineRecipe: ValidationRecipe = { ...recipe, baselineCommit: "baseline-sha", steps: [step("obligation-1"), step("obligation-2")] };
  const twoObligations: ValidationObligation[] = ["obligation-1", "obligation-2"].map((id) => ({ id, criterionId: id, layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "required", negativeControl: "not_required", flakyPolicy: "forbid", evidence: { kind: "focused_command", selectors: [`tests/${id}.test.ts`], references: [`tests/${id}.test.ts`] } }));

  it("opens a single baseline sandbox and reuses it across every baseline obligation", async () => {
    const { create, run } = fakes();
    const baselineDispose = vi.fn(async () => undefined);
    const createBaselineSandbox = vi.fn(async () => ({ worktreePath: "C:/baseline", headCommit: "baseline-sha", clean: true, dispose: baselineDispose }));
    const runBaseline = vi.fn(async () => ({ passed: true, exitCode: 0, output: "ok" }));

    await validateExactCandidate({ recipe: baselineRecipe, obligations: twoObligations }, { sandbox: { create }, run, createBaselineSandbox, runBaseline });

    expect(createBaselineSandbox).toHaveBeenCalledTimes(1);
    expect(runBaseline).toHaveBeenCalledTimes(2);
    expect(baselineDispose).toHaveBeenCalledTimes(1);
  });

  it("preserves verified evidence when cleanup fails after validation", async () => {
    const candidateDispose = vi.fn(async () => { throw new Error("candidate cleanup failed"); });
    const baselineDispose = vi.fn(async () => undefined);
    const onCleanupFailure = vi.fn();
    const result = await validateExactCandidate({ recipe: baselineRecipe, obligations: twoObligations }, {
      sandbox: { create: async () => ({ worktreePath: "C:/candidate", headCommit: "candidate-sha", clean: true, dispose: candidateDispose }) },
      run: async () => ({ passed: true, exitCode: 0, output: "ok" }),
      createBaselineSandbox: async () => ({ worktreePath: "C:/baseline", headCommit: "baseline-sha", clean: true, dispose: baselineDispose }),
      runBaseline: async () => ({ passed: true, exitCode: 0, output: "ok" }),
      onCleanupFailure
    });

    expect(result.matrix.outcome).toBe("verified");
    expect(candidateDispose).toHaveBeenCalledTimes(1);
    expect(baselineDispose).toHaveBeenCalledTimes(1);
    expect(onCleanupFailure).toHaveBeenCalledWith(expect.objectContaining({ message: "candidate cleanup failed" }));
  });
});
