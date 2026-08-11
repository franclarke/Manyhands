import { describe, expect, it } from "vitest";
import { granularityStrategyExplanation } from "@/lib/run-model/presentation";
import type { GranularityStrategyProjection } from "@manyhands/run-coordinator";

/**
 * The node inspector must explain WHY a node received its granularity, from the
 * persisted decision rather than by re-deriving the policy. An explanation the
 * UI computes itself can disagree with the one the run recorded.
 *
 * The decision is which of three reasons held, so the explanation is a
 * checklist rather than a number: the operator can argue with "every child owns
 * a criterion no sibling owns" in a way no score allows.
 */

describe("granularityStrategyExplanation", () => {
  const strategy: GranularityStrategyProjection = {
    policyVersion: "granularity/4.0.0",
    condition: "C",
    candidateTreeHash: "sha256:candidate",
    config: { maxLeafContextTokens: 24_000, maxLeafScopePaths: 40, maxLeafPlannedPaths: 12 },
    assessments: {
      "node-web": {
        unitKey: "web",
        nodeId: "node-web",
        selected: "split",
        leafFeasible: true,
        splitViable: true,
        reasons: { doesNotFit: false, runsInParallel: true, verifiableApart: true },
        evidenceRefs: ["src/web.ts"],
        rationale: "Split because two children can start at the same time."
      }
    },
    metrics: { maxGraphDepth: 2, totalLeafCount: 3, averageBranchingFactor: 3 }
  };

  it("reports every reason and which of them carried the decision", () => {
    const explanation = granularityStrategyExplanation(strategy, "node-web");

    expect(explanation?.decisionLabel).toBe("División semántica");
    expect(explanation?.reasons.map((reason) => reason.holds)).toEqual([false, true, true]);
    // Reasons that did not hold are shown too: knowing a cut bought no
    // concurrency is part of understanding why it was taken anyway.
    expect(explanation?.reasons).toHaveLength(3);
    expect(explanation?.policyVersion).toBe("granularity/4.0.0");
    expect(explanation?.evidenceRefs).toEqual(["src/web.ts"]);
  });

  it("returns null for a node the run never assessed", () => {
    expect(granularityStrategyExplanation(strategy, "node-absent")).toBeNull();
  });
});
