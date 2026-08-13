import { describe, expect, it } from "vitest";
import { buildGoalContract, buildProofStrategy, buildSemanticPlan } from "@manyhands/contracts";
import { verifyPlan } from "@manyhands/decomposer";
import { ResourceCatalog } from "@manyhands/repository-index";
import { stage5Fixture, stage5Sha256 } from "./helpers/stage5-fixture.js";

describe("Stage 5 deterministic plan verifier", () => {
  it("accepts a covered, ordered and repository-grounded semantic plan", () => {
    const fixture = groundedFixture();
    const result = verifyPlan({ ...fixture, hasher: stage5Sha256 });
    expect(result).toEqual({ ok: true, findings: [] });
  });

  it("blocks missing proof authority before compilation", () => {
    const fixture = groundedFixture();
    const result = verifyPlan({ ...fixture, proofStrategies: [], hasher: stage5Sha256 });
    expect(result.ok).toBe(false);
    expect(result.findings.map(({ code }) => code)).toContain("required_criterion_uncovered");
  });

  it("blocks unordered overlapping writers before compilation", () => {
    const fixture = groundedFixture();
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

  it("orders overlapping writers only through explicit resource-version inputs", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:b"]!.resourceIntents = [{
      ...material.units["unit:b"]!.resourceIntents[0]!,
      resourceId: "resource:a",
      inputArtifactId: undefined
    }];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("resource_double_writer");
  });

  it("blocks artifact cycles and protected oracle paths", () => {
    const fixture = groundedFixture();
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

  it("surfaces unresolved resources and infeasible leaf frontiers instead of guessing", () => {
    const fixture = groundedFixture();
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
      "granularity_role_mismatch"
    ]));
  });

  it("accepts an approved planning-frontier composite inside a ready plan", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
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

    expect(verifyPlan({ ...fixture, plan, hasher: stage5Sha256 })).toEqual({ ok: true, findings: [] });
  });

  it("requires every required goal criterion to reach a plan validation obligation", () => {
    const fixture = groundedFixture();
    const goalMaterial = structuredClone(fixture.goal);
    Reflect.deleteProperty(goalMaterial, "digest");
    goalMaterial.acceptanceCriteria.push({
      id: "criterion:proof-only",
      statement: "A plan obligation must own this proof.",
      required: true,
      level: "quality",
      protectedReferences: [],
      verification: {
        allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }],
        independence: "independent_required"
      }
    });
    const goal = buildGoalContract(goalMaterial, stage5Sha256);
    const proofStrategies = rebindProofs(fixture, goal.digest).concat(buildProofStrategy({
      id: "proof:proof-only",
      revision: 1,
      goalContractDigest: goal.digest,
      criterionId: "criterion:proof-only",
      obligationId: "validation:proof-only",
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: fixture.repositoryView.digest,
      procedureRef: "command:proof-only",
      selectorDigest: "sha256:selector-proof-only",
      environmentPolicyDigest: "sha256:environment",
      independence: "independent_required"
    }, stage5Sha256));
    const planMaterial = withoutDigest(fixture.plan);
    planMaterial.goalContract.digest = goal.digest;
    planMaterial.units["unit:root"]!.criteria.push({
      criterionId: "criterion-ref:proof-only",
      statement: "Refine the otherwise unowned proof criterion.",
      sourceCriterionId: "criterion:proof-only"
    });
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);

    const result = verifyPlan({ ...fixture, goal, plan, proofStrategies, hasher: stage5Sha256 });

    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "required_criterion_without_validation",
      subjectId: "criterion:proof-only"
    }));
  });

  it("rejects duplicate local criteria and validation bound outside the owning unit", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.criteria.push(structuredClone(material.units["unit:a"]!.criteria[0]!));
    material.units["unit:a"]!.validation[0]!.criterionId = "criterion:missing";
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "unit_criterion_id_duplicate",
      "validation_criterion_unresolved"
    ]));
  });

  it("preserves resolvable proof-authority finding codes for engine routing", () => {
    const fixture = groundedFixture();
    const proofMaterial = structuredClone(fixture.proofStrategies[1]!);
    Reflect.deleteProperty(proofMaterial, "digest");
    const invalidProof = buildProofStrategy({
      ...proofMaterial,
      mode: "static",
      independence: "not_applicable"
    }, stage5Sha256);
    const proofStrategies = fixture.proofStrategies.map((proof) => proof.id === invalidProof.id ? invalidProof : proof);

    const result = verifyPlan({ ...fixture, proofStrategies, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "proof_pair_not_allowed",
      "independence_mismatch"
    ]));
  });

  it("verifies canonical goal and proof identities against the exact repository view", () => {
    const fixture = groundedFixture();
    const tamperedGoal = { ...fixture.goal, digest: "sha256:tampered-goal" };
    const goalPlanMaterial = withoutDigest(fixture.plan);
    goalPlanMaterial.goalContract.digest = tamperedGoal.digest;
    const goalPlan = buildSemanticPlan(goalPlanMaterial, stage5Sha256);
    const goalProofs = rebindProofs(fixture, tamperedGoal.digest);

    expect(verifyPlan({
      ...fixture,
      goal: tamperedGoal,
      plan: goalPlan,
      proofStrategies: goalProofs,
      hasher: stage5Sha256
    }).findings.map(({ code }) => code)).toContain("goal_contract_digest_mismatch");

    const tamperedProofs = fixture.proofStrategies.map((proof, index) =>
      index === 0 ? { ...proof, digest: "sha256:tampered-proof" } : proof
    );
    expect(verifyPlan({ ...fixture, proofStrategies: tamperedProofs, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("proof_strategy_digest_mismatch");

    const wrongViewProof = fixture.proofStrategies[0]!;
    const wrongViewMaterial = structuredClone(wrongViewProof);
    Reflect.deleteProperty(wrongViewMaterial, "digest");
    const wrongViewProofs = [
      buildProofStrategy({ ...wrongViewMaterial, repositoryViewDigest: "sha256:other-view" }, stage5Sha256),
      ...fixture.proofStrategies.slice(1)
    ];
    expect(verifyPlan({ ...fixture, proofStrategies: wrongViewProofs, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("proof_repository_view_mismatch");
  });

  it("applies GoalContract semantic validation before accepting a plan", () => {
    const fixture = groundedFixture();
    const goalMaterial = structuredClone(fixture.goal);
    Reflect.deleteProperty(goalMaterial, "digest");
    goalMaterial.acceptanceCriteria.push(structuredClone(goalMaterial.acceptanceCriteria[0]!));
    goalMaterial.acceptanceCriteria[0]!.verification.allowedProofs.push({
      mode: "human_review",
      authority: "orchestrator_deterministic"
    });
    const goal = buildGoalContract(goalMaterial, stage5Sha256);
    const planMaterial = withoutDigest(fixture.plan);
    planMaterial.goalContract.digest = goal.digest;
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);
    const proofStrategies = rebindProofs(fixture, goal.digest);

    const result = verifyPlan({ ...fixture, goal, plan, proofStrategies, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "duplicate_criterion",
      "unsupported_proof_pair"
    ]));
  });

  it("requires artifacts and modify outputs to name the same exact owner", () => {
    const fixture = groundedFixture();
    const missingIntentMaterial = withoutDigest(fixture.plan);
    missingIntentMaterial.units["unit:a"]!.resourceIntents = [];
    const missingIntent = buildSemanticPlan(missingIntentMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: missingIntent, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("artifact_output_intent_missing");

    const wrongOwnerMaterial = withoutDigest(fixture.plan);
    const wrongOwnerIntent = wrongOwnerMaterial.units["unit:a"]!.resourceIntents[0]!;
    if (wrongOwnerIntent.access !== "modify") throw new Error("Fixture writer must be a modify intent.");
    wrongOwnerIntent.outputArtifactId = "artifact:b";
    const wrongOwner = buildSemanticPlan(wrongOwnerMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: wrongOwner, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("resource_output_owner_mismatch");
  });

  it("requires bidirectional artifact consumption and seam-artifact consumption", () => {
    const fixture = groundedFixture();
    const reverseMaterial = withoutDigest(fixture.plan);
    reverseMaterial.artifacts["artifact:a"]!.consumerUnitIds = ["unit:root"];
    const reverse = buildSemanticPlan(reverseMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: reverse, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("unit_artifact_consumer_mismatch");

    const seamMaterial = withoutDigest(fixture.plan);
    seamMaterial.units["unit:b"]!.consumes = [];
    seamMaterial.units["unit:b"]!.resourceIntents[0]!.inputArtifactId = undefined;
    seamMaterial.artifacts["artifact:a"]!.consumerUnitIds = ["unit:root"];
    const seam = buildSemanticPlan(seamMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: seam, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("seam_consumer_missing_artifact");
  });

  it("requires every unit seam reference to resolve to a seam it participates in", () => {
    const fixture = groundedFixture();
    const missingMaterial = withoutDigest(fixture.plan);
    missingMaterial.units["unit:a"]!.seamRefs.push("seam:missing");
    const missing = buildSemanticPlan(missingMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: missing, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("unit_seam_unresolved");

    const nonParticipantMaterial = withoutDigest(fixture.plan);
    nonParticipantMaterial.seams["seam:a-b"]!.consumerUnitIds = ["unit:b"];
    const nonParticipant = buildSemanticPlan(nonParticipantMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: nonParticipant, hasher: stage5Sha256 })
      .findings.map(({ code }) => code)).toContain("unit_seam_participant_mismatch");
  });

  it("derives protected writes from canonical catalog paths including directory containment", () => {
    const fixture = groundedFixture();
    const goalMaterial = structuredClone(fixture.goal);
    Reflect.deleteProperty(goalMaterial, "digest");
    goalMaterial.acceptanceCriteria[0]!.protectedReferences = ["path:src"];
    const goal = buildGoalContract(goalMaterial, stage5Sha256);
    const planMaterial = withoutDigest(fixture.plan);
    planMaterial.goalContract.digest = goal.digest;
    planMaterial.units["unit:a"]!.repositorySurface.pathHints = [];
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);
    const proofStrategies = rebindProofs(fixture, goal.digest);

    const result = verifyPlan({ ...fixture, goal, plan, proofStrategies, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("protected_path_write");
  });

  it("rejects dangling evidence references and evidence from another snapshot", () => {
    const fixture = groundedFixture();
    const danglingMaterial = withoutDigest(fixture.plan);
    danglingMaterial.units["unit:a"]!.boundary.evidenceRefs = ["evidence:missing"];
    const dangling = buildSemanticPlan(danglingMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: dangling, hasher: stage5Sha256 }).findings)
      .toContainEqual(expect.objectContaining({ code: "evidence_ref_unresolved", subjectId: "evidence:missing" }));

    const staleMaterial = withoutDigest(fixture.plan);
    staleMaterial.evidence[0]!.snapshotId = "snapshot:other";
    const stale = buildSemanticPlan(staleMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: stale, hasher: stage5Sha256 }).findings)
      .toContainEqual(expect.objectContaining({ code: "evidence_snapshot_mismatch" }));

    const alteredMaterial = withoutDigest(fixture.plan);
    alteredMaterial.evidence[0]!.locator = "fixture:altered";
    const altered = buildSemanticPlan(alteredMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: altered, hasher: stage5Sha256 }).findings)
      .toContainEqual(expect.objectContaining({ code: "evidence_repository_mismatch" }));
  });

  it("fails closed when a writable resource has unknown generated-file provenance", () => {
    const fixture = groundedFixture();
    const resources = structuredClone(fixture.repositoryView.catalog.resources);
    resources["resource:a"]!.generated = {
      state: "unknown",
      reason: "The fixture has no generated-file provenance.",
      evidenceRefs: ["evidence:resource:a"]
    };
    const catalog = new ResourceCatalog({
      schemaVersion: 1,
      repositoryContentDigest: fixture.repositoryView.catalog.repositoryContentDigest,
      resources,
      contains: [...fixture.repositoryView.catalog.contains],
      aliases: [...fixture.repositoryView.catalog.aliases],
      coverage: fixture.repositoryView.catalog.coverage
    });
    const repositoryView = {
      ...fixture.repositoryView,
      resourceCatalogDigest: catalog.digest,
      catalog
    };
    const material = withoutDigest(fixture.plan);
    material.repositoryView.resourceCatalogDigest = catalog.digest;
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, repositoryView, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("resource_generated_state_unknown");
  });

  it("requires role, expansion and granularity decisions to be mutually coherent", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.granularity.feasibility.boundedContext = "unknown";
    material.units["unit:b"]!.role = "composite";
    material.units["unit:root"]!.granularity.integrationObligationId = "validation:other";
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "leaf_granularity_unproven",
      "granularity_role_mismatch",
      "integration_obligation_mismatch"
    ]));
  });

  it("requires repository, resource-intent and integration references to close exactly", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.repositorySurface.resourceRefs.push("resource:missing");
    material.units["unit:a"]!.resourceIntents[0]!.resourceId = "resource:b";
    material.units["unit:root"]!.integration!.criterionIds = ["criterion:missing"];
    material.units["unit:root"]!.integration!.artifactIds = ["artifact:missing"];
    material.units["unit:root"]!.integration!.seamIds = ["seam:missing"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "repository_surface_resource_unresolved",
      "resource_intent_outside_surface",
      "integration_criterion_unresolved",
      "integration_artifact_unresolved",
      "integration_seam_unresolved"
    ]));
  });

  it("requires a seam artifact to name every seam consumer", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.artifacts["artifact:a"]!.consumerUnitIds = ["unit:b"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("seam_artifact_consumer_mismatch");
  });

  it("binds the GoalContract target to the exact RepositoryView tree", () => {
    const fixture = groundedFixture();
    const goalMaterial = structuredClone(fixture.goal);
    Reflect.deleteProperty(goalMaterial, "digest");
    goalMaterial.target.treeSha = "c".repeat(40);
    const goal = buildGoalContract(goalMaterial, stage5Sha256);
    const planMaterial = withoutDigest(fixture.plan);
    planMaterial.goalContract.digest = goal.digest;
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);
    const proofStrategies = rebindProofs(fixture, goal.digest);

    const result = verifyPlan({ ...fixture, goal, plan, proofStrategies, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("goal_repository_tree_mismatch");
  });

  it("binds repository identity and the plan snapshot to the supplied RepositoryView", () => {
    const fixture = groundedFixture();
    const goalMaterial = structuredClone(fixture.goal);
    Reflect.deleteProperty(goalMaterial, "digest");
    goalMaterial.target.repositoryId = "repo:other";
    const goal = buildGoalContract(goalMaterial, stage5Sha256);
    const planMaterial = withoutDigest(fixture.plan);
    planMaterial.goalContract.digest = goal.digest;
    planMaterial.repositorySnapshot.digest = "sha256:other-snapshot";
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);
    const proofStrategies = rebindProofs(fixture, goal.digest);

    const result = verifyPlan({ ...fixture, goal, plan, proofStrategies, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "goal_repository_identity_mismatch",
      "repository_snapshot_mismatch"
    ]));
  });

  it("allows an overlay RepositoryView to advance beyond the GoalContract base tree", () => {
    const fixture = groundedFixture();
    const repositoryView = {
      ...fixture.repositoryView,
      appliedManifestDigests: ["sha256:overlay"],
      treeSha: "c".repeat(40),
      digest: "sha256:overlay-view"
    };
    const planMaterial = withoutDigest(fixture.plan);
    planMaterial.repositoryView = {
      digest: repositoryView.digest,
      treeSha: repositoryView.treeSha,
      resourceCatalogDigest: repositoryView.catalog.digest
    };
    const plan = buildSemanticPlan(planMaterial, stage5Sha256);
    const proofStrategies = fixture.proofStrategies.map((proof) => {
      const material = structuredClone(proof);
      Reflect.deleteProperty(material, "digest");
      return buildProofStrategy({ ...material, repositoryViewDigest: repositoryView.digest }, stage5Sha256);
    });

    expect(verifyPlan({
      ...fixture,
      plan,
      proofStrategies,
      repositoryView,
      hasher: stage5Sha256
    })).toEqual({ ok: true, findings: [] });
  });

  it("surfaces incomplete repository coverage as repository-authority warnings", () => {
    const fixture = groundedFixture();
    const repositoryView = {
      ...fixture.repositoryView,
      model: {
        ...fixture.repositoryView.model,
        coverage: {
          ...fixture.repositoryView.model.coverage,
          disposition: "partial" as const
        }
      }
    };

    const result = verifyPlan({ ...fixture, repositoryView, hasher: stage5Sha256 });

    expect(result.ok).toBe(true);
    expect(result.findings).toContainEqual(expect.objectContaining({
      code: "repository_model_coverage_incomplete",
      severity: "warning",
      authority: "repository"
    }));
  });

  it("rejects duplicate proof and validation identities independent of input order", () => {
    const fixture = groundedFixture();
    const proofStrategies = fixture.proofStrategies.concat(fixture.proofStrategies[0]!);
    const proofCodes = (proofs: typeof proofStrategies) => verifyPlan({
      ...fixture,
      proofStrategies: proofs,
      hasher: stage5Sha256
    }).findings.map(({ code }) => code);
    expect(proofCodes(proofStrategies)).toEqual(proofCodes([...proofStrategies].reverse()));
    expect(proofCodes(proofStrategies)).toContain("proof_strategy_id_duplicate");

    const material = withoutDigest(fixture.plan);
    material.units["unit:b"]!.validation[0]!.obligationId = "validation:a";
    const plan = buildSemanticPlan(material, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan, hasher: stage5Sha256 }).findings.map(({ code }) => code))
      .toContain("validation_obligation_id_duplicate");
  });

  it("does not order same-resource writers through a disjoint-resource hop", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:root"]!.resourceIntents = [{
      resourceId: "resource:a",
      access: "modify",
      ownerPhase: "integration",
      inputArtifactId: "artifact:b",
      outputArtifactId: "artifact:root",
      evidenceRefs: ["evidence:architecture"],
      epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:architecture"] }
    }];
    material.units["unit:root"]!.produces = ["artifact:root"];
    material.artifacts["artifact:root"] = {
      id: "artifact:root",
      producerUnitId: "unit:root",
      consumerUnitIds: [],
      artifactType: "source_change",
      materialization: "patch",
      expectedPaths: ["src/a.ts"]
    };
    material.units["unit:root"]!.repositorySurface.resourceRefs.push("resource:a");
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("resource_double_writer");
  });

  it("reports unknown observe-modify overlap", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.resourceIntents.push({
      resourceId: "resource:missing",
      access: "observe",
      evidenceRefs: ["evidence:a"],
      epistemic: { state: "unknown", reason: "Not inspected.", evidenceRefs: [] }
    });
    material.units["unit:a"]!.repositorySurface.resourceRefs.push("resource:missing");
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toContain("resource_overlap_unknown");
  });

  it("rejects empty scopes and duplicate resource intents before compilation", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:a"]!.repositorySurface = { resourceRefs: [], pathHints: [] };
    material.units["unit:a"]!.resourceIntents.push(structuredClone(material.units["unit:a"]!.resourceIntents[0]!));
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "unit_scope_empty",
      "resource_intent_duplicate"
    ]));
  });

  it("accepts a composite scope derived from its descendant envelopes", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:root"]!.repositorySurface = { resourceRefs: [], pathHints: [] };
    const plan = buildSemanticPlan(material, stage5Sha256);

    expect(verifyPlan({ ...fixture, plan, hasher: stage5Sha256 })).toEqual({ ok: true, findings: [] });
  });

  it("requires resource inputs to name an overlapping predecessor writer", () => {
    const fixture = groundedFixture();
    const modifyMaterial = withoutDigest(fixture.plan);
    modifyMaterial.units["unit:b"]!.resourceIntents[0]!.inputArtifactId = "artifact:a";
    const invalidModify = buildSemanticPlan(modifyMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: invalidModify, hasher: stage5Sha256 }).findings)
      .toContainEqual(expect.objectContaining({
        code: "resource_input_predecessor_mismatch",
        subjectId: "unit:b"
      }));

    const observeMaterial = withoutDigest(fixture.plan);
    observeMaterial.units["unit:root"]!.resourceIntents.push({
      resourceId: "resource:b",
      access: "observe",
      inputArtifactId: "artifact:a",
      evidenceRefs: ["evidence:architecture"],
      epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:architecture"] }
    });
    const invalidObserve = buildSemanticPlan(observeMaterial, stage5Sha256);
    expect(verifyPlan({ ...fixture, plan: invalidObserve, hasher: stage5Sha256 }).findings)
      .toContainEqual(expect.objectContaining({
        code: "resource_input_predecessor_mismatch",
        subjectId: "unit:root"
      }));
  });

  it("keeps artifact paths inside the exact write surface and outside protected paths", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.artifacts["artifact:a"]!.expectedPaths = ["src/other.ts", "tests/protected-oracle.ts"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "artifact_path_outside_write_surface",
      "artifact_protected_path"
    ]));
  });

  it("requires an expanded split composite to own at least two direct children", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.units["unit:b"]!.parentId = "unit:a";
    const plan = buildSemanticPlan(material, stage5Sha256);

    expect(verifyPlan({ ...fixture, plan, hasher: stage5Sha256 }).findings)
      .toContainEqual(expect.objectContaining({
        code: "composite_split_children_insufficient",
        subjectId: "unit:root"
      }));
  });

  it("rejects contract-invalid artifact, seam and path material before compilation", () => {
    const fixture = groundedFixture();
    const material = withoutDigest(fixture.plan);
    material.artifacts["artifact:a"]!.consumerUnitIds.push("unit:a");
    material.seams["seam:a-b"]!.consumerUnitIds.push("unit:a");
    material.artifacts["artifact:a"]!.materialization = "files";
    material.artifacts["artifact:a"]!.expectedPaths = [];
    material.units["unit:b"]!.repositorySurface.pathHints = ["../src/b.ts", "./"];
    material.artifacts["artifact:b"]!.expectedPaths = ["C:\\repo\\src\\b.ts"];
    const plan = buildSemanticPlan(material, stage5Sha256);

    const result = verifyPlan({ ...fixture, plan, hasher: stage5Sha256 });

    expect(result.findings.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "artifact_self_consumer",
      "seam_self_consumer",
      "artifact_files_paths_missing",
      "repository_path_invalid",
      "artifact_path_invalid"
    ]));
  });
});

function withoutDigest(plan: ReturnType<typeof stage5Fixture>["plan"]) {
  const material = structuredClone(plan);
  Reflect.deleteProperty(material, "digest");
  return material;
}

function groundedFixture(): ReturnType<typeof stage5Fixture> {
  const fixture = stage5Fixture();
  const material = withoutDigest(fixture.plan);
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

function rebindProofs(fixture: ReturnType<typeof stage5Fixture>, goalContractDigest: string) {
  return fixture.proofStrategies.map((proof) => {
    const material = structuredClone(proof);
    Reflect.deleteProperty(material, "digest");
    return buildProofStrategy({ ...material, goalContractDigest }, stage5Sha256);
  });
}
