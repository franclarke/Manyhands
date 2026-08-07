import { describe, expect, it } from "vitest";

import { buildEvidenceMatrix, compileValidationRecipe } from "@manyhands/execution-core";
import type { ValidationObligation } from "@manyhands/contracts";

/**
 * Stage 5 acceptance of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`:
 * "a target with no `test` script produces an explicit diagnostic, not an
 * invented command and not a silent `verified`".
 *
 * D11 fixed the derivation so a lockfile-less target still yields commands.
 * This fixes the other half in place: when a target genuinely declares nothing
 * to run, the run must say so rather than pass by vacuous truth — an obligation
 * with no evidence is the most dangerous possible `verified`.
 */

const OBLIGATION: ValidationObligation = {
  id: "obligation-1",
  criterionId: "criterion-1",
  layer: "leaf",
  severity: "required",
  acceptableEvidence: ["test_result"],
  baselinePolicy: "not_required",
  negativeControl: "not_required",
  flakyPolicy: "forbid",
  evidence: { kind: "suite_command", references: ["test"] }
};

const CAPABILITIES = {
  scripts: {},
  baselineCommands: [],
  languages: [],
  stack: []
};

describe("a target that declares nothing to run", () => {
  it("compiles no step and says which obligation it could not materialize", () => {
    const recipe = compileValidationRecipe({
      contract: { id: "validation-1", revision: "r1", nodeId: "node-1", obligations: [OBLIGATION] } as never,
      capabilities: CAPABILITIES as never,
      repositorySnapshotId: "sha256:snap",
      candidateCommit: "9".repeat(40)
    });

    expect(recipe.steps).toEqual([]);
    // Naming the obligation is what makes the failure actionable: without it the
    // run reports "nothing ran" and leaves the reader to guess which criterion
    // lost its command.
    expect(recipe.unmaterializedObligationIds).toEqual(["obligation-1"]);
  });

  /**
   * The clause that matters. No steps means no evidence, and a required
   * obligation with no evidence must never be satisfied by default.
   */
  it("reports unverified rather than verified when nothing could run", () => {
    const matrix = buildEvidenceMatrix({ obligations: [OBLIGATION], evidence: [] });

    expect(matrix.outcome).toBe("unverified");
    expect(matrix.criteria[0]!.status).toBe("uncovered");
    expect(matrix.criteria[0]!.justification).toMatch(/no acceptable evidence/iu);
  });

  it("never invents a command for an obligation it cannot satisfy", () => {
    const recipe = compileValidationRecipe({
      contract: { id: "validation-1", revision: "r1", nodeId: "node-1", obligations: [OBLIGATION] } as never,
      capabilities: CAPABILITIES as never,
      repositorySnapshotId: "sha256:snap",
      candidateCommit: "9".repeat(40)
    });

    expect(recipe.steps.map((step) => step.command)).toEqual([]);
  });
});
