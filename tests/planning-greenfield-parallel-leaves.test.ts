import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildGoalContract,
  buildProofStrategy,
  buildSemanticPlan,
  type DigestHasher,
  type SemanticPlanMaterial
} from "@manyhands/contracts";
import { compilePlan, verifyPlan } from "@manyhands/decomposer";
import { ResourceCatalog, type RepositoryView } from "@manyhands/repository-index";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const ROOT_PACKAGE = "resource:package-root";
const README = "resource:readme";
const EVIDENCE = "evidence:root";
const CRITERION = "criterion:product";
const ROOT_CRITERION = "criterion:root-refinement";

const MODULES = ["domain", "calculation", "storage"] as const;

/**
 * A greenfield run planned a composite root over five sibling modules and every
 * expected path came back as `artifact_path_outside_write_surface`.
 *
 * `ls-tree -r` lists blobs, so a directory is never a resource, and a file that
 * does not exist yet has no resource either. The only resource that could
 * authorise a new file was therefore the repository-root package — which every
 * sibling would have to claim, making all of them overlap and forcing a chain.
 * A repository with nothing in it could not host two modules built at once.
 *
 * A directory named by a plan is a resource whose contents are known to be
 * empty, and two disjoint directories do not overlap.
 */
describe("Greenfield planning with parallel leaves", () => {
  it("authorises each leaf to create its own new directory", () => {
    const view = greenfieldView();
    const goal = goalContract(view);
    const plan = buildSemanticPlan(material(goal, view), sha256);

    const verification = verifyPlan({
      plan,
      goal,
      proofStrategies: proofStrategies(goal, view),
      repositoryView: view,
      hasher: sha256
    });

    const resourceFindings = verification.findings
      .filter(({ severity }) => severity === "error")
      .filter(({ code }) => code === "resource_unresolved" ||
        code === "artifact_path_outside_write_surface" ||
        code === "resource_double_writer" ||
        code === "resource_overlap_unknown" ||
        code === "resource_intent_outside_surface")
      .map(({ code, message }) => `${code}: ${message}`);

    expect(resourceFindings).toEqual([]);
  });

  it("compiles the directory claims into the graph", () => {
    const view = greenfieldView();
    const goal = goalContract(view);
    const compiled = compilePlan({
      plan: buildSemanticPlan(material(goal, view), sha256),
      goal,
      proofStrategies: proofStrategies(goal, view),
      repositoryView: view,
      hasher: sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });

    expect(compiled.ok ? [] : compiled.findings.map(({ code, message }) => `${code}: ${message}`)).toEqual([]);
  });

  it("keeps sibling directories disjoint so the leaves run at once", () => {
    const catalog = greenfieldView().catalog;
    expect(catalog.overlaps("path:src/domain", "path:src/calculation")).toBe("no");
    expect(catalog.overlaps("path:src/domain", "path:src/storage")).toBe("no");
  });

  it("still reports a directory as containing the files under it", () => {
    const catalog = greenfieldView().catalog;
    expect(catalog.overlaps("path:src/domain", "path:src/domain/index.js")).toBe("yes");
  });
});

