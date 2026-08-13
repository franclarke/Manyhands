import { createHash } from "node:crypto";
import {
  buildGoalContract,
  buildProofStrategy,
  buildSemanticPlan,
  type DigestHasher,
  type GoalContract,
  type ProofStrategy,
  type SemanticPlan,
  type SemanticPlanMaterial
} from "@manyhands/contracts";
import { ResourceCatalog, type RepositoryView } from "@manyhands/repository-index";

export const stage5Sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export interface Stage5Fixture {
  goal: GoalContract;
  plan: SemanticPlan;
  proofStrategies: ProofStrategy[];
  repositoryView: RepositoryView;
}

export function stage5Fixture(): Stage5Fixture {
  const evidence = fixtureEvidence();
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    resources: {
      "resource:a": resource("resource:a", "src/a.ts"),
      "resource:b": resource("resource:b", "src/b.ts")
    },
    contains: [],
    aliases: [],
    coverage: { state: "known", evidenceRefs: ["evidence:catalog"] }
  });
  const repositoryView = {
    schemaVersion: 1,
    baseModelDigest: "sha256:model",
    appliedManifestDigests: [],
    treeSha: "b".repeat(40),
    contentDigest: "sha256:content",
    resourceCatalogDigest: catalog.digest,
    digest: "sha256:view",
    catalog,
    model: {
      snapshot: { id: "snapshot:fixture", digest: "sha256:snapshot" },
      repositoryId: "repo:fixture",
      baseCommit: "a".repeat(40),
      treeSha: "b".repeat(40),
      coverage: {
        treeEntryCount: 2,
        sourceEntryCount: 2,
        parsedSourceCount: 2,
        unsupportedEntryCount: 0,
        disposition: "known",
        evidenceRefs: ["evidence:architecture"]
      },
      evidence: structuredClone(evidence)
    } as RepositoryView["model"]
  } satisfies RepositoryView;
  const goal = buildGoalContract({
    id: "goal:feature",
    revision: 1,
    goal: "Implement the feature across two modules.",
    acceptanceCriteria: [{
      id: "criterion:feature",
      statement: "The integrated feature behaves correctly.",
      required: true,
      level: "product",
      protectedReferences: ["path:tests/protected-oracle.ts"],
      verification: {
        allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }],
        independence: "independent_required"
      }
    }],
    constraints: [],
    qualityAttributes: [],
    target: { repositoryId: "repo:fixture", baseCommit: "a".repeat(40), treeSha: repositoryView.treeSha }
  }, stage5Sha256);
  const proofStrategies = [
    proof("proof:feature", "validation:root"),
    proof("proof:a", "validation:a"),
    proof("proof:a-child", "validation:a-child"),
    proof("proof:a-child-2", "validation:a-child-2"),
    proof("proof:b", "validation:b")
  ];
  function proof(id: string, obligationId: string) {
    return buildProofStrategy({
    id,
    revision: 1,
    goalContractDigest: goal.digest,
    criterionId: "criterion:feature",
    obligationId,
    mode: "executable",
    authority: "orchestrator_deterministic",
    repositoryViewDigest: repositoryView.digest,
    procedureRef: "command:pnpm-test",
    selectorDigest: "sha256:selector",
    environmentPolicyDigest: "sha256:environment",
    independence: "independent_required"
    }, stage5Sha256);
  }
  const plan = buildSemanticPlan(planMaterial(goal, repositoryView, evidence), stage5Sha256);
  return { goal, plan, proofStrategies, repositoryView };
}

