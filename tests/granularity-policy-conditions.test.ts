import { describe, expect, it } from "vitest";
import { RunEventSchema } from "@manyhands/run-coordinator";
import {
  ADAPTIVE_GRANULARITY_FORMULA_VERSION,
  ADAPTIVE_GRANULARITY_POLICY,
  FINE_SPLIT_POLICY,
  SINGLE_LEAF_POLICY,
  applyAdaptiveGranularity,
  GRANULARITY_CONDITIONS,
  resolveGranularityCondition,
  WorkBreakdownSchema,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";

/**
 * G5 needs conditions A, B and C to be effective, per-run configuration rather
 * than a code edit between runs: a persisted run must be self-describing about
 * the policy that shaped it, otherwise a result cannot be attributed to a
 * condition after the fact.
 *
 * A — single leaf: decomposition is forbidden.
 * B — fixed fine split: everything the planner proposed is split, no coalescing.
 * C — the productive adaptive policy, unchanged.
 */

function breakdownWith(root: WorkUnit): WorkBreakdown {
  return WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: "breakdown-conditions",
    objective: "Deliver the requested feature",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: [{ id: "intent-1", description: "Feature works end to end", required: true }],
    repositoryEvidence: [],
    root
  });
}

function leaf(key: string, paths: string[], signals: Record<string, number>): WorkUnit {
  return {
    key,
    kind: "leaf",
    title: `Unit ${key}`,
    objective: `Implement ${key}`,
    concerns: [`concern-${key}`],
    expectedOutcomes: [`outcome-${key}`],
    acceptanceIntentIds: ["intent-1"],
    evidenceIds: [],
    plannedPaths: paths,
    complexitySignals: signals as never
  };
}

/** A genuinely multi-layer plan: above the threshold, with proposed sub-units. */
function multiLayerBreakdown(): WorkBreakdown {
  return breakdownWith({
    key: "feature-root",
    kind: "composite",
    title: "Multi-layer feature",
    objective: "Touch domain, api and web",
    concerns: ["root concern"],
    expectedOutcomes: ["root outcome"],
    acceptanceIntentIds: ["intent-1"],
    evidenceIds: [],
    plannedPaths: ["src/domain/feature.ts", "src/api/feature.ts", "src/web/feature.tsx"],
    complexitySignals: {
      scopeRadius: 8, interfaceImpact: 7, validationSurface: 7, contextTokenMass: 6
    } as never,
    cut: { criterion: "cohesion", rationale: "Separate layers" },
    children: [
      leaf("domain-feature", ["src/domain/feature.ts"], {
        scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1
      }),
      leaf("api-feature", ["src/api/feature.ts"], {
        scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1
      }),
      leaf("web-feature", ["src/web/feature.tsx"], {
        scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1
      })
    ]
  });
}

describe("granularity policy as per-run configuration", () => {
  it("condition C reproduces today's productive behaviour", () => {
    const result = applyAdaptiveGranularity({ breakdown: multiLayerBreakdown() });

    expect(result.formulaVersion).toBe(ADAPTIVE_GRANULARITY_FORMULA_VERSION);
    expect(result.leafThreshold).toBe(ADAPTIVE_GRANULARITY_POLICY.leafThreshold);
    expect(applyAdaptiveGranularity({
      breakdown: multiLayerBreakdown(),
      policy: ADAPTIVE_GRANULARITY_POLICY
    }).breakdown).toEqual(result.breakdown);
  });

  it("condition A forbids decomposition and says so in the formula version", () => {
    const result = applyAdaptiveGranularity({
      breakdown: multiLayerBreakdown(),
      policy: SINGLE_LEAF_POLICY
    });

    expect(result.breakdown.root.kind).toBe("leaf");
    expect(result.formulaVersion).toBe(`${ADAPTIVE_GRANULARITY_FORMULA_VERSION}+condA`);
    expect(Object.values(result.assessments).every((assessment) => assessment.isLeaf)).toBe(true);
    expect(() => WorkBreakdownSchema.parse(result.breakdown)).not.toThrow();
  });

  it("condition B splits every proposed unit and never coalesces", () => {
    const result = applyAdaptiveGranularity({
      breakdown: multiLayerBreakdown(),
      policy: FINE_SPLIT_POLICY
    });

    expect(result.breakdown.root.kind).toBe("composite");
    expect(result.formulaVersion).toBe(`${ADAPTIVE_GRANULARITY_FORMULA_VERSION}+condB`);
    expect(result.coalescedUnitsCount).toBe(0);
    expect(result.criticDecisions.filter((decision) => decision.kind === "coalesced")).toEqual([]);
    expect(() => WorkBreakdownSchema.parse(result.breakdown)).not.toThrow();
  });

  it("condition B keeps a leaf a leaf when the planner proposed no sub-units", () => {
    // A fixed fine split cannot invent a semantic cut either: that is the same
    // limitation the canonical run established, and it must not be papered over
    // by mechanically partitioning paths.
    const result = applyAdaptiveGranularity({
      breakdown: breakdownWith(leaf("narrow-rule", ["src/domain/split.ts"], {
        scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1
      })),
      policy: FINE_SPLIT_POLICY
    });

    expect(result.breakdown.root.kind).toBe("leaf");
  });

  it("exposes A/B/C and rejects historical C1/C2 replay explicitly", () => {
    expect(GRANULARITY_CONDITIONS).toEqual(["A", "B", "C"]);
    expect(resolveGranularityCondition(undefined)).toBe("C");
    expect(resolveGranularityCondition("C")).toBe("C");
    expect(() => resolveGranularityCondition("C1")).toThrow(/historical C1/i);
    expect(() => resolveGranularityCondition("C2")).toThrow(/historical C2/i);
  });

  it("keeps every threshold finite so a persisted assessment survives JSON", () => {
    for (const policy of [SINGLE_LEAF_POLICY, FINE_SPLIT_POLICY, ADAPTIVE_GRANULARITY_POLICY]) {
      expect(Number.isFinite(policy.leafThreshold)).toBe(true);
      expect(JSON.parse(JSON.stringify(policy))).toEqual(policy);
    }
  });
});

describe("every condition survives the durable journal", () => {
  it("persists the assessment of each policy without schema rejection", () => {
    // The experiment lost all four condition-B runs to an event-schema
    // rejection: the journal required a positive leaf threshold, and "no unit
    // is a leaf" needs a value below the lowest score a unit can reach. The
    // policy tests alone could not catch it, because none of them round-tripped
    // through the event the planner actually writes.
    for (const policy of [SINGLE_LEAF_POLICY, FINE_SPLIT_POLICY, ADAPTIVE_GRANULARITY_POLICY]) {
      const parsed = RunEventSchema.safeParse({
        eventId: "run-1:granularity",
        runId: "run-1",
        sequence: 1,
        occurredAt: "2026-07-24T12:00:00.000Z",
        type: "planning.granularity_assessed",
        payload: {
          formulaVersion: `c-task/1.0.0${policy.versionSuffix}`,
          weights: policy.weights,
          leafThreshold: policy.leafThreshold,
          assessments: [{
            unitKey: "unit-1",
            nodeId: "node-1",
            dimensions: { scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1 },
            signalSource: "llm",
            complexityScore: 1,
            decision: "leaf",
            rationale: "Trivial unit."
          }],
          criticDecisions: [],
          metrics: { maxGraphDepth: 0, totalLeafCount: 1, averageBranchingFactor: 0, coalescedUnitsCount: 0 }
        }
      });

      expect(parsed.success, `${policy.versionSuffix || "productive"} was rejected`).toBe(true);
    }
  });
});
