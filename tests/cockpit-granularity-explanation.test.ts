import { describe, expect, it } from "vitest";
import { granularityExplanation, granularityStrategyExplanation } from "@/lib/run-model/presentation";
import type { GranularityProjection, GranularityStrategyProjection } from "@manyhands/run-coordinator";

/**
 * Gate G3 requires the UI (or a report) to explain WHY a node received its
 * granularity, backed by the persisted C_task evidence. The presenter turns
 * the run projection into that explanation without re-deriving the policy.
 */

function projection(): GranularityProjection {
  return {
    formulaVersion: "c-task/1.0.0",
    weights: { scopeRadius: 0.3, interfaceImpact: 0.25, validationSurface: 0.25, contextTokenMass: 0.2 },
    leafThreshold: 3.5,
    assessments: {
      "node-leaf": {
        unitKey: "leaf-unit",
        nodeId: "node-leaf",
        dimensions: { scopeRadius: 1, interfaceImpact: 0.5, validationSurface: 1, contextTokenMass: 0.5 },
        signalSource: "llm",
        complexityScore: 0.78,
        decision: "leaf",
        rationale: "Leaf at C_task=0.78."
      },
      "node-composite": {
        unitKey: "composite-unit",
        nodeId: "node-composite",
        dimensions: { scopeRadius: 8, interfaceImpact: 8, validationSurface: 7, contextTokenMass: 8 },
        signalSource: "clamped",
        complexityScore: 7.78,
        decision: "composite",
        recommendedBranchingFactor: 4,
        rationale: "Composite at C_task=7.78."
      }
    },
    criticDecisions: [{ kind: "coalesced", unitIds: ["a", "b"], rationale: "Merged trivial siblings." }],
    metrics: { maxGraphDepth: 1, totalLeafCount: 3, averageBranchingFactor: 3, coalescedUnitsCount: 1 }
  };
}

describe("granularityExplanation", () => {
  it("explains a leaf decision against the threshold", () => {
    const explanation = granularityExplanation(projection(), "node-leaf");

    expect(explanation).not.toBeNull();
    expect(explanation?.decisionLabel).toBe("Hoja cohesiva");
    expect(explanation?.score).toBe(0.78);
    expect(explanation?.threshold).toBe(3.5);
    expect(explanation?.comparison).toContain("≤");
    expect(explanation?.dimensions).toEqual([
      { label: "Radio de alcance", value: 1, weight: 0.3 },
      { label: "Impacto de interfaz", value: 0.5, weight: 0.25 },
      { label: "Superficie de validación", value: 1, weight: 0.25 },
      { label: "Masa de contexto", value: 0.5, weight: 0.2 }
    ]);
    expect(explanation?.signalSourceLabel).toBe("estimadas por el planner");
    expect(explanation?.branchingFactor).toBeUndefined();
  });

  it("explains a composite decision including its branching factor and clamped signals", () => {
    const explanation = granularityExplanation(projection(), "node-composite");

    expect(explanation?.decisionLabel).toBe("Compuesto");
    expect(explanation?.comparison).toContain(">");
    expect(explanation?.branchingFactor).toBe(4);
    expect(explanation?.signalSourceLabel).toBe("ajustadas contra el repositorio");
  });

  it("returns null when the run has no assessment for the node", () => {
    expect(granularityExplanation(projection(), "node-unknown")).toBeNull();
    expect(granularityExplanation(undefined, "node-leaf")).toBeNull();
  });
});

describe("granularityStrategyExplanation", () => {
  it("explains C from persisted utility, limits and evidence", () => {
    const strategy: GranularityStrategyProjection = {
      policyVersion: "adaptive-utility/2.0.0-pilot",
      condition: "C",
      candidateTreeHash: "sha256:candidate",
      config: { minimumAdvantage: 0.15, maxLeafContextTokens: 24_000, maxLeafScopePaths: 40 },
      assessments: {
        "node-web": {
          unitKey: "web", nodeId: "node-web", selected: "split", leafFeasible: true, splitViable: true,
          features: { contextRelief: 0.7, parallelism: 0.8, faultIsolation: 0.6, coordination: 0.2, pathOverlap: 0.1, validationDuplication: 0, uncertainty: 0.1 },
          benefit: 0.7, cost: 0.1, splitAdvantage: 0.6, minimumAdvantage: 0.15,
          evidenceRefs: ["src/web.ts"], rationale: "Positive measured utility."
        }
      },
      metrics: { maxGraphDepth: 2, totalLeafCount: 3, averageBranchingFactor: 3 }
    };

    expect(granularityStrategyExplanation(strategy, "node-web")).toMatchObject({
      decisionLabel: "División semántica",
      comparison: "Ventaja 0.6 ≥ 0.15",
      benefit: 0.7,
      cost: 0.1,
      rationale: "Positive measured utility.",
      evidenceRefs: ["src/web.ts"]
    });
  });
});