function planMaterial(
  goal: GoalContract,
  view: RepositoryView,
  evidence: SemanticPlanMaterial["evidence"]
): SemanticPlanMaterial {
  const validation = (obligationId: string) => ({
    obligationId,
    criterionId: "criterion:feature",
    proofStrategyId: "proof:feature",
    layer: "integration" as const,
    severity: "required" as const,
    acceptableEvidence: ["test_result" as const],
    baselinePolicy: "required" as const,
    negativeControl: "when_feasible" as const,
    flakyPolicy: "forbid" as const
  });
  const granularity = (disposition: "leaf" | "split") => ({
    disposition,
    feasibility: {
      coherentResponsibility: true,
      boundedContext: "yes" as const,
      boundedChangeSurface: "yes" as const,
      independentlyValidatable: "yes" as const,
      unresolvedArchitectureDecision: false
    },
    splitReasons: disposition === "split" ? ["integration_boundary" as const] : [],
    expectedBenefits: disposition === "split" ? ["Separate module responsibilities."] : [],
    expectedCosts: disposition === "split" ? ["One explicit integration seam."] : [],
    ...(disposition === "split" ? { integrationObligationId: "validation:root" } : {}),
    evidenceRefs: ["evidence:architecture"],
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: ["evidence:architecture"] }
  });
  return {
    id: "plan:feature",
    revision: 1,
    goalContract: { id: goal.id, revision: goal.revision, digest: goal.digest },
    repositorySnapshot: { id: "snapshot:fixture", digest: "sha256:snapshot" },
    repositoryView: {
      digest: view.digest,
      treeSha: view.treeSha,
      resourceCatalogDigest: view.catalog.digest
    },
    rootUnitId: "unit:root",
    units: {
      "unit:root": {
        id: "unit:root",
        role: "composite",
        title: "Integrated feature",
        objective: "Own integration of both modules.",
        boundary: { kind: "vertical_slice", evidenceRefs: ["evidence:architecture"] },
        outcomes: [{ id: "outcome:integrated", statement: "The combined feature works." }],
        criteria: [{ criterionId: "criterion:feature", statement: "Integrated behavior works.", sourceCriterionId: "criterion:feature" }],
        repositorySurface: { resourceRefs: ["resource:a", "resource:b"], pathHints: ["src/a.ts", "src/b.ts"] },
        resourceIntents: [],
        consumes: ["artifact:a", "artifact:b"],
        produces: [],
        seamRefs: ["seam:a-b"],
        validation: [validation("validation:root")],
        uncertainty: [],
        granularity: granularity("split"),
        expansion: "expanded",
        integration: {
          obligationId: "validation:root",
          objective: "Integrate module A with module B.",
          criterionIds: ["criterion:feature"],
          proofStrategyId: "proof:feature",
          artifactIds: ["artifact:a", "artifact:b"],
          seamIds: ["seam:a-b"]
        }
      },
      "unit:a": {
        id: "unit:a",
        parentId: "unit:root",
        role: "leaf",
        title: "Module A",
        objective: "Implement module A.",
        boundary: { kind: "module", evidenceRefs: ["evidence:a"] },
        outcomes: [{ id: "outcome:a", statement: "Module A exposes its contract." }],
        criteria: [{ criterionId: "criterion:feature", statement: "Module A supports the feature.", sourceCriterionId: "criterion:feature" }],
        repositorySurface: { resourceRefs: ["resource:a"], pathHints: ["src/a.ts"] },
        resourceIntents: [{
          resourceId: "resource:a",
          access: "modify",
          ownerPhase: "implementation",
          outputArtifactId: "artifact:a",
          evidenceRefs: ["evidence:a"],
          epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:a"] }
        }],
        consumes: [],
        produces: ["artifact:a"],
        seamRefs: ["seam:a-b"],
        validation: [{ ...validation("validation:a"), proofStrategyId: "proof:a" }],
        uncertainty: [],
        granularity: granularity("leaf"),
        expansion: "leaf"
      },
      "unit:b": {
        id: "unit:b",
        parentId: "unit:root",
        role: "leaf",
        title: "Module B",
        objective: "Implement module B against A.",
        boundary: { kind: "module", evidenceRefs: ["evidence:b"] },
        outcomes: [{ id: "outcome:b", statement: "Module B consumes A." }],
        criteria: [{ criterionId: "criterion:feature", statement: "Module B supports the feature.", sourceCriterionId: "criterion:feature" }],
        repositorySurface: { resourceRefs: ["resource:b"], pathHints: ["src/b.ts"] },
        resourceIntents: [{
          resourceId: "resource:b",
          access: "modify",
          ownerPhase: "implementation",
          outputArtifactId: "artifact:b",
          evidenceRefs: ["evidence:b"],
          epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:b"] }
        }],
        consumes: ["artifact:a"],
        produces: ["artifact:b"],
        seamRefs: ["seam:a-b"],
        validation: [{ ...validation("validation:b"), proofStrategyId: "proof:b" }],
        uncertainty: [],
        granularity: granularity("leaf"),
        expansion: "leaf"
      }
    },
    seams: {
      "seam:a-b": {
        id: "seam:a-b",
        kind: "api",
        specification: "Module A exports createFeature(): Feature.",
        producerUnitId: "unit:a",
        consumerUnitIds: ["unit:b", "unit:root"],
        semanticFacts: { return: "Feature" },
        compatibility: { mode: "exact", rules: ["The return type is stable."] },
        artifactId: "artifact:a",
        validationObligationIds: ["validation:b"]
      }
    },
    artifacts: {
      "artifact:a": {
        id: "artifact:a",
        producerUnitId: "unit:a",
        consumerUnitIds: ["unit:b", "unit:root"],
        artifactType: "source_change",
        materialization: "patch",
        expectedPaths: ["src/a.ts"]
      },
      "artifact:b": {
        id: "artifact:b",
        producerUnitId: "unit:b",
        consumerUnitIds: ["unit:root"],
        artifactType: "source_change",
        materialization: "patch",
        expectedPaths: ["src/b.ts"]
      }
    },
    decisions: [],
    evidence,
    status: "ready"
  };
}

function fixtureEvidence(): SemanticPlanMaterial["evidence"] {
  return [
    evidence("evidence:architecture", "relationship", "path:src"),
    evidence("evidence:a", "file", "path:src/a.ts"),
    evidence("evidence:b", "file", "path:src/b.ts")
  ];

  function evidence(id: string, kind: "file" | "relationship", locator: string) {
    return {
      id,
      snapshotId: "snapshot:fixture",
      kind,
      locator,
      digest: stage5Sha256(`${id}\0${locator}`),
      epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [id] }
    };
  }
}

function resource(id: string, path: string) {
  return {
    id,
    kind: "path" as const,
    canonicalLocator: `path:${path}`,
    path,
    gitEntryKind: "file" as const,
    evidenceRefs: [`evidence:${id}`],
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [`evidence:${id}`] },
    generated: { state: "source" as const, reason: "Fixture source file.", evidenceRefs: [`evidence:${id}`] }
  };
}
