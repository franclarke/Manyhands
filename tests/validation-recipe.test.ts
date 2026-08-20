import { describe, expect, it } from "vitest";
import {
  bindValidationRecipe,
  compileValidationRecipe,
  prepareValidationRecipe
} from "@manyhands/execution-core";
import type { RepositoryCapabilities } from "@manyhands/repository-index";
import type { ValidationContract } from "@manyhands/contracts";

const contract = {
  schemaVersion: 2, id: "validation-1", revision: "rev-1", provenance: "compiled", nodeId: "node-1",
  obligations: [
    {
      id: "obligation-static", criterionId: "criterion-static", layer: "static", severity: "required",
      acceptableEvidence: ["static_analysis"], baselinePolicy: "required", negativeControl: "not_required", flakyPolicy: "forbid",
      evidence: { kind: "static_proof", references: ["tsconfig.json"] }
    },
    {
      id: "obligation-unit", criterionId: "criterion-unit", layer: "unit", severity: "required",
      acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "when_feasible", flakyPolicy: "allow_with_warning",
      evidence: { kind: "focused_command", selectors: ["tests/booking.test.ts"], references: ["tests/booking.test.ts"] }
    }
  ]
} as ValidationContract;

const capabilities: RepositoryCapabilities = {
  packageManager: { name: "pnpm", evidence: "pnpm-lock.yaml" },
  scripts: { typecheck: "tsc --noEmit", test: "vitest run" },
  baselineCommands: [
    { kind: "typecheck", command: "pnpm", args: ["typecheck"], sourceScript: "typecheck" },
    { kind: "test", command: "pnpm", args: ["test"], sourceScript: "test" }
  ],
  languages: [{ language: "typescript", coverage: "structural", confidence: 1, evidence: ["src/a.ts"] }],
  stack: [{ name: "vitest", confidence: 1, evidence: ["package.json dependency vitest"] }]
};

/**
 * A live run stopped every leaf with `Required validation obligations cannot be
 * materialized: validation:domain-unit.` and offered a retry that could not
 * change anything. The recipe knew two different reasons — the obligation
 * carried no usable evidence, or the repository has no command able to run it —
 * and reported both as a bare list of ids, so the operator saw neither the
 * cause nor the remedy.
 */
describe("Why an obligation cannot be materialized", () => {
  const unitObligation = {
    id: "obligation-unit", criterionId: "criterion-unit", layer: "unit", severity: "required",
    acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "not_required",
    flakyPolicy: "forbid",
    evidence: { kind: "focused_command", selectors: ["tests/a.test.ts"], references: ["tests/a.test.ts"] }
  };

  it("reports evidence the plan never attached", () => {
    const bare = { ...contract, obligations: [{ ...unitObligation, evidence: undefined }] } as ValidationContract;
    const prepared = prepareValidationRecipe({ contract: bare, capabilities, repositorySnapshotId: "snapshot-1" });

    expect(prepared.unmaterialized).toEqual([{
      obligationId: "obligation-unit",
      cause: "evidence_missing",
      detail: "The plan attached no evidence to this obligation, so there is nothing to execute."
    }]);
    expect(prepared.unmaterializedObligationIds).toEqual(["obligation-unit"]);
  });

  it("reports a repository with no command able to run the obligation", () => {
    // A greenfield repository has no package manifest, so it has no commands,
    // and no leaf can ever be validated until one exists.
    const empty = { ...capabilities, scripts: {}, baselineCommands: [] } as RepositoryCapabilities;
    const prepared = prepareValidationRecipe({
      contract: { ...contract, obligations: [unitObligation] } as ValidationContract,
      capabilities: empty,
      repositorySnapshotId: "snapshot-1"
    });

    expect(prepared.unmaterialized).toEqual([{
      obligationId: "obligation-unit",
      cause: "capability_missing",
      detail: "The repository declares no test command, so this obligation has nothing to run."
    }]);
  });
});

