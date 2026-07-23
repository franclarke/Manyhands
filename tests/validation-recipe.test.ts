import { describe, expect, it } from "vitest";
import { compileValidationRecipe } from "@manyhands/execution-core";
import type { RepositoryCapabilities } from "@manyhands/repository-index";
import type { ValidationContract } from "@manyhands/contracts";

const contract: ValidationContract = {
  schemaVersion: 2, id: "validation-1", revision: "rev-1", provenance: "compiled", nodeId: "node-1",
  obligations: [
    { id: "obligation-static", criterionId: "criterion-static", layer: "static", severity: "required", acceptableEvidence: ["static_analysis"], baselinePolicy: "required", negativeControl: "not_required", flakyPolicy: "forbid" },
    { id: "obligation-unit", criterionId: "criterion-unit", layer: "unit", severity: "required", acceptableEvidence: ["test_result"], baselinePolicy: "optional", negativeControl: "when_feasible", flakyPolicy: "allow_with_warning" }
  ]
};

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
    expect(recipe.steps.map((step) => step.command)).toEqual([
      { command: "pnpm", args: ["typecheck"], timeoutMs: 60_000, cwd: "worktree" },
      { command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }
    ]);
    expect(recipe.unmaterializedObligationIds).toEqual([]);
    expect(recipe.baselineCommit).toBe("base");
  });
});
