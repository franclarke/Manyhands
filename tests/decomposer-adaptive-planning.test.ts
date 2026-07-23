import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_GRANULARITY_FORMULA_VERSION,
  applyAdaptiveGranularity,
  LEAF_COMPLEXITY_THRESHOLD,
  WorkBreakdownSchema,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";

/**
 * Productive adaptive-granularity planning (stage 3, decision D-2/D-7).
 *
 * `applyAdaptiveGranularity` reshapes the semantic WorkBreakdown emitted by the
 * Planner using the deterministic C_task policy BEFORE graph compilation. It
 * must emit the same canonical WorkUnit tree the Graph Compiler consumes — no
 * parallel graph model — and it must preserve the planner's semantic fields on
 * every surviving unit.
 */

function breakdownWith(root: WorkUnit, extras: Partial<WorkBreakdown> = {}): WorkBreakdown {
  return WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: "breakdown-adaptive",
    objective: "Deliver the requested feature",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: [{ id: "intent-1", description: "Feature works end to end", required: true }],
    repositoryEvidence: [
      { id: "path-1", kind: "path", reference: "src/service.ts", observation: "Existing service module", confidence: 1 }
    ],
    root,
    ...extras
  });
}

function leaf(key: string, paths: string[], signals?: { scopeRadius: number; interfaceImpact: number; validationSurface: number; contextTokenMass: number }): WorkUnit {
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
    ...(signals === undefined ? {} : { complexitySignals: signals })
  };
}

