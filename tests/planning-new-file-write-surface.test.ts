import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildGoalContract,
  buildProofStrategy,
  buildSemanticPlan,
  type DigestHasher,
  type SemanticPlanMaterial
} from "@manyhands/contracts";
import { verifyPlan } from "@manyhands/decomposer";
import { ResourceCatalog, type RepositoryView } from "@manyhands/repository-index";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const ROOT_PACKAGE = "resource:package-root";
const EXISTING_FILE = "resource:existing-file";
const EVIDENCE = "evidence:root";
const CRITERION = "criterion:feature";

/**
 * A live run planned two new modules and every expected path was rejected as
 * `artifact_path_outside_write_surface`. The cause is not the plan.
 *
 * A file that does not exist yet has no catalog resource, so the only resource
 * that can authorize writing it is the package that contains it. A package
 * rooted at the repository is catalogued as `package:.` with an empty path, and
 * `resourcePaths` turned that into the literal segment "." — which is a prefix
 * of nothing. In a single-package repository, which is most repositories, no
 * resource could authorize any new file at all.
 */
describe("Write surface for a file that does not exist yet", () => {
  it("lets the repository-root package authorize a new path", () => {
    const view = repositoryView();
    const goal = goalContract(view);
    const plan = buildSemanticPlan(material(goal, view), sha256);
    const proof = buildProofStrategy({
      id: "proof:validation:leaf",
      revision: 1,
      goalContractDigest: goal.digest,
      criterionId: CRITERION,
      obligationId: "validation:leaf",
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: view.digest,
      procedureRef: "command:node-test",
      environmentPolicyDigest: "sha256:environment",
      independence: "independent_required"
    }, sha256);

    const verification = verifyPlan({
      plan,
      goal,
      proofStrategies: [proof],
      repositoryView: view,
      hasher: sha256
    });

    expect(verification.findings
      .filter(({ severity }) => severity === "error")
      .map(({ code, message }) => `${code}: ${message}`)
    ).toEqual([]);
  });

  it("still refuses a path outside a package rooted below the repository", () => {
    // Widening the root must not widen every package: a package at `src` owns
    // `src/...` and nothing else.
    const view = repositoryView({ packageRootPath: "src" });
    const goal = goalContract(view);
    const escaped = material(goal, view);
    escaped.units["unit:leaf"]!.repositorySurface.pathHints = ["docs/notes.md"];
    escaped.artifacts["artifact:leaf"]!.expectedPaths = ["docs/notes.md"];

    const verification = verifyPlan({
      plan: buildSemanticPlan(escaped, sha256),
      goal,
      proofStrategies: [],
      repositoryView: view,
      hasher: sha256
    });

    expect(verification.findings.map(({ code }) => code))
      .toContain("artifact_path_outside_write_surface");
  });
});

function material(goal: ReturnType<typeof goalContract>, view: RepositoryView): SemanticPlanMaterial {
  const epistemic = { state: "known" as const, confidence: "high" as const, evidenceRefs: [EVIDENCE] };
  return {
    id: "plan:new-file",
    revision: 1,
    goalContract: { id: goal.id, revision: goal.revision, digest: goal.digest },
    repositorySnapshot: { ...view.model.snapshot },
    repositoryView: {
      digest: view.digest,
      treeSha: view.treeSha,
      resourceCatalogDigest: view.catalog.digest
    },
    rootUnitId: "unit:leaf",
    units: {
      "unit:leaf": {
        id: "unit:leaf",
        role: "leaf",
        title: "New module",
        objective: "Add a module that does not exist yet.",
        boundary: { kind: "module", evidenceRefs: [EVIDENCE] },
        outcomes: [{ id: "outcome:leaf", statement: "The module exists." }],
        criteria: [{ criterionId: "criterion:leaf", statement: "The module works.", sourceCriterionId: CRITERION }],
        repositorySurface: { resourceRefs: [ROOT_PACKAGE], pathHints: ["src/tokenizer.js"] },
        resourceIntents: [{
          resourceId: ROOT_PACKAGE,
          access: "modify",
          ownerPhase: "implementation",
          outputArtifactId: "artifact:leaf",
          evidenceRefs: [EVIDENCE],
          epistemic
        }],
        consumes: [],
        produces: ["artifact:leaf"],
        seamRefs: [],
        validation: [{
          obligationId: "validation:leaf",
          criterionId: "criterion:leaf",
          proofStrategyId: "proof:validation:leaf",
          layer: "unit",
          severity: "required",
          acceptableEvidence: ["test_result"],
          baselinePolicy: "required",
          negativeControl: "when_feasible",
          flakyPolicy: "forbid"
        }],
        uncertainty: [],
        granularity: {
          disposition: "leaf",
          feasibility: {
            coherentResponsibility: true,
            boundedContext: "yes",
            boundedChangeSurface: "yes",
            independentlyValidatable: "yes",
            unresolvedArchitectureDecision: false
          },
          splitReasons: [],
          expectedBenefits: [],
          expectedCosts: [],
          evidenceRefs: [EVIDENCE],
          epistemic
        },
        expansion: "leaf"
      }
    },
    seams: {},
    artifacts: {
      "artifact:leaf": {
        id: "artifact:leaf",
        producerUnitId: "unit:leaf",
        consumerUnitIds: [],
        artifactType: "source_change",
        materialization: "patch",
        expectedPaths: ["src/tokenizer.js"]
      }
    },
    decisions: [],
    evidence: structuredClone(view.model.evidence),
    status: "ready"
  } as SemanticPlanMaterial;
}

