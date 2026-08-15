import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  buildGoalContract,
  type DigestHasher,
  type SemanticPlanMaterial
} from "@manyhands/contracts";
import { ResourceCatalog, type RepositoryView } from "@manyhands/repository-index";

import { CANONICAL_PLAN_EXAMPLE } from "../apps/daemon/src/canonical-planning-contract.js";
import { bindProductProofStrategies } from "../apps/daemon/src/current-lifecycle-adapters.js";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const PACKAGE = "resource:replace-with-a-supplied-package";
const EVIDENCE = "evidence:replace-with-a-supplied-reference";
const CRITERION = "criterion:replace-with-a-supplied-criterion";

/**
 * A live run executed and verified both leaves and then lost the composite with
 * "ProofStrategy proof:validation:integration has no selector digest for exact
 * evidence."
 *
 * The verifier requires a composite's integration obligation to also appear in
 * that unit's validation array, so the validation pass binds it first and
 * carries its evidence selectors. The integration pass then rebound the same
 * obligationId from scratch and dropped them. The composite could never bind
 * exact evidence, which is the one thing integration exists to do.
 */
describe("Proof strategy binding for a composite integration obligation", () => {
  it("keeps the selector digest the validation obligation already bound", () => {
    const view = repositoryView();
    const goal = goalContract(view);

    const bound = bindProductProofStrategies(material(goal, view), goal, view);
    const integration = bound.proofStrategies.find(({ obligationId }) =>
      obligationId === "validation:integration"
    );

    expect(integration, "the integration obligation must have a proof strategy").toBeDefined();
    expect(integration?.selectorDigest).toBeDefined();
    // Every other obligation still binds its own selectors.
    for (const strategy of bound.proofStrategies) {
      expect(strategy.selectorDigest, `${strategy.obligationId} lost its selectors`).toBeDefined();
    }
  });
});

function material(goal: ReturnType<typeof goalContract>, view: RepositoryView): SemanticPlanMaterial {
  return {
    ...structuredClone(CANONICAL_PLAN_EXAMPLE),
    id: "plan:integration-selector",
    revision: 1,
    goalContract: { id: goal.id, revision: goal.revision, digest: goal.digest },
    repositorySnapshot: { ...view.model.snapshot },
    repositoryView: {
      digest: view.digest,
      treeSha: view.treeSha,
      resourceCatalogDigest: view.catalog.digest
    },
    evidence: structuredClone(view.model.evidence)
  } as unknown as SemanticPlanMaterial;
}

function goalContract(view: RepositoryView) {
  return buildGoalContract({
    id: "goal:integration-selector",
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
  const evidence = [{
    id: EVIDENCE,
    snapshotId: "snapshot:example",
    kind: "relationship" as const,
    locator: "path:src",
    digest: sha256(EVIDENCE),
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [EVIDENCE] }
  }];
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    resources: {
      [PACKAGE]: {
        id: PACKAGE,
        kind: "package" as const,
        canonicalLocator: "package:.",
        path: "",
        evidenceRefs: [EVIDENCE],
        epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [EVIDENCE] },
        generated: { state: "source" as const, reason: "Package boundary.", evidenceRefs: [EVIDENCE] }
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
      snapshot: { id: "snapshot:example", digest: "sha256:snapshot" },
      repositoryId: "repo:example",
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
