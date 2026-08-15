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

import { CANONICAL_PLAN_EXAMPLE } from "../apps/daemon/src/canonical-planning-contract.js";

const sha256: DigestHasher = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

const RESOURCE_A = "resource:replace-with-a-supplied-resource-a";
const RESOURCE_B = "resource:replace-with-a-supplied-resource-b";
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
    const proofStrategies = ["validation:integration", "validation:producer", "validation:consumer"]
      .map((obligationId) => buildProofStrategy({
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
      }, sha256));

    const verification = verifyPlan({ plan, goal, proofStrategies, repositoryView: view, hasher: sha256 });

    expect(verification.findings.filter(({ severity }) => severity === "error").map(({ code, message }) =>
      `${code}: ${message}`
    )).toEqual([]);
    expect(verification.ok).toBe(true);
  });
});

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
  const evidence = [
    evidenceEntry(EVIDENCE, "relationship", "path:src"),
    evidenceEntry(`evidence:${RESOURCE_A}`, "file", "path:src/producer.ts"),
    evidenceEntry(`evidence:${RESOURCE_B}`, "file", "path:src/consumer.ts")
  ];
  const catalog = new ResourceCatalog({
    schemaVersion: 1,
    repositoryContentDigest: "sha256:content",
    resources: {
      [RESOURCE_A]: resource(RESOURCE_A, "src/producer.ts"),
      [RESOURCE_B]: resource(RESOURCE_B, "src/consumer.ts")
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

function resource(id: string, filePath: string) {
  return {
    id,
    kind: "path" as const,
    canonicalLocator: `path:${filePath}`,
    path: filePath,
    gitEntryKind: "file" as const,
    evidenceRefs: [`evidence:${id}`],
    epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: [`evidence:${id}`] },
    generated: { state: "source" as const, reason: "Example source file.", evidenceRefs: [`evidence:${id}`] }
  };
}
