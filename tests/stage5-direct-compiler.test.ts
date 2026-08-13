import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSemanticPlan } from "@manyhands/contracts";
import { compilePlan } from "@manyhands/decomposer";
import { validateGraphRevision } from "@manyhands/task-graph";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const ids = (kind: string, parts: readonly string[]) => [kind, ...parts].join(":");

describe("Stage 5 direct compiler", () => {
  it("compiles SemanticPlan directly into a valid GraphRevision and derived contracts", () => {
    const fixture = stage5Fixture();
    const compiled = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(validateGraphRevision(compiled.graph, {
      hasher: stage5Sha256,
      resourceOverlap: fixture.repositoryView.catalog.asOverlapQuery()
    })).toEqual([]);
    expect(compiled.contracts.taskBundles["unit:a"]?.task.goal).toBe("Implement module A.");
    expect(compiled.contracts.artifacts["artifact:a"]?.expectedPaths).toEqual(["src/a.ts"]);
    expect(compiled.contracts.seams["seam:a-b"]?.semanticFacts).toEqual({ return: "Feature" });
    expect(compiled.graph.resourceClaims.find(({ nodeId }) => nodeId === "unit:b")?.inputVersion.kind).toBe("artifact_contract");
  });

  it("is deterministic across semantically equivalent set order", () => {
    const fixture = stage5Fixture();
    const { digest: _digest, ...material } = structuredClone(fixture.plan);
    material.units["unit:root"]!.consumes.reverse();
    material.units["unit:root"]!.repositorySurface.pathHints.reverse();
    material.artifacts["artifact:a"]!.consumerUnitIds.reverse();
    const equivalent = buildSemanticPlan(material, stage5Sha256);

    const first = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    const second = compilePlan({ ...fixture, plan: equivalent, hasher: stage5Sha256, idFactory: ids });
    expect(first).toEqual(second);
  });

  it("returns verifier findings and emits no graph for an invalid proposal", () => {
    const fixture = stage5Fixture();
    const result = compilePlan({ ...fixture, proofStrategies: [], hasher: stage5Sha256, idFactory: ids });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.findings.map(({ code }) => code)).toContain("required_criterion_uncovered");
    expect("graph" in result).toBe(false);
  });

  it("has no legacy intermediate or model/query reachability", () => {
    const source = readFileSync("packages/decomposer/src/compiler/direct-plan-compiler.ts", "utf8");
    expect(source).not.toMatch(/WorkBreakdown|projectSemanticPlanForLegacyCompiler|PlanningModule|RecursivePlanner/u);
    expect(source).not.toMatch(/model\.generate|repositoryQuery|query\(/u);
  });
});