function material(goal: ReturnType<typeof goalContract>, view: RepositoryView): SemanticPlanMaterial {
  const epistemic = { state: "known" as const, confidence: "high" as const, evidenceRefs: [EVIDENCE] };
  const allPaths = MODULES.flatMap((module) => modulePaths(module));
  const units: Record<string, unknown> = {
    "unit:root": {
      id: "unit:root",
      role: "composite",
      title: "Cuentas Claras",
      objective: "Own the boundaries between the modules and prove they hold.",
      boundary: { kind: "vertical_slice", evidenceRefs: [EVIDENCE] },
      outcomes: [{ id: "outcome:integrated", statement: "The modules work together." }],
      criteria: [{
        criterionId: ROOT_CRITERION,
        statement: "The integrated behaviour satisfies the supplied criterion.",
        sourceCriterionId: CRITERION
      }],
      repositorySurface: { resourceRefs: [ROOT_PACKAGE], pathHints: allPaths },
      resourceIntents: [],
      consumes: MODULES.map((module) => `artifact:${module}-change`),
      produces: [],
      seamRefs: [],
      validation: [{
        obligationId: "validation:integration",
        criterionId: ROOT_CRITERION,
        proofStrategyId: "proof:validation:integration",
        layer: "integration",
        severity: "required",
        acceptableEvidence: ["test_result"],
        baselinePolicy: "required",
        negativeControl: "when_feasible",
        flakyPolicy: "forbid",
        evidence: {
          kind: "focused_command",
          selectors: allPaths.filter((path) => path.endsWith(".test.js")),
          references: allPaths.filter((path) => path.endsWith(".test.js"))
        }
      }],
      uncertainty: [],
      granularity: {
        disposition: "split",
        feasibility: feasible(),
        splitReasons: ["integration_boundary"],
        expectedBenefits: ["Each module is validated on its own."],
        expectedCosts: ["The seams between modules have to stay compatible."],
        integrationObligationId: "validation:integration",
        evidenceRefs: [EVIDENCE],
        epistemic
      },
      expansion: "expanded",
      integration: {
        obligationId: "validation:integration",
        proofStrategyId: "proof:validation:integration",
        objective: "Compose every module change and prove the seams.",
        criterionIds: [ROOT_CRITERION],
        artifactIds: MODULES.map((module) => `artifact:${module}-change`),
        seamIds: []
      }
    }
  };
  const artifacts: Record<string, unknown> = {};
  for (const module of MODULES) {
    const paths = modulePaths(module);
    units[`unit:${module}`] = {
      id: `unit:${module}`,
      parentId: "unit:root",
      role: "leaf",
      title: `${module} module`,
      objective: `Implement the ${module} module.`,
      boundary: { kind: "module", evidenceRefs: [EVIDENCE] },
      outcomes: [{ id: `outcome:${module}`, statement: `The ${module} module exists.` }],
      criteria: [{
        criterionId: `criterion:${module}`,
        statement: `The ${module} module supports the integrated behaviour.`,
        sourceCriterionId: ROOT_CRITERION
      }],
      repositorySurface: { resourceRefs: [`path:src/${module}`], pathHints: paths },
      resourceIntents: [{
        resourceId: `path:src/${module}`,
        access: "modify",
        ownerPhase: "implementation",
        outputArtifactId: `artifact:${module}-change`,
        evidenceRefs: [EVIDENCE],
        epistemic
      }],
      consumes: [],
      produces: [`artifact:${module}-change`],
      seamRefs: [],
      validation: [{
        obligationId: `validation:${module}`,
        criterionId: `criterion:${module}`,
        proofStrategyId: `proof:validation:${module}`,
        layer: "unit",
        severity: "required",
        acceptableEvidence: ["test_result"],
        baselinePolicy: "required",
        negativeControl: "when_feasible",
        flakyPolicy: "forbid",
        evidence: {
          kind: "focused_command",
          selectors: [paths[1]!],
          references: [paths[1]!]
        }
      }],
      uncertainty: [],
      granularity: {
        disposition: "leaf",
        feasibility: feasible(),
        splitReasons: [],
        expectedBenefits: [],
        expectedCosts: [],
        evidenceRefs: [EVIDENCE],
        epistemic
      },
      expansion: "leaf"
    };
    artifacts[`artifact:${module}-change`] = {
      id: `artifact:${module}-change`,
      producerUnitId: `unit:${module}`,
      consumerUnitIds: ["unit:root"],
      artifactType: "source_change",
      materialization: "patch",
      expectedPaths: paths
    };
  }
  return {
    id: "plan:greenfield",
    revision: 1,
    goalContract: { id: goal.id, revision: goal.revision, digest: goal.digest },
    repositorySnapshot: { ...view.model.snapshot },
    repositoryView: {
      digest: view.digest,
      treeSha: view.treeSha,
      resourceCatalogDigest: view.catalog.digest
    },
    rootUnitId: "unit:root",
    units,
    seams: {},
    artifacts,
    decisions: [],
    evidence: structuredClone(view.model.evidence),
    status: "ready"
  } as unknown as SemanticPlanMaterial;
}

function modulePaths(module: string): string[] {
  return [`src/${module}/index.js`, `src/${module}/index.test.js`];
}

function feasible() {
  return {
    coherentResponsibility: true,
    boundedContext: "yes" as const,
    boundedChangeSurface: "yes" as const,
    independentlyValidatable: "yes" as const,
    unresolvedArchitectureDecision: false
  };
}

function proofStrategies(goal: ReturnType<typeof goalContract>, view: RepositoryView) {
  return [...MODULES.map((module) => `validation:${module}`), "validation:integration"].map((obligationId) =>
    buildProofStrategy({
      id: `proof:${obligationId}`,
      revision: 1,
      goalContractDigest: goal.digest,
      criterionId: CRITERION,
      obligationId,
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: view.digest,
      procedureRef: "command:node-test",
      environmentPolicyDigest: "sha256:environment",
      independence: "independent_required"
    }, sha256)
  );
}

function goalContract(view: RepositoryView) {
  return buildGoalContract({
    id: "goal:greenfield",
    revision: 1,
    goal: "Build a modular expense-splitting application.",
    acceptanceCriteria: [{
      id: CRITERION,
      statement: "The application splits expenses correctly.",
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
    target: { repositoryId: "repo:greenfield", baseCommit: "a".repeat(40), treeSha: view.treeSha }
  }, sha256);
}

/** A repository holding a README and nothing else, as a new workspace does. */
function greenfieldView(): RepositoryView {
  const evidence = [
    entry(EVIDENCE, "relationship", "path:."),
    entry(`evidence:${README}`, "file", "path:README.md")
  ];
  const known = (ref: string) => ({ state: "known" as const, confidence: "high" as const, evidenceRefs: [ref] });
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    resources: {
      [ROOT_PACKAGE]: {
        id: ROOT_PACKAGE,
        kind: "package" as const,
        canonicalLocator: "package:.",
        path: "",
        evidenceRefs: [EVIDENCE],
        epistemic: known(EVIDENCE),
        generated: { state: "source" as const, reason: "Package boundary.", evidenceRefs: [EVIDENCE] }
      },
      [README]: {
        id: README,
        kind: "path" as const,
        canonicalLocator: "path:README.md",
        path: "README.md",
        gitEntryKind: "file" as const,
        evidenceRefs: [`evidence:${README}`],
        epistemic: known(`evidence:${README}`),
        generated: { state: "source" as const, reason: "Source file.", evidenceRefs: [`evidence:${README}`] }
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
      snapshot: { id: "snapshot:greenfield", digest: "sha256:snapshot" },
      repositoryId: "repo:greenfield",
      baseCommit: "a".repeat(40),
      treeSha: "b".repeat(40),
      coverage: {
        treeEntryCount: 1,
        sourceEntryCount: 0,
        parsedSourceCount: 0,
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
    snapshotId: "snapshot:greenfield",
    kind,
    locator,
    digest: sha256(`${id}\0${locator}`),
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [id] }
  };
}
