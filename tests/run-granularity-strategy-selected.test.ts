import { describe, expect, it } from "vitest";
import { foldRun, type RunEvent } from "@manyhands/run-coordinator";

const base = { runId: "run-granularity", occurredAt: "2026-08-11T00:00:00.000Z" };

function events(): RunEvent[] {
  return [
    { ...base, eventId: "e1", sequence: 1, type: "run.created", payload: { goal: "Build warehouse" } },
    {
      ...base,
      eventId: "e2",
      sequence: 2,
      type: "planning.granularity_strategy_selected",
      payload: {
        policyVersion: "granularity/4.0.0",
        condition: "C",
        candidateTreeHash: "sha256:candidate",
        config: {
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
          reasons: { doesNotFit: false, runsInParallel: true, verifiableApart: true },
          evidenceRefs: ["src/web.ts"],
          rationale: "Split because two children can start at the same time."
        }],
        metrics: { maxGraphDepth: 2, totalLeafCount: 3, averageBranchingFactor: 3 }
      }
    } as RunEvent
  ];
}

describe("planning.granularity_strategy_selected", () => {
  it("survives journal replay with the complete decision evidence", () => {
    const state = foldRun(events());

    expect(state.granularityStrategy?.policyVersion).toBe("granularity/4.0.0");
    expect(state.granularityStrategy?.condition).toBe("C");
    expect(state.granularityStrategy?.candidateTreeHash).toBe("sha256:candidate");
    expect(state.granularityStrategy?.config.maxLeafPlannedPaths).toBe(12);
    expect(state.granularityStrategy?.assessments["node-warehouse-web"]?.selected).toBe("split");
    // The reasons are the decision. Replaying a verdict without them would
    // leave the journal saying what was chosen and not why.
    expect(state.granularityStrategy?.assessments["node-warehouse-web"]?.reasons).toEqual({
      doesNotFit: false,
      runsInParallel: true,
      verifiableApart: true
    });
  });

  it("rejects an assessment that does not say which reasons held", () => {
    const selected = events()[1] as Extract<RunEvent, { type: "planning.granularity_strategy_selected" }>;
    const withoutReasons = selected.payload.assessments.map(({ reasons: _dropped, ...rest }) => rest);
    const broken = [
      events()[0]!,
      { ...selected, payload: { ...selected.payload, assessments: withoutReasons } }
    ] as RunEvent[];

    expect(() => foldRun(broken)).toThrow();
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
