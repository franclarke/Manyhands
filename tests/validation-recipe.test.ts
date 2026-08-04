import { describe, expect, it } from "vitest";
import { compileValidationRecipe } from "@manyhands/execution-core";
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

describe("compileValidationRecipe", () => {
  it("uses observed repository capabilities and preserves obligation identities", () => {
    const recipe = compileValidationRecipe({ contract, capabilities, repositorySnapshotId: "snapshot-1", candidateCommit: "abc", baselineCommit: "base" });
    expect(recipe.steps.map((step) => step.obligationId)).toEqual(["obligation-static", "obligation-unit"]);
    expect(recipe.steps.map((step) => step.evidenceKind)).toEqual(["static_analysis", "test_result"]);
    expect(recipe.steps.map((step) => step.command)).toEqual([
      { command: "pnpm", args: ["typecheck"], timeoutMs: 60_000, cwd: "worktree" },
      { command: "pnpm", args: ["exec", "vitest", "run", "tests/booking.test.ts"], timeoutMs: 60_000, cwd: "worktree" }
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

  it("runs focused selectors through a node test script instead of appending them to its glob arguments", () => {
    const nodeTestCapabilities: RepositoryCapabilities = {
      ...capabilities,
      scripts: { test: "node --test src/**/*.test.ts" },
      baselineCommands: [{ kind: "test", command: "pnpm", args: ["test"], sourceScript: "test" }]
    };

    const recipe = compileValidationRecipe({
      contract: { ...contract, obligations: [contract.obligations[1]!] },
      capabilities: nodeTestCapabilities,
      repositorySnapshotId: "snapshot-1",
      candidateCommit: "abc"
    });

    expect(recipe.steps[0]?.command).toEqual({
      command: "pnpm",
      args: ["exec", "node", "--test", "tests/booking.test.ts"],
      timeoutMs: 60_000,
      cwd: "worktree"
    });
  });

  it("does not pass package manifests as executable test selectors", () => {
    const nodeTestCapabilities: RepositoryCapabilities = {
      ...capabilities,
      scripts: { test: "node --test src/**/*.test.ts" },
      baselineCommands: [{ kind: "test", command: "pnpm", args: ["test"], sourceScript: "test" }]
    };
    const recipe = compileValidationRecipe({
      contract: {
        ...contract,
        obligations: [{
          ...contract.obligations[1]!,
          evidence: {
            kind: "focused_command",
            selectors: ["package.json", "tests/booking.test.ts"],
            references: ["package.json", "tests/booking.test.ts"]
          }
        }]
      },
      capabilities: nodeTestCapabilities,
      repositorySnapshotId: "snapshot-1",
      candidateCommit: "abc"
    });

    expect(recipe.steps[0]?.command.args).toEqual(["exec", "node", "--test", "tests/booking.test.ts"]);
    expect(recipe.steps[0]?.attributions?.[0]?.references).toEqual(["package.json", "tests/booking.test.ts"]);
  });

});
