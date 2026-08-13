import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildGoalContract, buildProofStrategy, buildSemanticPlan } from "@manyhands/contracts";
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
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:root"]!.consumes.reverse();
    material.units["unit:root"]!.repositorySurface.pathHints.reverse();
    material.artifacts["artifact:a"]!.consumerUnitIds.reverse();
    const equivalent = buildSemanticPlan(material, stage5Sha256);

    const first = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    const second = compilePlan({ ...fixture, plan: equivalent, hasher: stage5Sha256, idFactory: ids });
    expect(first).toEqual(second);
  });

  it("keeps a delegated composite criterion optional in the local task bundle", () => {
    const fixture = stage5Fixture();
    const goalMaterial = structuredClone(fixture.goal);
    Reflect.deleteProperty(goalMaterial, "digest");
    goalMaterial.acceptanceCriteria.push({
      id: "criterion:delegated",
      statement: "Module B proves the delegated behavior.",
      required: true,
      level: "quality",
      protectedReferences: [],
      verification: {
        allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }],
        independence: "independent_required"
      }
    });
    const goal = buildGoalContract(goalMaterial, stage5Sha256);
    const delegatedProof = buildProofStrategy({
      id: "proof:delegated",
      revision: 1,
      goalContractDigest: goal.digest,
      criterionId: "criterion:delegated",
      obligationId: "validation:delegated",
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: fixture.repositoryView.digest,
      procedureRef: "command:delegated",
      selectorDigest: "sha256:selector-delegated",
      environmentPolicyDigest: "sha256:environment",
      independence: "independent_required"
    }, stage5Sha256);
    const proofStrategies = fixture.proofStrategies.map((proof) => {
      const proofMaterial = structuredClone(proof);
      Reflect.deleteProperty(proofMaterial, "digest");
      return buildProofStrategy({ ...proofMaterial, goalContractDigest: goal.digest }, stage5Sha256);
    }).concat(delegatedProof);
    const planMaterial = structuredClone(fixture.plan);
    Reflect.deleteProperty(planMaterial, "digest");
    planMaterial.goalContract.digest = goal.digest;
    planMaterial.units["unit:root"]!.criteria.push({
      criterionId: "criterion-ref:delegated",
      statement: "Delegate the quality proof to module B.",
      sourceCriterionId: "criterion:delegated"
    });
    planMaterial.units["unit:b"]!.criteria.push({
      criterionId: "criterion-ref:b-delegated",
      statement: "Prove the delegated quality behavior.",
      sourceCriterionId: "criterion-ref:delegated"
    });
    planMaterial.units["unit:b"]!.validation.push({
      obligationId: "validation:delegated",
      criterionId: "criterion-ref:b-delegated",
      proofStrategyId: "proof:delegated",
      layer: "integration",
      severity: "required",
      acceptableEvidence: ["test_result"],
      baselinePolicy: "required",
      negativeControl: "when_feasible",
      flakyPolicy: "forbid"
    });
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);

    const compiled = compilePlan({ ...fixture, goal, plan, proofStrategies, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.contracts.taskBundles["unit:root"]?.task.acceptanceCriteria).toEqual([
      expect.objectContaining({ id: "criterion:feature", required: true }),
      expect.objectContaining({ id: "criterion-ref:delegated", required: false })
    ]);
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
