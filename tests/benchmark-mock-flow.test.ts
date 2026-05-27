import { beforeAll, describe, expect, it } from "vitest";
import {
  runBenchmarkMockFlow,
  type BenchmarkMockFlowResult
} from "@manyhands/core";
import {
  BenchmarkReportSchema,
  type EvaluationConfiguration
} from "@manyhands/evaluator";

describe("Benchmark mock flow", () => {
  let result: BenchmarkMockFlowResult;

  beforeAll(async () => {
    result = await runBenchmarkMockFlow({
      createdAt: "1970-01-01T00:00:00.000Z"
    });
  });

  it("executes multiple features and configurations", () => {
    expect(result.features).toHaveLength(5);
    expect(result.report.configurationIds).toEqual(["B0", "B1", "B2", "B3"]);
    expect(result.snapshots).toHaveLength(20);
  });

  it("B0 produces one structural leaf task per feature", () => {
    const b0Snapshots = snapshotsFor("B0", result);

    expect(b0Snapshots).toHaveLength(5);

    for (const snapshot of b0Snapshots) {
      expect(snapshot.contracts).toHaveLength(1);
      expect(snapshot.scheduledBatches).toHaveLength(1);
      expect(snapshot.runId).toContain(":B0:");
    }
  });

  it("B1 uses sequential DAG scheduling", () => {
    for (const snapshot of snapshotsFor("B1", result)) {
      expect(snapshot.summary).toEqual(expect.objectContaining({ planning: expect.any(Object) }));
      expect(snapshot.scheduledBatches.every((batch) => batch.taskIds.length <= 1)).toBe(true);
    }
  });

  it("B2 can batch independent ready tasks with naive parallel scheduling", () => {
    expect(snapshotsFor("B2", result).some((snapshot) =>
      snapshot.scheduledBatches.some((batch) => batch.taskIds.length > 1)
    )).toBe(true);
  });

  it("B3 uses static repository signals and risk-aware scheduling", () => {
    const b3Snapshots = snapshotsFor("B3", result);

    expect(b3Snapshots).toHaveLength(5);

    for (const snapshot of b3Snapshots) {
      expect(snapshot.staticConflictSignals.length).toBeGreaterThan(0);
      expect(snapshot.repositoryIndexHash).toBeDefined();
      expect(snapshot.scheduledBatches.every((batch) => !batchContainsHighRiskPair(snapshot, batch.taskIds))).toBe(true);
    }
  });

  it("keeps run ids unique by feature and configuration", () => {
    const runIds = result.snapshots.map((snapshot) => snapshot.runId);

    expect(new Set(runIds).size).toBe(runIds.length);
  });

  it("supports feature and configuration filters", async () => {
    const filtered = await runBenchmarkMockFlow({
      featureIds: ["passwordless-login"],
      configurationIds: ["B3"],
      createdAt: "1970-01-01T00:00:00.000Z"
    });

    expect(filtered.snapshots).toHaveLength(1);
    expect(filtered.report.featureIds).toEqual(["passwordless-login"]);
    expect(filtered.report.configurationIds).toEqual(["B3"]);
  });

  it("returns a schema-valid benchmark report", () => {
    expect(BenchmarkReportSchema.safeParse(result.report).success).toBe(true);
    expect(result.report.metadata.reportHash).toBeDefined();
  });
});

function snapshotsFor(configurationId: EvaluationConfiguration, result: BenchmarkMockFlowResult) {
  return result.snapshots.filter((snapshot) => snapshot.runId.includes(`:${configurationId}:`));
}

function batchContainsHighRiskPair(
  snapshot: BenchmarkMockFlowResult["snapshots"][number],
  taskIds: readonly string[]
): boolean {
  for (let leftIndex = 0; leftIndex < taskIds.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < taskIds.length; rightIndex += 1) {
      const left = taskIds[leftIndex];
      const right = taskIds[rightIndex];

      if (!left || !right) {
        continue;
      }

      const prediction = snapshot.riskPredictions.find((candidate) =>
        (candidate.taskAId === left && candidate.taskBId === right) ||
        (candidate.taskAId === right && candidate.taskBId === left)
      );

      if (prediction?.level === "high" || prediction?.level === "blocking") {
        return true;
      }
    }
  }

  return false;
}