function goalContract(view: RepositoryView) {
  return buildGoalContract({
    id: "goal:new-file",
    revision: 1,
    goal: "Add a module that does not exist yet.",
    acceptanceCriteria: [{
      id: CRITERION,
      statement: "The new module behaves correctly.",
      required: true,
      level: "product",
      protectedReferences: [],
      verification: {
        allowedProofs: [{ mode: "executable", authority: "orchestrator_deterministic" }],
        independence: "independent_required"
      }
    }],
    constraints: [],
    qualityAttributes: [],
    target: { repositoryId: "repo:new-file", baseCommit: "a".repeat(40), treeSha: view.treeSha }
  }, sha256);
}

function repositoryView(options: { packageRootPath?: string } = {}): RepositoryView {
  const packageRootPath = options.packageRootPath ?? "";
  const evidence = [
    entry(EVIDENCE, "relationship", "path:src"),
    entry(`evidence:${EXISTING_FILE}`, "file", "path:src/existing.js")
  ];
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    resources: {
      [ROOT_PACKAGE]: {
        id: ROOT_PACKAGE,
        kind: "package" as const,
        canonicalLocator: `package:${packageRootPath || "."}`,
        path: packageRootPath,
        evidenceRefs: [EVIDENCE],
        epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [EVIDENCE] },
        generated: { state: "source" as const, reason: "Package boundary.", evidenceRefs: [EVIDENCE] }
      },
      [EXISTING_FILE]: {
        id: EXISTING_FILE,
        kind: "path" as const,
        canonicalLocator: "path:src/existing.js",
        path: "src/existing.js",
        gitEntryKind: "file" as const,
        evidenceRefs: [`evidence:${EXISTING_FILE}`],
        epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [`evidence:${EXISTING_FILE}`] },
        generated: { state: "source" as const, reason: "Source file.", evidenceRefs: [`evidence:${EXISTING_FILE}`] }
      }
    },
    contains: [],
    aliases: [],
    coverage: { state: "known", evidenceRefs: [EVIDENCE] }
  });
  return {
    schemaVersion: 1,
    baseModelDigest: "sha256:model",
    appliedManifestDigests: [],
    treeSha: "b".repeat(40),
    contentDigest: "sha256:content",
    resourceCatalogDigest: catalog.digest,
    digest: "sha256:view",
    catalog,
    model: {
      snapshot: { id: "snapshot:new-file", digest: "sha256:snapshot" },
      repositoryId: "repo:new-file",
      baseCommit: "a".repeat(40),
      treeSha: "b".repeat(40),
      coverage: {
        treeEntryCount: 1,
        sourceEntryCount: 1,
        parsedSourceCount: 1,
        unsupportedEntryCount: 0,
        disposition: "known",
        evidenceRefs: [EVIDENCE]
      },
      evidence
    } as RepositoryView["model"]
  } satisfies RepositoryView;
}

function entry(id: string, kind: "file" | "relationship", locator: string) {
  return {
    id,
    snapshotId: "snapshot:new-file",
    kind,
    locator,
    digest: sha256(`${id}\0${locator}`),
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [id] }
  };
}
