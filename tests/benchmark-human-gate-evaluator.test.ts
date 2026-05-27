import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  runBenchmarkMockFlow,
  type BenchmarkMockFlowResult
} from "@manyhands/core";
import {
  BENCHMARK_REPORT_SCHEMA_VERSION,
  BenchmarkReportSchema,
  evaluateBenchmarkRuns
} from "@manyhands/evaluator";

const manifestPath = path.resolve(process.cwd(), "benchmarks/conflict-v0/benchmark.json");

describe("benchmark report human gate metrics", () => {
  let result: BenchmarkMockFlowResult;

  beforeAll(async () => {
    result = await runBenchmarkMockFlow({
      manifestPath,
      createdAt: "1970-01-01T00:00:00.000Z"
    });
  });

  it("includes human gate metrics for B4", () => {
    const b4 = result.report.configurations.find((configuration) => configuration.configurationId === "B4");

    expect(b4).toBeDefined();
    expect(b4?.avgGateRequiredCount).toBeGreaterThan(0);
    expect(b4?.avgSerializedByGateCount).toBeGreaterThan(0);
    expect(b4?.avgMockReviewCount).toBeGreaterThan(0);
  });

  it("includes new methodological warnings", () => {
    const warningCodes = result.report.warnings.map((warning) => warning.code);

    expect(warningCodes).toEqual(expect.arrayContaining([
      "benchmark_mock_only",
      "controlled_conflict_fixture",
      "human_gate_is_mock",
      "blocking_risk_does_not_equal_real_merge_conflict",
      "scope_violation_is_simulated"
    ]));
  });

  it("emits a schema-valid benchmark report v2 artifact", () => {
    expect(BenchmarkReportSchema.safeParse(result.report).success).toBe(true);
    expect(result.report.metadata.schemaVersion).toBe(BENCHMARK_REPORT_SCHEMA_VERSION);
    expect(result.report.metadata.schemaVersion).toBe("manyhands.benchmark-report.v2");
  });

  it("produces deterministic report hashes when timestamps differ", () => {
    const runs = result.runs.map((run) => ({
      configurationId: run.configuration.id,
      snapshot: run.result.snapshot
    }));
    const first = evaluateBenchmarkRuns({
      manifest: result.manifest,
      runs,
      createdAt: "1970-01-01T00:00:00.000Z"
    });
    const second = evaluateBenchmarkRuns({
      manifest: result.manifest,
      runs,
      createdAt: "1970-01-02T00:00:00.000Z"
    });

    expect(first.metadata.reportHash).toBe(second.metadata.reportHash);
  });
});
