import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { runMockExecutionFlow } from "@manyhands/core";
import {
  EVALUATION_REPORT_SCHEMA_VERSION,
  EvaluationReportSchema,
  compareRunSnapshots,
  evaluateRunSnapshot,
  evaluateRunSnapshots
} from "@manyhands/evaluator";
import { buildRepositoryIndex } from "@manyhands/repository-index";
import { RunSnapshotSchema, type RunSnapshot } from "@manyhands/run-store";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");
const repositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

describe("Evaluator v0", () => {
  let snapshots: RunSnapshot[];
  let balancedWithoutStaticSignals: RunSnapshot;

  beforeAll(async () => {
    const repositoryIndex = await buildRepositoryIndex({
      rootPath: repositoryPath,
      repositoryId: "aprobado-lite"
    });
    const modes = ["coarse", "balanced", "fine"] as const;
    const runs = await Promise.all(
      modes.map((mode) => runMockExecutionFlow({ fixturePath, mode, repositoryIndex }))
    );

    snapshots = runs.map((run) => run.snapshot);
    balancedWithoutStaticSignals = (await runMockExecutionFlow({ fixturePath, mode: "balanced" })).snapshot;
  });

  it("calculates core metrics for a valid snapshot", () => {
    const evaluated = evaluateRunSnapshot(snapshots[1] as RunSnapshot);

    expect(evaluated.metrics.graph.leafCount).toBe(7);
    expect(evaluated.metrics.contracts.contractCount).toBe(7);
    expect(evaluated.metrics.conflictRisk.predictionCount).toBeGreaterThan(0);
    expect(evaluated.metrics.conflictRisk.staticSignalCount).toBeGreaterThan(0);
    expect(evaluated.metrics.scheduling.batchCount).toBeGreaterThan(0);
    expect(evaluated.metrics.execution.executedTasks).toBe(7);
    expect(evaluated.metrics.traceability.hasInputHash).toBe(true);
    expect(evaluated.metrics.traceability.hasOutputHash).toBe(true);
  });

  it("builds a schema-valid evaluation report", () => {
    const report = evaluateRunSnapshots(snapshots, {
      createdAt: "1970-01-01T00:00:00.000Z"
    });

    expect(EvaluationReportSchema.safeParse(report).success).toBe(true);
    expect(report.metadata.schemaVersion).toBe(EVALUATION_REPORT_SCHEMA_VERSION);
    expect(report.metadata.reportHash).toBeDefined();
    expect(report.comparison?.rows.map((row) => row.mode)).toEqual(["coarse", "balanced", "fine"]);
  });

  it("emits methodological warnings for mock runs", () => {
    const report = evaluateRunSnapshots(snapshots, {
      createdAt: "1970-01-01T00:00:00.000Z"
    });
    const warningCodes = report.warnings.map((warning) => warning.code);

    expect(warningCodes).toEqual(
      expect.arrayContaining([
        "mock_execution_only",
        "no_real_agent_results",
        "no_real_tests_executed",
        "small_fixture_only",
        "static_signals_are_heuristic"
      ])
    );
  });

  it("warns when static signals are missing", () => {
    const evaluated = evaluateRunSnapshot(balancedWithoutStaticSignals);

    expect(evaluated.warnings.map((warning) => warning.code)).toContain("missing_static_signals");
  });

  it("warns when snapshot hashes are missing", () => {
    const metadataWithoutHashes = { ...balancedWithoutStaticSignals.metadata };
    delete metadataWithoutHashes.inputHash;
    delete metadataWithoutHashes.outputHash;
    const snapshotWithoutHashes = RunSnapshotSchema.parse({
      ...balancedWithoutStaticSignals,
      metadata: metadataWithoutHashes
    });
    const evaluated = evaluateRunSnapshot(snapshotWithoutHashes);

    expect(evaluated.warnings.map((warning) => warning.code)).toContain("missing_hashes");
  });

  it("warns when comparing different feature ids", () => {
    const mismatched = RunSnapshotSchema.parse({
      ...snapshots[0],
      featureId: "different-feature"
    });
    const warnings = compareRunSnapshots(snapshots[0] as RunSnapshot, mismatched);

    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: "incompatible_feature_ids",
        severity: "error"
      })
    );
  });

  it("produces deterministic report hashes when timestamps differ", () => {
    const first = evaluateRunSnapshots(snapshots, {
      createdAt: "1970-01-01T00:00:00.000Z"
    });
    const second = evaluateRunSnapshots(snapshots, {
      createdAt: "1970-01-02T00:00:00.000Z"
    });

    expect(first.metadata.reportHash).toBe(second.metadata.reportHash);
  });
});
