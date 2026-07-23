import { describe, expect, it } from "vitest";
import { foldRun, type RunEvent } from "@manyhands/run-coordinator";

/**
 * `planning.granularity_assessed` persists the adaptive C_task evidence per
 * node as a domain event: dimensions, accepted signal source, formula version,
 * decision and critic actions. Replaying the journal must reconstruct the
 * explanation for every granularity decision (gate G3: survives persistence
 * and replay).
 */

const base = { runId: "run-1", occurredAt: "2026-07-23T00:00:00.000Z" };

function events(): RunEvent[] {
  return [
    { ...base, eventId: "e1", sequence: 1, type: "run.created", payload: { goal: "Implement the feature" } },
    {
      ...base,
      eventId: "e2",
      sequence: 2,
      type: "planning.granularity_assessed",
      payload: {
        formulaVersion: "c-task/1.0.0",
        weights: { scopeRadius: 0.3, interfaceImpact: 0.25, validationSurface: 0.25, contextTokenMass: 0.2 },
        leafThreshold: 3.5,
        assessments: [
          {
            unitKey: "fix-typo",
            nodeId: "node-fix-typo-abc123",
            dimensions: { scopeRadius: 1, interfaceImpact: 0.5, validationSurface: 1, contextTokenMass: 0.5 },
            signalSource: "llm",
            complexityScore: 0.78,
            decision: "leaf",
            rationale: "Leaf at C_task=0.78 (S_r=1, I_i=0.5, V_s=1, T_m=0.5)."
          },
          {
            unitKey: "module",
            nodeId: "node-module-def456",
            dimensions: { scopeRadius: 8, interfaceImpact: 8, validationSurface: 7, contextTokenMass: 8 },
            signalSource: "clamped",
            complexityScore: 7.78,
            decision: "composite",
            recommendedBranchingFactor: 4,
            rationale: "Composite at C_task=7.78."
          }
        ],
        criticDecisions: [
          { kind: "coalesced", unitIds: ["edit-one", "edit-two"], rationale: "Merged trivial siblings." }
        ],
        metrics: { maxGraphDepth: 1, totalLeafCount: 3, averageBranchingFactor: 3, coalescedUnitsCount: 1 }
      }
    } as RunEvent
  ];
}

describe("planning.granularity_assessed", () => {
  it("is accepted during planning and projected for replay and UI explanation", () => {
    const state = foldRun(events());

    expect(state.granularity).toBeDefined();
    expect(state.granularity?.formulaVersion).toBe("c-task/1.0.0");
    expect(state.granularity?.leafThreshold).toBe(3.5);
    const byNode = state.granularity?.assessments ?? {};
    expect(byNode["node-fix-typo-abc123"]?.decision).toBe("leaf");
    expect(byNode["node-fix-typo-abc123"]?.complexityScore).toBe(0.78);
    expect(byNode["node-module-def456"]?.decision).toBe("composite");
    expect(byNode["node-module-def456"]?.recommendedBranchingFactor).toBe(4);
    expect(state.granularity?.criticDecisions).toHaveLength(1);
  });

  it("is rejected outside planning-compatible lifecycles", () => {
    const assessed = events()[1]!;
    const sequence = [
      events()[0]!,
      { ...base, eventId: "e2b", sequence: 2, type: "planning.failed", payload: { reason: "model unavailable" } } as RunEvent,
      { ...assessed, eventId: "e3", sequence: 3 } as RunEvent
    ];

    expect(() => foldRun(sequence)).toThrow(/planning facts/i);
  });
});
