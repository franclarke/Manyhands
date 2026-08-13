import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GoalContractSchema,
  SemanticPlanSchema,
  buildGoalContract,
  buildSemanticPlan,
  canonicalJson,
  verifyCanonicalDigest,
  type DigestHasher
} from "@manyhands/contracts";

const sha256: DigestHasher = (value) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;

describe("canonical contract round-trip", () => {
  it("serializes object keys deterministically while preserving semantic array order", () => {
    expect(canonicalJson({ z: 1, nested: { y: 2, a: 3 }, steps: ["second", "first"] })).toBe(
      '{"nested":{"a":3,"y":2},"steps":["second","first"],"z":1}'
    );
  });

  it("builds a strict versioned GoalContract with explicit set canonicalization", () => {
    const input = goalMaterial();
    const first = buildGoalContract(input, sha256);
    const equivalent = buildGoalContract({
      ...input,
      constraints: [...input.constraints].reverse(),
      acceptanceCriteria: input.acceptanceCriteria.map((criterion) => ({
        ...criterion,
        protectedReferences: [...criterion.protectedReferences].reverse(),
        verification: {
          ...criterion.verification,
          allowedProofs: [...criterion.verification.allowedProofs].reverse()
        }
      }))
    }, sha256);

    expect(GoalContractSchema.parse(JSON.parse(canonicalJson(first)))).toEqual(first);
    expect(equivalent.digest).toBe(first.digest);
    expect(first.constraints).toEqual(["no network", "preserve public API"]);
    expect(verifyCanonicalDigest(first, "digest", sha256)).toBe(true);
    expect(GoalContractSchema.safeParse({ ...first, revision: 0 }).success).toBe(false);
    expect(GoalContractSchema.safeParse({ ...first, runtimeStatus: "accepted" }).success).toBe(false);
  });

  it("keeps authored WorkUnit outcome order but canonicalizes reference sets", () => {
    const material = semanticPlanMaterial();
    const plan = buildSemanticPlan(material, sha256);
    const equivalent = buildSemanticPlan({
      ...material,
      units: {
        root: {
          ...material.units.root,
          consumes: ["artifact:z", "artifact:a"],
          seamRefs: ["seam:z", "seam:a"]
        }
      }
    }, sha256);

    expect(SemanticPlanSchema.parse(JSON.parse(canonicalJson(plan)))).toEqual(plan);
    expect(plan.units.root?.outcomes.map((outcome) => outcome.id)).toEqual(["outcome:second", "outcome:first"]);
    expect(plan.units.root?.consumes).toEqual(["artifact:a", "artifact:z"]);
    expect(equivalent.digest).toBe(plan.digest);
  });
});

function goalMaterial() {
  return {
    id: "goal:booking",
    revision: 1,
    goal: "Implement reliable booking",
    acceptanceCriteria: [{
      id: "criterion:booking",
      statement: "A slot can be booked exactly once",
      required: true,
      level: "product" as const,
      protectedReferences: ["oracle:b", "oracle:a"],
      verification: {
        allowedProofs: [
          { mode: "external_oracle" as const, authority: "protected_external_oracle" as const },
          { mode: "executable" as const, authority: "orchestrator_deterministic" as const }
        ],
        independence: "independent_required" as const
      }
    }],
    constraints: ["preserve public API", "no network"],
    qualityAttributes: [{ kind: "maintainability" as const, statement: "Keep boundaries explicit" }],
    target: { repositoryId: "repo:manyhands", baseCommit: "a".repeat(40), treeSha: "b".repeat(40) }
  };
}

function semanticPlanMaterial() {
  return {
    id: "plan:booking",
    revision: 1,
    goalContract: { id: "goal:booking", revision: 1, digest: "sha256:goal" },
    repositorySnapshot: { id: "snapshot:base", digest: "sha256:snapshot" },
    repositoryView: { digest: "sha256:view", treeSha: "b".repeat(40), resourceCatalogDigest: "sha256:catalog" },
    rootUnitId: "root",
    units: {
      root: {
        id: "root",
        role: "leaf" as const,
        title: "Booking slice",
        objective: "Implement booking",
        boundary: { kind: "vertical_slice" as const, evidenceRefs: ["evidence:boundary"] },
        outcomes: [
          { id: "outcome:second", statement: "Second authored outcome" },
          { id: "outcome:first", statement: "First authored outcome" }
        ],
        criteria: [{ criterionId: "criterion:booking", statement: "A slot can be booked", sourceCriterionId: "criterion:booking" }],
        repositorySurface: { resourceRefs: ["resource:booking"], pathHints: ["src/booking.ts"] },
        resourceIntents: [{
          resourceId: "resource:booking",
          access: "modify" as const,
          ownerPhase: "implementation" as const,
          outputArtifactId: "artifact:booking",
          evidenceRefs: ["evidence:boundary"],
          epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: ["evidence:boundary"] }
        }],
        consumes: ["artifact:a", "artifact:z"],
        produces: ["artifact:booking"],
        seamRefs: ["seam:a", "seam:z"],
        validation: [{
          obligationId: "obligation:booking",
          criterionId: "criterion:booking",
          proofStrategyId: "proof:booking",
          layer: "integration" as const,
          severity: "required" as const,
          acceptableEvidence: ["test_result" as const],
          baselinePolicy: "required" as const,
          negativeControl: "when_feasible" as const,
          flakyPolicy: "forbid" as const
        }],
        uncertainty: [],
        granularity: {
          disposition: "leaf" as const,
          feasibility: {
            coherentResponsibility: true,
            boundedContext: "yes" as const,
            boundedChangeSurface: "yes" as const,
            independentlyValidatable: "yes" as const,
            unresolvedArchitectureDecision: false
          },
          splitReasons: [],
          expectedBenefits: [],
          expectedCosts: [],
          evidenceRefs: ["evidence:granularity"],
          epistemic: { state: "known" as const, confidence: "high" as const, evidenceRefs: ["evidence:granularity"] }
        },
        expansion: "leaf" as const
      }
    },
    seams: {},
    artifacts: {},
    decisions: [],
    evidence: [],
    status: "ready" as const
  };
}
