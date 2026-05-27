import { beforeAll, describe, expect, it } from "vitest";
import {
  runGranularityComparisonFlow,
  type GranularityComparisonFlowResult
} from "@manyhands/core";
import { EvaluationReportSchema } from "@manyhands/evaluator";

describe("granularity comparison flow", () => {
  let result: GranularityComparisonFlowResult;

  beforeAll(async () => {
    result = await runGranularityComparisonFlow({
      createdAt: "1970-01-01T00:00:00.000Z"
    });
  });

  it("produces deterministic snapshots for coarse, balanced and fine modes", () => {
    expect(result.snapshots).toHaveLength(3);
    expect(result.snapshots.map((snapshot) => snapshot.decompositionMode)).toEqual([
      "coarse",
      "balanced",
      "fine"
    ]);
  });

  it("uses static repository signals by default", () => {
    expect(result.repositoryIndexHash).toBeDefined();

    for (const snapshot of result.snapshots) {
      expect(snapshot.repositoryIndexHash).toBe(result.repositoryIndexHash);
      expect(snapshot.staticConflictSignals.length).toBeGreaterThan(0);
    }
  });

  it("returns a schema-valid granularity comparison report", () => {
    expect(EvaluationReportSchema.safeParse(result.report).success).toBe(true);
    expect(result.report.mode).toBe("granularity_comparison");
    expect(result.report.comparison?.rows).toHaveLength(3);
  });

  it("includes structural comparison observations", () => {
    expect(result.report.comparison?.observations.map((observation) => observation.code)).toEqual(
      expect.arrayContaining([
        "mock_structural_only",
        "fine_increases_coordination_surface",
        "balanced_is_intermediate"
      ])
    );
  });

  it("can be serialized as a validated JSON evaluation artifact", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(result.report));

    expect(EvaluationReportSchema.safeParse(parsed).success).toBe(true);
  });
});
