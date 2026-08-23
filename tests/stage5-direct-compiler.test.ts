import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildGoalContract,
  buildProofStrategy,
  buildSemanticPlan,
  verifyCanonicalDigest
} from "@manyhands/contracts";
import { compilePlan } from "@manyhands/decomposer";
import { validateGraphRevision } from "@manyhands/task-graph";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

const ids = (kind: string, parts: readonly string[]) => [kind, ...parts].join(":");

describe("Stage 5 direct compiler", () => {
  it("compiles SemanticPlan directly into a valid GraphRevision and derived contracts", () => {
    const fixture = groundedFixture();
    const compiled = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;

    expect(validateGraphRevision(compiled.graph, {
      hasher: stage5Sha256,
      resourceOverlap: fixture.repositoryView.catalog.asOverlapQuery()
    })).toEqual([]);
    expect(compiled.contracts.taskBundles["unit:a"]?.task.goal).toBe("Implement module A.");
    expect(compiled.contracts.artifacts["artifact:a"]?.expectedPaths).toEqual(["src/a.ts"]);
    expect(compiled.contracts.taskBundles["unit:a"]?.scope.outputRoots).toEqual(["src"]);
    expect(compiled.contracts.seams["seam:a-b"]?.semanticFacts).toEqual({ return: "Feature" });
    expect(compiled.contracts.validationObligations["validation:a"]?.proofStrategy)
      .toEqual(expect.objectContaining({ id: "proof:a", digest: fixture.proofStrategies[1]!.digest }));
    expect(verifyCanonicalDigest(
      compiled.contracts.validationObligations["validation:a"]!,
      "digest",
      stage5Sha256
    )).toBe(true);
    expect(compiled.graph.resourceClaims.find(({ nodeId }) => nodeId === "unit:b")?.inputVersion.kind).toBe("repository_view");
  });

  it("preserves a planned validation evidence binding in the executable contract", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:a"]!.validation[0]!.evidence = {
      kind: "focused_command",
      selectors: ["tests/module-a.test.ts"],
      references: ["tests/module-a.test.ts"]
    };
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    expect(compiled.ok).toBe(true);
    expect(compiled.contracts.taskBundles["unit:a"]?.validation.obligations[0]?.evidence).toEqual({
      kind: "focused_command",
      selectors: ["tests/module-a.test.ts"],
      references: ["tests/module-a.test.ts"]
    });
  });

  it("derives the narrow artifact directory when a planned path contains its focused test", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:a"]!.repositorySurface = {
      resourceRefs: ["path:src/module-a"],
      pathHints: ["src/module-a"]
    };
    material.units["unit:a"]!.resourceIntents[0]!.resourceId = "path:src/module-a";
    material.artifacts["artifact:a"]!.expectedPaths = [
      "src/module-a",
      "src/module-a/module-a.test.ts"
    ];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings));
    expect(compiled.contracts.taskBundles["unit:a"]?.scope.outputRoots).toEqual(["src/module-a"]);
  });

  it("is deterministic across semantically equivalent set order", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:root"]!.consumes.reverse();
    material.units["unit:root"]!.repositorySurface.pathHints.reverse();
    material.artifacts["artifact:a"]!.consumerUnitIds.reverse();
    material.evidence.reverse();
    material.decisions = [
      { id: "decision:z", statement: "Z", selectedOptionId: "option:z", evidenceRefs: ["evidence:b", "evidence:a"] },
      { id: "decision:a", statement: "A", selectedOptionId: "option:a", evidenceRefs: ["evidence:architecture"] }
    ];
    const ordered = buildSemanticPlan(material, stage5Sha256);
    material.decisions.reverse();
    material.decisions.find(({ id }) => id === "decision:z")!.evidenceRefs.reverse();
    const equivalent = buildSemanticPlan(material, stage5Sha256);

    const first = compilePlan({ ...fixture, plan: ordered, hasher: stage5Sha256, idFactory: ids });
    const second = compilePlan({ ...fixture, plan: equivalent, hasher: stage5Sha256, idFactory: ids });
    expect(first).toEqual(second);
  });

  it("keeps a delegated composite criterion optional in the local task bundle", () => {
    const fixture = groundedFixture();
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
    expect(compiled.contracts.validationObligations["validation:delegated"]?.criterionId)
      .toBe("criterion:delegated");
  });

  it("does not promote an advisory-only validation obligation to a required task criterion", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:a"]!.validation[0]!.severity = "advisory";
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.contracts.taskBundles["unit:a"]!.task.acceptanceCriteria)
      .toContainEqual(expect.objectContaining({ id: "criterion:feature", required: false }));
  });

  it("returns verifier findings and emits no graph for an invalid proposal", () => {
    const fixture = groundedFixture();
    const result = compilePlan({ ...fixture, proofStrategies: [], hasher: stage5Sha256, idFactory: ids });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.findings.map(({ code }) => code)).toContain("required_criterion_uncovered");
    expect("graph" in result).toBe(false);
  });

  it("preserves exact ProofStrategy material and makes its identity output-sensitive", () => {
    const fixture = groundedFixture();
    const changedMaterial = structuredClone(fixture.proofStrategies[1]!);
    Reflect.deleteProperty(changedMaterial, "digest");
    const changedProof = buildProofStrategy({
      ...changedMaterial,
      procedureRef: "command:pnpm-test-module-a"
    }, stage5Sha256);
    const changedProofs = fixture.proofStrategies.map((proof) =>
      proof.id === changedProof.id ? changedProof : proof
    );

    const original = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    const changed = compilePlan({
      ...fixture,
      proofStrategies: changedProofs,
      hasher: stage5Sha256,
      idFactory: ids
    });

    expect(original.ok).toBe(true);
    expect(changed.ok).toBe(true);
    if (!original.ok || !changed.ok) return;
    expect(changed.contracts.proofStrategies[changedProof.id]).toEqual(changedProof);
    expect(changed.contracts.validationObligations["validation:a"]?.proofStrategy.digest).toBe(changedProof.digest);
    expect(changed.graph.digest).not.toBe(original.graph.digest);
  });

  it("returns a deterministic finding when schema-valid material cannot compile", () => {
    const fixture = groundedFixture();

    const result = compilePlan({
      ...fixture,
      hasher: stage5Sha256,
      idFactory: () => "relation:collision"
    });

    expect(result).toEqual({
      ok: false,
      findings: [expect.objectContaining({
        code: "compiler_invalid_material",
        authority: "deterministic",
        severity: "error"
      })]
    });
  });

  it("does not emit a scope path as both allowed and forbidden", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:root"]!.repositorySurface.pathHints.push("tests/protected-oracle.ts");
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const scope = compiled.contracts.taskBundles["unit:root"]!.scope;
    expect(scope.forbiddenPaths).toContain("tests/protected-oracle.ts");
    expect(scope.allowedPaths).not.toContain("tests/protected-oracle.ts");
  });

  it("normalizes equivalent repository paths before emitting contracts", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:a"]!.repositorySurface.pathHints = [".\\src\\a.ts"];
    material.artifacts["artifact:a"]!.expectedPaths = [".\\src\\a.ts"];
    const equivalent = buildSemanticPlan(material, stage5Sha256);

    const original = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    const normalized = compilePlan({ ...fixture, plan: equivalent, hasher: stage5Sha256, idFactory: ids });

    expect(original.ok).toBe(true);
    expect(normalized.ok).toBe(true);
    if (!original.ok || !normalized.ok) return;
    expect(normalized.contracts.taskBundles["unit:a"]!.scope)
      .toEqual(original.contracts.taskBundles["unit:a"]!.scope);
    expect(normalized.contracts.artifacts["artifact:a"])
      .toEqual(original.contracts.artifacts["artifact:a"]);
  });

  it("omits valid proof strategies that no executable obligation references", () => {
    const fixture = groundedFixture();
    const extra = buildProofStrategy({
      id: "proof:unused",
      revision: 1,
      goalContractDigest: fixture.goal.digest,
      criterionId: "criterion:feature",
      obligationId: "validation:unused",
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: fixture.repositoryView.digest,
      procedureRef: "command:unused",
      selectorDigest: "sha256:selector-unused",
      environmentPolicyDigest: "sha256:environment",
      independence: "independent_required"
    }, stage5Sha256);

    const original = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });
    const withUnused = compilePlan({
      ...fixture,
      proofStrategies: fixture.proofStrategies.concat(extra),
      hasher: stage5Sha256,
      idFactory: ids
    });

    expect(withUnused).toEqual(original);
  });

  it("uses a disjoint canonical identity for integration contracts", () => {
    const fixture = groundedFixture();

    const compiled = compilePlan({ ...fixture, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.contracts.integrations["integration:unit:root"]).toEqual(expect.objectContaining({
      id: "integration:unit:root",
      obligationId: "validation:root"
    }));
    const digestsByIdentity = new Map<string, Set<string>>();
    for (const ref of compiled.contracts.refs) {
      const key = `${ref.id}\0${ref.revision}`;
      const digests = digestsByIdentity.get(key) ?? new Set<string>();
      digests.add(ref.digest);
      digestsByIdentity.set(key, digests);
    }
    expect([...digestsByIdentity.values()].every((digests) => digests.size === 1)).toBe(true);
  });

  it("rejects conflicting canonical contract refs with the same identity", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    const artifact = material.artifacts["artifact:a"]!;
    Reflect.deleteProperty(material.artifacts, "artifact:a");
    artifact.id = "integration:unit:root";
    material.artifacts[artifact.id] = artifact;
    material.units["unit:a"]!.produces = [artifact.id];
    const writer = material.units["unit:a"]!.resourceIntents[0]!;
    if (writer.access !== "modify") throw new Error("Fixture writer must be a modify intent.");
    writer.outputArtifactId = artifact.id;
    for (const unitId of ["unit:root", "unit:b"] as const) {
      material.units[unitId]!.consumes = material.units[unitId]!.consumes.map((id) =>
        id === "artifact:a" ? artifact.id : id
      );
    }
    material.seams["seam:a-b"]!.artifactId = artifact.id;
    material.units["unit:root"]!.integration!.artifactIds = [artifact.id, "artifact:b"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(false);
    expect(compiled.ok ? [] : compiled.findings.map(({ code }) => code))
      .toContain("canonical_contract_ref_collision");
  });

  it("compiles an approved planning-frontier composite without making it executable", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:a"]!.role = "composite";
    material.units["unit:a"]!.expansion = "frontier";
    material.units["unit:a"]!.granularity = {
      ...material.units["unit:a"]!.granularity,
      disposition: "frontier",
      integrationObligationId: undefined
    };
    material.units["unit:a"]!.integration = {
      obligationId: "validation:a",
      objective: "Integrate the eventual children.",
      criterionIds: ["criterion:feature"],
      proofStrategyId: "proof:a",
      artifactIds: ["artifact:a"],
      seamIds: ["seam:a-b"]
    };
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.graph.nodes["unit:a"]?.kind).toBe("composite");
  });

  it("compiles an empty composite scope from its descendant rollup", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.units["unit:root"]!.repositorySurface = { resourceRefs: [], pathHints: [] };
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.contracts.taskBundles["unit:root"]!.scope.allowedPaths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("returns verifier findings for contract-invalid relations and paths instead of throwing", () => {
    const fixture = groundedFixture();
    const material = structuredClone(fixture.plan);
    Reflect.deleteProperty(material, "digest");
    material.artifacts["artifact:a"]!.consumerUnitIds.push("unit:a");
    material.seams["seam:a-b"]!.consumerUnitIds.push("unit:a");
    material.artifacts["artifact:a"]!.materialization = "files";
    material.artifacts["artifact:a"]!.expectedPaths = [];
    material.units["unit:b"]!.repositorySurface.pathHints = ["../src/b.ts"];
    material.artifacts["artifact:b"]!.expectedPaths = ["C:\\repo\\src\\b.ts"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const compiled = compilePlan({ ...fixture, plan, hasher: stage5Sha256, idFactory: ids });

    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "artifact_self_consumer",
      "seam_self_consumer",
      "artifact_files_paths_missing",
      "repository_path_invalid",
      "artifact_path_invalid"
    ]));
    expect(compiled.findings.map(({ code }) => code)).not.toContain("compiler_invalid_material");
  });

  it("has no legacy intermediate or model/query reachability", () => {
    const source = readFileSync("packages/decomposer/src/compiler/direct-plan-compiler.ts", "utf8");
    expect(source).not.toMatch(/WorkBreakdown|projectSemanticPlanForLegacyCompiler|PlanningModule|RecursivePlanner/u);
    expect(source).not.toMatch(/model\.generate|repositoryQuery|query\(/u);
  });
});

function groundedFixture(): ReturnType<typeof stage5Fixture> {
  const fixture = stage5Fixture();
  const material = structuredClone(fixture.plan);
  Reflect.deleteProperty(material, "digest");
  material.seams["seam:a-b"]!.consumerUnitIds.push("unit:root");
  material.units["unit:b"]!.resourceIntents[0]!.inputArtifactId = undefined;
  material.evidence = ["evidence:architecture", "evidence:a", "evidence:b"].map((id) => ({
    id,
    snapshotId: material.repositorySnapshot.id,
    kind: "diagnostic",
    locator: `fixture:${id}`,
    digest: stage5Sha256(`fixture:${id}`),
    epistemic: { state: "known", confidence: "high", evidenceRefs: [id] }
  }));
  const repositoryView = {
    ...fixture.repositoryView,
    model: { ...fixture.repositoryView.model, evidence: structuredClone(material.evidence) }
  };
  return { ...fixture, repositoryView, plan: buildSemanticPlan(material, stage5Sha256) };
}
