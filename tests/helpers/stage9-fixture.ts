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

export const stage9Sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

export interface Stage9Fixture {
  goal: GoalContract;
  plan: SemanticPlan;
  proofStrategies: ProofStrategy[];
  repositoryView: RepositoryView;
}

/**
 * Two genuinely independent leaves under one composite.
 *
 * The Stage 5 fixture chains its leaves — `unit:b` consumes `artifact:a` — so
 * only one leaf is ever ready at a time and it cannot observe parallelism or a
 * resource conflict. Here `unit:a` and `unit:b` share no artifact and claim
 * disjoint resources, and the composite claims a resource of its own, so the
 * parent has something to write that is legitimately its.
 */
export function stage9Fixture(): Stage9Fixture {
  const evidence = fixtureEvidence();
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    resources: {
      "resource:a": resource("resource:a", "src/a.ts"),
      "resource:b": resource("resource:b", "src/b.ts"),
      "resource:wire": resource("resource:wire", "src/app/wire.ts")
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
        treeEntryCount: 3,
        sourceEntryCount: 3,
        parsedSourceCount: 3,
        unsupportedEntryCount: 0,
        disposition: "known",
        evidenceRefs: ["evidence:architecture"]
      },
      evidence: structuredClone(evidence)
    } as RepositoryView["model"]
  } satisfies RepositoryView;

  const goal = buildGoalContract({
    id: "goal:stage9",
    revision: 1,
    goal: "Implement two independent modules and wire them together.",
    acceptanceCriteria: [{
      id: "criterion:feature",
      statement: "The wired feature behaves correctly.",
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
  }, stage9Sha256);

  const proofStrategies = [
    proof("proof:feature", "validation:root"),
    proof("proof:a", "validation:a"),
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
    }, stage9Sha256);
  }

  const plan = buildSemanticPlan(planMaterial(goal, repositoryView, evidence), stage9Sha256);
  return { goal, plan, proofStrategies, repositoryView };
}

function planMaterial(
  goal: GoalContract,
  view: RepositoryView,
  evidence: SemanticPlanMaterial["evidence"]
): SemanticPlanMaterial {
  const validation = (obligationId: string, proofStrategyId: string) => ({
    obligationId,
    criterionId: "criterion:feature",
    proofStrategyId,
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
    id: "plan:stage9",
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
        title: "Wired feature",
        objective: "Wire both modules together.",
        boundary: { kind: "vertical_slice", evidenceRefs: ["evidence:architecture"] },
        outcomes: [{ id: "outcome:integrated", statement: "The wired feature works." }],
        criteria: [{ criterionId: "criterion:feature", statement: "Wired behavior works.", sourceCriterionId: "criterion:feature" }],
        repositorySurface: {
          resourceRefs: ["resource:a", "resource:b", "resource:wire"],
          pathHints: ["src/a.ts", "src/b.ts", "src/app/wire.ts"]
        },
        resourceIntents: [{
          resourceId: "resource:wire",
          access: "modify",
          ownerPhase: "integration",
          outputArtifactId: "artifact:root",
          evidenceRefs: ["evidence:wire"],
          epistemic: { state: "known", confidence: "high", evidenceRefs: ["evidence:wire"] }
        }],
        consumes: ["artifact:a", "artifact:b"],
        produces: ["artifact:root"],
        seamRefs: ["seam:a-root", "seam:b-root"],
        validation: [validation("validation:root", "proof:feature")],
        uncertainty: [],
        granularity: granularity("split"),
        expansion: "expanded",
        integration: {
          obligationId: "validation:root",
          objective: "Wire module A and module B.",
          criterionIds: ["criterion:feature"],
          proofStrategyId: "proof:feature",
          artifactIds: ["artifact:a", "artifact:b"],
          seamIds: ["seam:a-root", "seam:b-root"]
        }
      },
      "unit:a": leaf("unit:a", "Module A", "resource:a", "src/a.ts", "artifact:a", "validation:a", "proof:a", "seam:a-root"),
      "unit:b": leaf("unit:b", "Module B", "resource:b", "src/b.ts", "artifact:b", "validation:b", "proof:b", "seam:b-root")
    },
    seams: {
      "seam:a-root": seam("seam:a-root", "unit:a", "artifact:a", "Module A exports createA(): A.", "validation:root"),
      "seam:b-root": seam("seam:b-root", "unit:b", "artifact:b", "Module B exports createB(): B.", "validation:root")
    },
    artifacts: {
      "artifact:a": artifact("artifact:a", "unit:a", ["unit:root"], ["src/a.ts"]),
      "artifact:b": artifact("artifact:b", "unit:b", ["unit:root"], ["src/b.ts"]),
      "artifact:root": artifact("artifact:root", "unit:root", [], ["src/app/wire.ts"])
    },
    decisions: [],
    evidence,
    status: "ready"
  };

  function leaf(
    id: string,
    title: string,
    resourceId: string,
    path: string,
    artifactId: string,
    obligationId: string,
    proofStrategyId: string,
    seamId: string
  ) {
    return {
      id,
      parentId: "unit:root",
      role: "leaf" as const,
      title,
      objective: `Implement ${title}.`,
      boundary: { kind: "module" as const, evidenceRefs: [`evidence:${id}`] },
      outcomes: [{ id: `outcome:${id}`, statement: `${title} exposes its contract.` }],
      criteria: [{ criterionId: "criterion:feature", statement: `${title} supports the feature.`, sourceCriterionId: "criterion:feature" }],
      repositorySurface: { resourceRefs: [resourceId], pathHints: [path] },
      resourceIntents: [{
        resourceId,
        access: "modify" as const,
        ownerPhase: "implementation" as const,
        outputArtifactId: artifactId,
        evidenceRefs: [`evidence:${id}`],
        epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [`evidence:${id}`] }
      }],
      consumes: [],
      produces: [artifactId],
      seamRefs: [seamId],
      validation: [validation(obligationId, proofStrategyId)],
      uncertainty: [],
      granularity: granularity("leaf"),
      expansion: "leaf" as const
    };
  }

  function seam(id: string, producerUnitId: string, artifactId: string, specification: string, obligationId: string) {
    return {
      id,
      kind: "api" as const,
      specification,
      producerUnitId,
      consumerUnitIds: ["unit:root"],
      semanticFacts: { return: "Contract" },
      compatibility: { mode: "exact" as const, rules: ["The return type is stable."] },
      artifactId,
      validationObligationIds: [obligationId]
    };
  }

  function artifact(id: string, producerUnitId: string, consumerUnitIds: string[], expectedPaths: string[]) {
    return {
      id,
      producerUnitId,
      consumerUnitIds,
      artifactType: "source_change" as const,
      materialization: "patch" as const,
      expectedPaths
    };
  }
}

function fixtureEvidence(): SemanticPlanMaterial["evidence"] {
  return [
    evidence("evidence:architecture", "relationship", "path:src"),
    evidence("evidence:unit:a", "file", "path:src/a.ts"),
    evidence("evidence:unit:b", "file", "path:src/b.ts"),
    evidence("evidence:wire", "file", "path:src/app/wire.ts")
  ];

  function evidence(id: string, kind: "file" | "relationship", locator: string) {
    return {
      id,
      snapshotId: "snapshot:fixture",
      kind,
      locator,
      digest: stage9Sha256(`${id}\0${locator}`),
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