describe("compileValidationRecipe", () => {
  it("uses observed repository capabilities and preserves obligation identities", () => {
    const recipe = compileValidationRecipe({ contract, capabilities, repositorySnapshotId: "snapshot-1", candidateCommit: "abc", baselineCommit: "base" });
    expect(recipe.steps.map((step) => step.obligationId)).toEqual(["obligation-static", "obligation-unit"]);
    expect(recipe.steps.map((step) => step.evidenceKind)).toEqual(["static_analysis", "test_result"]);
    expect(recipe.steps.map((step) => step.command)).toEqual([
      { command: "pnpm", args: ["typecheck"], timeoutMs: 60_000, cwd: "worktree" },
      { command: "pnpm", args: ["test", "tests/booking.test.ts"], timeoutMs: 60_000, cwd: "worktree" }
    ]);
    expect(recipe.unmaterializedObligationIds).toEqual([]);
    expect(recipe.baselineCommit).toBe("base");
  });

  it("does not assign one generic passing test command to heterogeneous criteria without explicit relevance", () => {
    const genericContract = {
      ...contract,
      obligations: [
        { id: "obligation-order", criterionId: "criterion-order", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid" },
        { id: "obligation-values", criterionId: "criterion-values", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "not_required", flakyPolicy: "forbid" }
      ]
    } as ValidationContract;

    const recipe = compileValidationRecipe({
      contract: genericContract,
      capabilities,
      repositorySnapshotId: "snapshot-1",
      candidateCommit: "abc"
    });

    expect(recipe.steps).toEqual([]);
    expect(recipe.unmaterializedObligationIds).toEqual(["obligation-order", "obligation-values"]);
  });

  it("separates stable command preparation from candidate binding", () => {
    const prepared = prepareValidationRecipe({
      contract,
      capabilities,
      repositorySnapshotId: "snapshot-1"
    });
    const compiled = compileValidationRecipe({
      contract,
      capabilities,
      repositorySnapshotId: "snapshot-1",
      candidateCommit: "abc",
      baselineCommit: "base"
    });
    const bound = bindValidationRecipe({
      prepared,
      candidateCommit: "abc",
      baselineCommit: "base"
    });

    expect(prepared.templateId).toBe(prepared.programId);
    expect(prepared.templateId).toBe(
      prepareValidationRecipe({ contract, capabilities, repositorySnapshotId: "snapshot-1" }).templateId
    );
    expect(prepared).not.toHaveProperty("candidateCommit");
    expect(bound).toEqual(compiled);
    expect(bound.repositorySnapshotId).toBe("snapshot-1");
    expect(bound.templateId).toBe(prepared.templateId);
    expect(bound.programId).toBe(prepared.programId);
    expect(bound.steps).toEqual(prepared.steps);

    const otherCandidate = bindValidationRecipe({
      prepared,
      candidateCommit: "different",
      baselineCommit: "base"
    });
    expect(otherCandidate.steps).toEqual(bound.steps);
    expect(otherCandidate.repositorySnapshotId).toBe(bound.repositorySnapshotId);
    expect(otherCandidate.recipeId).not.toBe(bound.recipeId);
  });

  it("keeps unmaterialized obligations in the prepared and bound recipe", () => {
    const contractWithoutBinding = {
      ...contract,
      obligations: [{
        ...contract.obligations[1]!,
        id: "obligation-unmaterialized",
        criterionId: "criterion-unmaterialized",
        evidence: undefined
      }]
    } as ValidationContract;
    const prepared = prepareValidationRecipe({
      contract: contractWithoutBinding,
      capabilities,
      repositorySnapshotId: "snapshot-1"
    });

    expect(prepared.unmaterializedObligationIds).toEqual(["obligation-unmaterialized"]);
    expect(bindValidationRecipe({ prepared, candidateCommit: "abc" }).unmaterializedObligationIds)
      .toEqual(["obligation-unmaterialized"]);
  });

  it("labels a command with the evidence kind its binding produces", () => {
    const alternativeContract = {
      ...contract,
      obligations: [{
        ...contract.obligations[1],
        acceptableEvidence: ["runtime_observation", "test_result"]
      }]
    } as ValidationContract;

    const recipe = compileValidationRecipe({
      contract: alternativeContract,
      capabilities,
      repositorySnapshotId: "snapshot-1",
      candidateCommit: "abc"
    });

    expect(recipe.steps[0]?.evidenceKind).toBe("test_result");
    expect(recipe.steps[0]?.attributions?.[0]?.evidenceKind).toBe("test_result");
  });

  it("rejects a selector that could escape the candidate worktree or alter command parsing", () => {
    const unsafeContract = {
      ...contract,
      obligations: [{
        ...contract.obligations[1]!,
        evidence: {
          kind: "focused_command" as const,
          selectors: ["../outside.test.ts"],
          references: ["tests/booking.test.ts"]
        }
      }]
    } as ValidationContract;

    expect(() => compileValidationRecipe({
      contract: unsafeContract,
      capabilities,
      repositorySnapshotId: "snapshot-1",
      candidateCommit: "abc"
    })).toThrow(/unsafe validation selector/i);
  });

});