describe("adaptive granularity in productive planning", () => {
  it("keeps a simple task as a single leaf (no artificial split)", () => {
    const breakdown = breakdownWith(leaf("fix-typo", ["src/service.ts"], {
      scopeRadius: 1, interfaceImpact: 0.5, validationSurface: 1, contextTokenMass: 0.5
    }));

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.breakdown.root.kind).toBe("leaf");
    expect(result.assessments["fix-typo"]?.isLeaf).toBe(true);
    expect(result.assessments["fix-typo"]?.complexityScore).toBeLessThanOrEqual(LEAF_COMPLEXITY_THRESHOLD);
    expect(result.formulaVersion).toBe(ADAPTIVE_GRANULARITY_FORMULA_VERSION);
    // The reshaped breakdown must still be schema-valid for the Graph Compiler.
    expect(() => WorkBreakdownSchema.parse(result.breakdown)).not.toThrow();
  });

  it("collapses a composite whose assessed complexity is below the leaf threshold", () => {
    const breakdown = breakdownWith({
      key: "root",
      kind: "composite",
      title: "Trivial feature",
      objective: "Tiny change split needlessly by the planner",
      concerns: ["root concern"],
      expectedOutcomes: ["root outcome"],
      acceptanceIntentIds: ["intent-1"],
      evidenceIds: [],
      plannedPaths: ["src/service.ts"],
      complexitySignals: { scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1 },
      cut: { criterion: "cohesion", rationale: "planner split" },
      children: [
        leaf("part-a", ["src/service.ts"], { scopeRadius: 1, interfaceImpact: 0.5, validationSurface: 1, contextTokenMass: 0.5 }),
        leaf("part-b", ["src/service.ts"], { scopeRadius: 1, interfaceImpact: 0.5, validationSurface: 1, contextTokenMass: 0.5 })
      ]
    });

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.breakdown.root.kind).toBe("leaf");
    expect(result.assessments["root"]?.isLeaf).toBe(true);
  });

  it("keeps a complex composite split and preserves the planner's semantic fields", () => {
    const childA = leaf("api-surface", ["src/api.ts", "src/types.ts", "tests/api.test.ts"], {
      scopeRadius: 3, interfaceImpact: 6, validationSurface: 5, contextTokenMass: 5
    });
    const breakdown = breakdownWith({
      key: "root",
      kind: "composite",
      title: "Complete module",
      objective: "Implement a full module",
      concerns: ["module"],
      expectedOutcomes: ["module works"],
      acceptanceIntentIds: ["intent-1"],
      evidenceIds: [],
      plannedPaths: ["src/api.ts", "src/runtime.ts", "src/store.ts", "tests/module.test.ts"],
      complexitySignals: { scopeRadius: 8, interfaceImpact: 8, validationSurface: 7, contextTokenMass: 8 },
      cut: { criterion: "cohesion", rationale: "independent surfaces" },
      children: [
        childA,
        leaf("runtime", ["src/runtime.ts", "src/store.ts"], { scopeRadius: 2, interfaceImpact: 3, validationSurface: 4, contextTokenMass: 4 })
      ]
    });

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.breakdown.root.kind).toBe("composite");
    const root = result.breakdown.root as Extract<WorkUnit, { kind: "composite" }>;
    const api = root.children.find((child) => child.key === "api-surface");
    expect(api).toBeDefined();
    // Semantic fields authored by the planner survive the adaptive pass.
    expect(api?.title).toBe("Unit api-surface");
    expect(api?.concerns).toEqual(["concern-api-surface"]);
    expect(api?.expectedOutcomes).toEqual(["outcome-api-surface"]);
    expect(api?.acceptanceIntentIds).toEqual(["intent-1"]);
    expect(result.assessments["root"]?.isLeaf).toBe(false);
  });

  it("coalesces trivial dependency-free siblings that touch the same file", () => {
    const breakdown = breakdownWith({
      key: "root",
      kind: "composite",
      title: "Feature",
      objective: "Two trivial edits in the same module",
      concerns: ["root"],
      expectedOutcomes: ["done"],
      acceptanceIntentIds: ["intent-1"],
      evidenceIds: [],
      plannedPaths: ["src/service.ts"],
      complexitySignals: { scopeRadius: 4, interfaceImpact: 5, validationSurface: 4, contextTokenMass: 4 },
      cut: { criterion: "cohesion", rationale: "planner split" },
      children: [
        leaf("edit-one", ["src/service.ts"], { scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1 }),
        leaf("edit-two", ["src/service.ts"], { scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1 }),
        leaf("big-piece", ["src/api.ts", "src/types.ts"], { scopeRadius: 3, interfaceImpact: 6, validationSurface: 5, contextTokenMass: 6 })
      ]
    });

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.coalescedUnitsCount).toBeGreaterThanOrEqual(1);
    expect(result.criticDecisions.some((decision) => decision.kind === "coalesced")).toBe(true);
    const root = result.breakdown.root as Extract<WorkUnit, { kind: "composite" }>;
    // The two trivial edits collapsed into one unit; the big piece survives.
    expect(root.children).toHaveLength(2);
    expect(() => WorkBreakdownSchema.parse(result.breakdown)).not.toThrow();
  });

  it("re-splits an apparent leaf whose scope is too broad", () => {
    const breakdown = breakdownWith({
      key: "root",
      kind: "composite",
      title: "Feature",
      objective: "Contains an oversized leaf",
      concerns: ["root"],
      expectedOutcomes: ["done"],
      acceptanceIntentIds: ["intent-1"],
      evidenceIds: [],
      plannedPaths: ["src/a.ts"],
      complexitySignals: { scopeRadius: 6, interfaceImpact: 6, validationSurface: 6, contextTokenMass: 6 },
      cut: { criterion: "cohesion", rationale: "planner split" },
      children: [
        // C_task under threshold but 5 modules wide: the under-splitting critic
        // must force a composite re-split.
        leaf("broad-leaf", ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"], {
          scopeRadius: 5, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1
        }),
        leaf("other", ["src/z.ts"], { scopeRadius: 1, interfaceImpact: 1, validationSurface: 5, contextTokenMass: 5 })
      ]
    });

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.criticDecisions.some((decision) => decision.kind === "resplit_required")).toBe(true);
    const root = result.breakdown.root as Extract<WorkUnit, { kind: "composite" }>;
    const broad = root.children.find((child) => child.key === "broad-leaf");
    expect(broad?.kind).toBe("composite");
    expect(() => WorkBreakdownSchema.parse(result.breakdown)).not.toThrow();
  });

  it("derives deterministic signals when the planner omits them and clamps incoherent LLM signals", () => {
    const breakdown = breakdownWith({
      key: "root",
      kind: "composite",
      title: "Feature",
      objective: "Signals partially missing / incoherent",
      concerns: ["root"],
      expectedOutcomes: ["done"],
      acceptanceIntentIds: ["intent-1"],
      evidenceIds: [],
      plannedPaths: ["src/a.ts"],
      complexitySignals: { scopeRadius: 6, interfaceImpact: 6, validationSurface: 6, contextTokenMass: 6 },
      cut: { criterion: "cohesion", rationale: "split" },
      children: [
        // No signals at all: must be derived from the unit's declared surface.
        leaf("no-signals", ["src/a.ts", "src/b.ts"]),
        // Understated scopeRadius (1) against 8 declared paths: must be clamped up.
        leaf("understated", [
          "src/m1.ts", "src/m2.ts", "src/m3.ts", "src/m4.ts", "src/m5.ts", "src/m6.ts", "src/m7.ts", "src/m8.ts"
        ], { scopeRadius: 1, interfaceImpact: 2, validationSurface: 2, contextTokenMass: 2 })
      ]
    });

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.assessments["no-signals"]?.signalSource).toBe("derived");
    expect(result.assessments["understated"]?.signalSource).toBe("clamped");
    expect(result.assessments["understated"]?.dimensions.scopeRadius).toBeGreaterThanOrEqual(4);
  });

  it("reports structural thesis metrics without governing lifecycle", () => {
    const breakdown = breakdownWith(leaf("only", ["src/service.ts"], {
      scopeRadius: 1, interfaceImpact: 1, validationSurface: 1, contextTokenMass: 1
    }));

    const result = applyAdaptiveGranularity({ breakdown });

    expect(result.metrics.totalLeafCount).toBe(1);
    expect(result.metrics.maxGraphDepth).toBe(0);
    expect(result.metrics.coalescedUnitsCount).toBe(0);
  });
});
