import { describe, expect, it } from "vitest";
import {
  SemanticPlanSchema,
  applyGranularitySelection,
  createSemanticPlan,
  flattenSemanticWorkUnits,
  type GranularityStrategyAssessment,
  type SemanticPlan,
  type SemanticWorkUnit
} from "@manyhands/decomposer";

/**
 * The policy governs the tree that compiles.
 *
 * Until now `selectGranularityStrategy` was called, its assessments were
 * journalled, and its `selectedBreakdown` was thrown away — the tree that
 * compiled was always the planner's fixpoint. A policy whose output nothing
 * consumes cannot be right or wrong, and the final experiment recorded exactly
 * what that costs: in cell M-C-r2 the policy selected `leaf` and the run
 * executed three.
 *
 * The decision is applied to the SemanticPlan rather than by mapping a
 * WorkBreakdown back into one. The plan is the single source the compiler reads;
 * inverting the legacy projection would introduce a second representation to
 * keep in step, which is exactly what the architecture forbids.
 */
describe("granularity selection governs the compiled tree", () => {
  it("collapses a composite the policy selected as a leaf, keeping everything it owned", () => {
    const plan = planOf();

    const selected = applyGranularitySelection({
      plan,
      assessments: assessments({ root: "leaf" })
    });

    expect(selected.plan.root.kind).toBe("leaf");
    expect(flattenSemanticWorkUnits(selected.plan.root)).toHaveLength(1);
    expect(selected.collapsedUnitKeys).toEqual(["root"]);
    // Nothing the children owned may be dropped: every outcome still has a home.
    expect(selected.plan.root.outcomes.map((outcome) => outcome.id).sort())
      .toEqual(["outcome-api", "outcome-domain", "outcome-root"]);
    expect(selected.plan.root.writePaths?.sort())
      .toEqual(["src/api.ts", "src/domain.ts"]);
  });

  it("keeps a composite the policy selected as a split", () => {
    const plan = planOf();

    const selected = applyGranularitySelection({
      plan,
      assessments: assessments({ root: "split" })
    });

    expect(selected.plan.root.kind).toBe("composite");
    expect(flattenSemanticWorkUnits(selected.plan.root)).toHaveLength(3);
    expect(selected.collapsedUnitKeys).toEqual([]);
  });

  it("drops a seam that no longer crosses a boundary once its sides are one unit", () => {
    const plan = planOf();
    expect(plan.seams).toHaveLength(1);

    const selected = applyGranularitySelection({
      plan,
      assessments: assessments({ root: "leaf" })
    });

    expect(selected.plan.seams).toEqual([]);
  });

  it("produces a plan that still satisfies the schema the compiler reads", () => {
    const selected = applyGranularitySelection({
      plan: planOf(),
      assessments: assessments({ root: "leaf" })
    });

    expect(() => SemanticPlanSchema.parse(selected.plan)).not.toThrow();
  });

  it("leaves the plan untouched when the policy assessed nothing", () => {
    const plan = planOf();

    const selected = applyGranularitySelection({ plan, assessments: {} });

    expect(selected.plan).toEqual(plan);
    expect(selected.collapsedUnitKeys).toEqual([]);
  });
});

function assessments(
  byKey: Record<string, GranularityStrategyAssessment["selected"]>
): Record<string, GranularityStrategyAssessment> {
  return Object.fromEntries(Object.entries(byKey).map(([unitKey, selected]) => [unitKey, {
    unitKey,
    candidateTreeHash: "sha256:test",
    selected,
    leafFeasible: true,
    splitViable: true,
    features: {
      contextRelief: 0, parallelism: 0, faultIsolation: 0,
      coordination: 0, pathOverlap: 0, validationDuplication: 0, uncertainty: 0
    },
    benefit: 0,
    cost: 0,
    splitAdvantage: 0,
    minimumAdvantage: 0.15,
    evidenceRefs: [],
    rationale: "test"
  } satisfies GranularityStrategyAssessment]));
}

function planOf(): SemanticPlan {
  return createSemanticPlan({
    goal: "Add order priority across domain and api",
    repositorySnapshotId: "sha256:snapshot",
    criteria: [
      { id: "criterion-1", description: "Priority validates", required: true },
      { id: "criterion-2", description: "Api exposes priority", required: true }
    ],
    draft: {
      root: composite("root", [
        leaf("domain", "src/domain.ts", "outcome-domain", "criterion-1"),
        leaf("api", "src/api.ts", "outcome-api", "criterion-2")
      ]),
      seams: [{
        id: "seam-domain-to-api",
        producerUnitKey: "domain",
        consumerUnitKeys: ["api"],
        purpose: "api reads the domain order type",
        paths: ["src/domain.ts"],
        interface: {
          kind: "type",
          promise: "Order carries priority",
          compatibility: "Additive: existing callers keep compiling",
          materialization: "files",
          verification: { kind: "author_test", references: ["test/domain.test.ts"] }
        },
        evidenceIds: []
      }],
      repositoryEvidence: [
        pathEvidence("src/domain.ts"),
        pathEvidence("src/api.ts")
      ],
      uncertainties: [],
      questions: []
    }
  });
}

function composite(key: string, children: SemanticWorkUnit[]): SemanticWorkUnit {
  return {
    key,
    kind: "composite",
    title: key,
    objective: `Deliver ${key}`,
    concerns: [key],
    evidenceIds: [],
    outcomes: [{
      id: "outcome-root",
      description: "The layers integrate",
      criterionIds: ["criterion-1", "criterion-2"],
      verification: { kind: "existing", references: ["npm test"] }
    }],
    cut: { criterion: "integration", rationale: "Layer boundaries" },
    children
  };
}

function pathEvidence(path: string) {
  return {
    id: `path-${path.replace(/[^A-Za-z0-9]/gu, "-")}`,
    kind: "path" as const,
    reference: path,
    observation: `Existing ${path}`,
    confidence: 1
  };
}

function leaf(key: string, path: string, outcomeId: string, criterionId: string): SemanticWorkUnit {
  return {
    key,
    kind: "leaf",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    evidenceIds: [pathEvidence(path).id],
    writePaths: [path],
    outcomes: [{
      id: outcomeId,
      description: `${key} works`,
      criterionIds: [criterionId],
      verification: { kind: "author_test", references: [`test/${key}.test.ts`] }
    }]
  };
}
