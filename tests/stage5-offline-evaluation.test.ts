import { describe, expect, it } from "vitest";
import { buildSemanticPlan } from "@manyhands/contracts";
import { compilePlan, evaluatePlanningCandidates, renderOfflinePlanningPreview } from "@manyhands/decomposer";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const ids = (kind: string, parts: readonly string[]) => [kind, ...parts].join(":");

describe("Stage 5 offline evaluation", () => {
  it("evaluates topology independently for the new and current candidates", () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const result = evaluatePlanningCandidates({
      oracle: oracle(fixture),
      candidates: [
        { label: "stage5", plan: fixture.plan, graph: compiled.graph, contracts: compiled.contracts },
        { label: "current", unavailableReason: "Recorded current planner candidate did not satisfy the canonical compiler." }
      ]
    });

    expect(result.candidates[0]).toEqual(expect.objectContaining({ passed: true, candidate: "stage5" }));
    expect(result.candidates[1]).toEqual(expect.objectContaining({ passed: false, candidate: "current" }));
    expect(result.candidates[1]?.issues[0]?.code).toBe("candidate_unavailable");
  });

  it("renders a standalone read-only browser preview", () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    if (!compiled.ok) throw new Error("fixture must compile");
    const topology = evaluatePlanningCandidates({
      oracle: oracle(fixture),
      candidates: [{ label: "stage5", plan: fixture.plan, graph: compiled.graph, contracts: compiled.contracts }]
    }).candidates[0]!;
    const html = renderOfflinePlanningPreview({
      title: "Integrated feature",
      repository: "fixture",
      candidateSha: "a".repeat(40),
      plan: fixture.plan,
      graph: compiled.graph,
      contracts: compiled.contracts,
      topology,
      findings: []
    });

    expect(html).toContain("Responsibility hierarchy");
    expect(html).toContain("Module A");
    expect(html).toContain("Explicit seams");
    expect(html).toContain("ORACLE PASS");
    expect(html).not.toMatch(/<script|fetch\(|\/api\/|ipc/iu);
  });

  it("attributes refined local validation criteria to their root goal criterion", () => {
    const fixture = stage5Fixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:root"]!.criteria[0]!.criterionId = "criterion-ref:root";
    material.units["unit:root"]!.validation[0]!.criterionId = "criterion-ref:root";
    material.units["unit:root"]!.integration!.criterionIds = ["criterion-ref:root"];
    for (const id of ["unit:a", "unit:b"] as const) {
      material.units[id]!.criteria[0]!.criterionId = `criterion-ref:${id.slice("unit:".length)}`;
      material.units[id]!.criteria[0]!.sourceCriterionId = "criterion-ref:root";
      material.units[id]!.validation[0]!.criterionId = `criterion-ref:${id.slice("unit:".length)}`;
    }
    const plan = buildSemanticPlan(material, stage5Sha256);
    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    const result = evaluatePlanningCandidates({
      oracle: oracle(fixture),
      candidates: [{ label: "stage5", plan, graph: compiled.graph, contracts: compiled.contracts }]
    });

    expect(result.candidates[0]).toEqual(expect.objectContaining({ passed: true }));
  });
});

function oracle(fixture: ReturnType<typeof stage5Fixture>) {
  return {
    id: "oracle:fixture",
    repositoryId: "repo:fixture",
    goalDigest: fixture.goal.digest,
    repositoryViewDigest: fixture.repositoryView.digest,
    requiredResponsibilities: [
      { id: "responsibility:a", terms: ["module a"] },
      { id: "responsibility:b", terms: ["module b"] },
      { id: "responsibility:integration", terms: ["integrat"] }
    ],
    forbiddenResponsibilities: [{ id: "responsibility:web-owner", terms: ["browser", "owner"] }],
    requiredSeams: [{ id: "seam:a-b", producerTerms: ["module a"], consumerTerms: ["module b"], semanticTerms: ["feature"] }],
    requiredOwnership: [
      { id: "owner:a", path: "src/a.ts", ownerTerms: ["module a"] },
      { id: "owner:b", path: "src/b.ts", ownerTerms: ["module b"] }
    ],
    requiredCriterionIds: ["criterion:feature"],
    acceptableAlternatives: ["A contract-first split with the same ownership and proof coverage is acceptable."]
  };
}
