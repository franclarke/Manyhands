import { describe, expect, it } from "vitest";
import { foldRun, type RunEvent } from "@manyhands/run-coordinator";

const base = { runId: "run-c2", occurredAt: "2026-07-24T00:00:00.000Z" };

function events(): RunEvent[] {
  return [
    { ...base, eventId: "e1", sequence: 1, type: "run.created", payload: { goal: "Build warehouse" } },
    {
      ...base,
      eventId: "e2",
      sequence: 2,
      type: "planning.granularity_strategy_selected",
      payload: {
        policyVersion: "adaptive-utility/2.0.0-pilot",
        condition: "C2",
        candidateTreeHash: "sha256:candidate",
        config: {
          minimumAdvantage: 0.15,
          maxLeafContextTokens: 24_000,
          maxLeafScopePaths: 40,
          maxLeafPlannedPaths: 12
        },
        assessments: [{
          unitKey: "warehouse-web",
          nodeId: "node-warehouse-web",
          selected: "split",
          leafFeasible: true,
          splitViable: true,
          features: {
            contextRelief: 0.7,
            parallelism: 0.8,
            faultIsolation: 0.6,
            coordination: 0.2,
            pathOverlap: 0.1,
            validationDuplication: 0,
            uncertainty: 0.1
          },
          benefit: 0.7,
          cost: 0.1,
          splitAdvantage: 0.6,
          minimumAdvantage: 0.15,
          evidenceRefs: ["src/web.ts"],
          rationale: "The semantic cut has positive measured utility."
        }],
        metrics: { maxGraphDepth: 2, totalLeafCount: 3, averageBranchingFactor: 3 }
      }
    } as RunEvent
  ];
}

describe("planning.granularity_strategy_selected", () => {
  it("survives journal replay with the complete C2 decision evidence", () => {
    const state = foldRun(events());

    expect(state.granularityStrategy?.policyVersion).toBe("adaptive-utility/2.0.0-pilot");
    expect(state.granularityStrategy?.condition).toBe("C2");
    expect(state.granularityStrategy?.candidateTreeHash).toBe("sha256:candidate");
    expect(state.granularityStrategy?.config.maxLeafPlannedPaths).toBe(12);
    expect(state.granularityStrategy?.assessments["node-warehouse-web"]?.selected).toBe("split");
    expect(state.granularityStrategy?.assessments["node-warehouse-web"]?.splitAdvantage).toBe(0.6);
  });

  it("is rejected after planning has failed", () => {
    const selected = events()[1]!;
    const sequence = [
      events()[0]!,
      { ...base, eventId: "failed", sequence: 2, type: "planning.failed", payload: { reason: "model unavailable" } } as RunEvent,
      { ...selected, eventId: "e3", sequence: 3 } as RunEvent
    ];

    expect(() => foldRun(sequence)).toThrow(/planning facts/i);
  });
});
