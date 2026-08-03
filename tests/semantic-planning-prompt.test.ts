import { describe, expect, it } from "vitest";

import { buildSemanticPlanningPrompt, parseSemanticPlanningModelOutput } from "../packages/decomposer/src/semantic-planning/prompt";

describe("semantic planning prompt", () => {
  it("makes ownership and seam grounding rules explicit before generation", () => {
    const prompt = buildSemanticPlanningPrompt({
      goal: {
        id: "goal-1",
        statement: "Implement the feature.",
        requiredCriteria: [{ id: "criterion-1", statement: "The feature works." }]
      },
      repositorySnapshot: {
        inspectionDisposition: "complete",
        capabilities: { scripts: { test: "pnpm test" }, stack: [{ name: "typescript" }] },
        index: { files: [{ path: "package.json" }] }
      } as never,
      resolvedDecisions: [],
      constraints: []
    });

    expect(prompt.system).toContain("exactly one leaf outcome");
    expect(prompt.system).toContain("Every seam producer and consumer must be a handle of a leaf module");
    expect(prompt.system).toContain("every artifactPath must belong to the producer's");
    expect(prompt.system).toContain("evidencePaths is a sibling of interface");
    expect(prompt.system).toContain("seams and uncertainties must never be nested inside root");
    expect(prompt.system).toContain("at most 6 total paths");
    expect(prompt.system).toContain("Do not report an uncertainty for an implementation choice already resolved by the goal");
    expect(prompt.system).toContain("a missing study:<name> script requires a new planned implementation path");
    expect(prompt.system).toContain("A capability is available only when its script name is in the supplied repository scripts");
    expect(prompt.system).toContain("Never use a missing study:<name> script as a repository_capability");
    expect(prompt.system).toContain("The supplied repository files are authoritative; do not invent conventional files such as public/index.html");
  });

  it("unwraps the strict Codex CLI response envelope", () => {
    const plan = { root: {}, seams: [], uncertainties: [] };
    expect(parseSemanticPlanningModelOutput(JSON.stringify({ response: JSON.stringify(plan) }))).toEqual(plan);
    expect(parseSemanticPlanningModelOutput(JSON.stringify({ response: JSON.stringify(JSON.stringify(plan)) }))).toEqual(plan);
    expect(parseSemanticPlanningModelOutput(JSON.stringify({ response: JSON.stringify(plan) }))).toEqual({
      root: {},
      seams: [],
      uncertainties: []
    });
  });
});
