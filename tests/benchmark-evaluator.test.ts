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

describe("Benchmark evaluator", () => {
  let result: BenchmarkMockFlowResult;

  beforeAll(async () => {
    result = await runBenchmarkMockFlow({
      createdAt: "1970-01-01T00:00:00.000Z"
    });
  });

  it("aggregates metrics by configuration", () => {
    const rows = new Map(result.report.configurations.map((row) => [row.configurationId, row]));

    expect(rows.get("B0")?.runCount).toBe(5);
    expect(rows.get("B0")?.avgLeafCount).toBe(1);
    expect(rows.get("B1")?.avgBatchCount).toBeGreaterThan(rows.get("B2")?.avgBatchCount ?? 0);
    expect(rows.get("B3")?.avgStaticSignalCount).toBeGreaterThan(0);
  });

  it("includes mandatory benchmark methodology warnings", () => {
    const codes = result.report.warnings.map((warning) => warning.code);

    expect(codes).toEqual(expect.arrayContaining([
      "benchmark_mock_only",
      "single_task_baseline_is_structural",
      "mock_execution_only",
      "no_real_agent_results",
      "no_real_tests_executed"
    ]));
  });

  it("emits a schema-valid benchmark report artifact", () => {
    expect(BenchmarkReportSchema.safeParse(result.report).success).toBe(true);
    expect(result.report.metadata.schemaVersion).toBe(BENCHMARK_REPORT_SCHEMA_VERSION);
    expect(result.report.featureIds).toHaveLength(5);
    expect(result.report.runs).toHaveLength(20);
  });

  it("produces deterministic report hashes when report timestamps differ", () => {
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

  it("serializes and validates as JSON", () => {
    const parsed: unknown = JSON.parse(JSON.stringify(result.report));

    expect(BenchmarkReportSchema.safeParse(parsed).success).toBe(true);
  });
});
