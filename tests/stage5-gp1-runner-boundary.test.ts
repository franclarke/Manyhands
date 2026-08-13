import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Stage 5 GP1 runner boundary", () => {
  const source = readFileSync("scripts/stage5-gp1-run.mjs", "utf8");

  it("pins the exact single-session offline profile and emits both comparator shapes", () => {
    expect(source).toContain('"--sandbox", "read-only"');
    expect(source).toContain('"--ephemeral"');
    expect(source).toContain('"--ignore-user-config"');
    expect(source).toContain('canonicalMaterialJson');
    expect(source).toContain('currentDraftJson');
    expect(source).toContain('criticFindingsJson');
    expect(source).toContain('Closed enums');
    expect(source).toContain('Validation is ALWAYS a JSON array');
    expect(source).toContain('semanticFacts is ALWAYS a JSON object');
    expect(source).toContain('Every child criterion sourceCriterionId must instead equal one criterionId declared by its direct parent');
    expect(source).toContain('Every outcome is exactly {id,description,criterionIds,verification:');
    expect(source).toContain('interface.verification is the same verification OBJECT');
    expect(source).toContain('A repeated session requires a recorded causal change');
    expect(source).not.toMatch(/exec\s+resume|--dangerously-bypass/iu);
  });

  it("binds output to exact goal, view, proof and Git identities", () => {
    expect(source).toContain('assertGitIdentity');
    expect(source).toContain('buildGoalContract');
    expect(source).toContain('buildProofStrategy');
    expect(source).toContain('PlanningEngine');
    expect(source).toContain('compilePlan');
    expect(source).toContain('PlanningModule');
    expect(source).toContain('evaluatePlanningCandidates');
  });
});
