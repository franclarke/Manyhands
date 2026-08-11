import { describe, expect, it } from "vitest";
import { granularityStrategyExplanation } from "@/lib/run-model/presentation";
import type { GranularityStrategyProjection } from "@manyhands/run-coordinator";

/**
 * The node inspector must explain WHY a node received its granularity, from the
 * persisted decision rather than by re-deriving the policy. An explanation the
 * UI computes itself can disagree with the one the run recorded.
 */

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
