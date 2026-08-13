import { describe, expect, it } from "vitest";
import { buildSemanticPlan } from "@manyhands/contracts";
import { verifyPlan } from "@manyhands/decomposer";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

describe("Stage 5 deterministic plan verifier", () => {
  it("accepts a covered, ordered and repository-grounded semantic plan", () => {
    const fixture = stage5Fixture();
    const result = verifyPlan({ ...fixture, hasher: stage5Sha256 });
    expect(result).toEqual({ ok: true, findings: [] });
  });

  it("blocks missing proof authority before compilation", () => {
    const fixture = stage5Fixture();
    const result = verifyPlan({ ...fixture, proofStrategies: [], hasher: stage5Sha256 });
    expect(result.ok).toBe(false);
    expect(result.findings.map(({ code }) => code)).toContain("required_criterion_uncovered");
  });

  it("blocks unordered overlapping writers before compilation", () => {
    const fixture = stage5Fixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:b"]!.resourceIntents = [{
      ...material.units["unit:b"]!.resourceIntents[0]!,
      resourceId: "resource:a",
      inputArtifactId: undefined
    }];
    material.units["unit:b"]!.consumes = [];
    material.artifacts["artifact:a"]!.consumerUnitIds = ["unit:root"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });
    expect(result.findings.map(({ code }) => code)).toContain("resource_double_writer");
  });

  it("blocks artifact cycles and protected oracle paths", () => {
    const fixture = stage5Fixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.consumes = ["artifact:b"];
    material.units["unit:a"]!.repositorySurface.pathHints.push("tests/protected-oracle.ts");
    material.artifacts["artifact:b"]!.consumerUnitIds.push("unit:a");
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });
    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "artifact_cycle",
      "protected_path_write"
    ]));
  });

  it("surfaces unresolved resources and ready frontiers instead of guessing", () => {
    const fixture = stage5Fixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.resourceIntents[0]!.resourceId = "resource:missing";
    material.units["unit:a"]!.granularity = {
      ...material.units["unit:a"]!.granularity,
      disposition: "frontier"
    };
    material.units["unit:a"]!.expansion = "frontier";
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });
    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "resource_unresolved",
      "ready_plan_frontier"
    ]));
  });
});

function withoutDigest(plan: ReturnType<typeof stage5Fixture>["plan"]) {
  const { digest: _digest, ...material } = structuredClone(plan);
  return material;
}
