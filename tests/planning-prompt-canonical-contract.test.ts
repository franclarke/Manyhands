import { describe, expect, it } from "vitest";

import { SemanticPlanMaterialSchema } from "@manyhands/contracts";
import type { PlanningModelInput } from "@manyhands/decomposer";

import {
  CANONICAL_PLAN_EXAMPLE,
  CANONICAL_PLAN_RULES
} from "../apps/daemon/src/canonical-planning-contract.js";
import {
  canonicalPlanningPrompt,
  parseCanonicalPlanningProposal
} from "../apps/daemon/src/current-lifecycle-adapters.js";

import { stage5Fixture } from "./helpers/stage5-fixture.js";

/**
 * The live composite run produced the right hierarchy and then failed
 * `schema_invalid` with sixty Zod issues: `outcomes` and `criteria` as bare
 * strings, `repositorySurface.resourceIds` instead of `resourceRefs`,
 * `granularity` without `disposition`/`feasibility`/`epistemic`,
 * `resourceIntents` without `ownerPhase`/`outputArtifactId`, evidence ids where
 * `acceptableEvidence` wants evidence kinds.
 *
 * None of that is a model defect. The prompt asked for a `SemanticPlanMaterial`
 * in seven sentences of prose and never showed the shape, so the model had to
 * invent a deeply nested strict schema with discriminated unions from its name.
 */
describe("Canonical planning prompt", () => {
  const fixture = stage5Fixture();
  const goal = fixture.goal;
  // The prompt reads the model's command and package inventories; the shared
  // fixture only carries what the verifier needs.
  const repositoryView = {
    ...fixture.repositoryView,
    model: { ...fixture.repositoryView.model, commands: [], packages: [] }
  } as typeof fixture.repositoryView;
  const request = {
    // The engine's operations are plan / expand / amend; there is no "create",
    // so this double was never the request the engine actually receives.
    operation: "plan" as const,
    goal,
    repositoryView: {
      digest: repositoryView.digest,
      treeSha: repositoryView.treeSha,
      resourceCatalogDigest: repositoryView.catalog.digest
    },
    decisions: [],
    evidenceRefs: ["evidence:architecture"],
    previousFindings: [],
    signal: new AbortController().signal
  } satisfies PlanningModelInput;

  it("demonstrates a plan the schema actually accepts", () => {
    // The example travels in the prompt, so it has to be exactly what the
    // contract accepts. If a schema field moves, this test is the thing that
    // notices before a live run spends a planning call discovering it.
    const proposal = parseCanonicalPlanningProposal(
      JSON.stringify({ kind: "candidate", material: CANONICAL_PLAN_EXAMPLE }),
      request,
      repositoryView
    );
    expect(proposal.kind).toBe("candidate");
    const parsed = SemanticPlanMaterialSchema.safeParse(
      (proposal as { material: unknown }).material
    );
    expect(parsed.success ? [] : parsed.error.issues.map((issue) =>
      `${issue.path.join(".")}: ${issue.message}`
    )).toEqual([]);
  });

  it("carries the worked example verbatim", () => {
    const prompt = canonicalPlanningPrompt(request, repositoryView);
    expect(prompt).toContain(JSON.stringify(CANONICAL_PLAN_EXAMPLE, null, 2));
  });

  it("names every field the live run guessed wrong", () => {
    const prompt = canonicalPlanningPrompt(request, repositoryView);
    for (const field of [
      "resourceRefs",
      "sourceCriterionId",
      "ownerPhase",
      "outputArtifactId",
      "disposition",
      "feasibility",
      "epistemic",
      "acceptableEvidence",
      "expansion",
      "semanticFacts"
    ]) {
      expect(prompt, `prompt must specify ${field}`).toContain(field);
    }
  });

  it("states the structural invariants the verifier enforces", () => {
    const prompt = canonicalPlanningPrompt(request, repositoryView);
    expect(CANONICAL_PLAN_RULES.length).toBeGreaterThan(0);
    for (const rule of CANONICAL_PLAN_RULES) expect(prompt).toContain(rule);
  });

  it("omits the fields the system binds, so the model cannot contradict them", () => {
    for (const bound of [
      "id",
      "revision",
      "goalContract",
      "repositorySnapshot",
      "repositoryView",
      "evidence"
    ]) {
      expect(Object.keys(CANONICAL_PLAN_EXAMPLE)).not.toContain(bound);
    }
  });

  it("binds the proof strategy id the daemon owns, so the model never sends one", () => {
    // `bindProductProofStrategies` overwrites every `proofStrategyId` with
    // `proof:<obligationId>` whatever the model said, so demanding one only
    // creates an invented identifier the schema can reject beforehand.
    const proposal = parseCanonicalPlanningProposal(
      JSON.stringify({ kind: "candidate", material: CANONICAL_PLAN_EXAMPLE }),
      request,
      repositoryView
    );
    const units = (proposal as { material: { units: Record<string, {
      validation: Array<{ obligationId: string; proofStrategyId?: string }>;
      integration?: { obligationId: string; proofStrategyId?: string };
    }> } }).material.units;

    const bound = Object.values(units).flatMap((unit) => [
      ...unit.validation,
      ...(unit.integration === undefined ? [] : [unit.integration])
    ]);
    expect(bound.length).toBeGreaterThan(0);
    for (const obligation of bound) {
      expect(obligation.proofStrategyId).toBe(`proof:${obligation.obligationId}`);
    }
  });
});
