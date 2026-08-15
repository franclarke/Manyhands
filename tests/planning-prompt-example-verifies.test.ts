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
import { prepareValidationRecipe } from "@manyhands/execution-core";
import { ResourceCatalog, type RepositoryView } from "@manyhands/repository-index";

import { CANONICAL_PLAN_EXAMPLE } from "../apps/daemon/src/canonical-planning-contract.js";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const PACKAGE = "resource:replace-with-a-supplied-package";
const EVIDENCE = "evidence:replace-with-a-supplied-reference";
const CRITERION = "criterion:replace-with-a-supplied-criterion";

/**
 * Passing `SemanticPlanMaterialSchema` is only half the contract: `verifyPlan`
 * then enforces ownership, refinement, seam and write-surface invariants that
 * no schema expresses. A worked example that parses and then fails verification
 * would still burn a live planning call, so the example has to clear both.
 *
 * This is also what makes `CANONICAL_PLAN_RULES` honest — the rules claim these
 * invariants hold for a plan shaped like the example, and this proves it.
 */
describe("The prompt example under the real plan verifier", () => {
  it("is accepted with the supplied criterion, resources and evidence bound", () => {
    const view = repositoryView();
    const goal = goalContract(view);
    const plan = buildSemanticPlan(material(goal, view), sha256);
    const proofStrategies = proofStrategiesFor(goal, view);

    const verification = verifyPlan({ plan, goal, proofStrategies, repositoryView: view, hasher: sha256 });

    expect(verification.findings.filter(({ severity }) => severity === "error").map(({ code, message }) =>
      `${code}: ${message}`
    )).toEqual([]);
    expect(verification.ok).toBe(true);
  });

  it("materializes a validation command for every required obligation", () => {
    // A live run reached execution and refused every leaf with "Required
    // validation obligations cannot be materialized". The obligations carried
    // no evidence binding, so the recipe compiler had no command to build and
    // the node could never be validated. Verifying the plan does not catch it:
    // `evidence` is optional in the schema and unchecked by the verifier.
    const view = repositoryView();
    const goal = goalContract(view);
    const compiled = compilePlan({
      goal,
      plan: buildSemanticPlan(material(goal, view), sha256),
      proofStrategies: proofStrategiesFor(goal, view),
      repositoryView: view,
      hasher: sha256,
      idFactory: (kind, parts) => [kind, ...parts].join(":")
    });
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.findings, null, 2));

    const capabilities = {
      scripts: { test: "node --test" },
      baselineCommands: [{ kind: "test" as const, command: "npm", args: ["test"], sourceScript: "test" }],
      languages: [],
      stack: []
    };

    const prepared = Object.values(compiled.contracts.taskBundles).map((bundle) => ({
      nodeId: bundle.task.nodeId,
      recipe: prepareValidationRecipe({
        contract: bundle.validation,
        capabilities,
        repositorySnapshotId: view.model.snapshot.id
      })
    }));

    expect(prepared.length).toBeGreaterThan(0);
    for (const { nodeId, recipe } of prepared) {
      expect(recipe.unmaterializedObligationIds, `${nodeId} has an obligation with no command`).toEqual([]);
      expect(recipe.steps.length, `${nodeId} produced no validation step`).toBeGreaterThan(0);
    }
  });
});

function proofStrategiesFor(goal: ReturnType<typeof goalContract>, view: RepositoryView) {
  return ["validation:integration", "validation:producer", "validation:consumer"].map((obligationId) =>
    buildProofStrategy({
      id: `proof:${obligationId}`,
      revision: 1,
      goalContractDigest: goal.digest,
      criterionId: CRITERION,
      obligationId,
      mode: "executable",
      authority: "orchestrator_deterministic",
      repositoryViewDigest: view.digest,
      procedureRef: "command:pnpm-test",
      environmentPolicyDigest: "sha256:environment",
      independence: "independent_required"
    }, sha256)
  );
}

/** The example, plus the six fields the daemon binds before the engine sees it. */
function material(
  goal: ReturnType<typeof goalContract>,
  view: RepositoryView
): SemanticPlanMaterial {
  const example = structuredClone(CANONICAL_PLAN_EXAMPLE) as unknown as Record<string, unknown>;
  for (const unit of Object.values(example.units as Record<string, {
    validation: Array<Record<string, unknown>>;
    integration?: Record<string, unknown>;
  }>)) {
    for (const obligation of unit.validation) obligation.proofStrategyId = `proof:${obligation.obligationId}`;
    if (unit.integration !== undefined) {
      unit.integration.proofStrategyId = `proof:${unit.integration.obligationId}`;
    }
  }
  return {
    ...example,
    id: "plan:example",
    revision: 1,
    goalContract: { id: goal.id, revision: goal.revision, digest: goal.digest },
    repositorySnapshot: { ...view.model.snapshot },
    repositoryView: {
      digest: view.digest,
      treeSha: view.treeSha,
      resourceCatalogDigest: view.catalog.digest
    },
    evidence: structuredClone(view.model.evidence)
  } as SemanticPlanMaterial;
}

function goalContract(view: RepositoryView) {
  return buildGoalContract({
    id: "goal:example",
    revision: 1,
    goal: "Implement the feature across a producer and a consumer module.",
    acceptanceCriteria: [{
      id: CRITERION,
      statement: "The integrated feature behaves correctly.",
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
    target: { repositoryId: "repo:example", baseCommit: "a".repeat(40), treeSha: view.treeSha }
  }, sha256);
}

function repositoryView(): RepositoryView {
  const evidence = [evidenceEntry(EVIDENCE, "relationship", "path:src")];
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    // The files in the example do not exist yet, so the only resource that can
    // authorize writing them is the package that contains them.
    resources: { [PACKAGE]: rootPackage(PACKAGE) },
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
      snapshot: { id: "snapshot:example", digest: "sha256:snapshot" },
      repositoryId: "repo:example",
      baseCommit: "a".repeat(40),
      treeSha: "b".repeat(40),
      coverage: {
        treeEntryCount: 2,
        sourceEntryCount: 2,
        parsedSourceCount: 2,
        unsupportedEntryCount: 0,
        disposition: "known",
        evidenceRefs: [EVIDENCE]
      },
      evidence
    } as RepositoryView["model"]
  } satisfies RepositoryView;
}

function evidenceEntry(id: string, kind: "file" | "relationship", locator: string) {
  return {
    id,
    snapshotId: "snapshot:example",
    kind,
    locator,
    digest: sha256(`${id}\0${locator}`),
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [id] }
  };
}

function rootPackage(id: string) {
  return {
    id,
    kind: "package" as const,
    canonicalLocator: "package:.",
    path: "",
    evidenceRefs: [EVIDENCE],
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [EVIDENCE] },
    generated: { state: "source" as const, reason: "Package boundary.", evidenceRefs: [EVIDENCE] }
  };
}
