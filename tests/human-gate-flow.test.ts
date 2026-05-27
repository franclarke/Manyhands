import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  runBenchmarkMockFlow,
  type BenchmarkMockFlowResult
} from "@manyhands/core";
import type { RunSnapshot } from "@manyhands/run-store";

const manifestPath = path.resolve(process.cwd(), "benchmarks/conflict-v0/benchmark.json");

describe("human-gated mock benchmark flow", () => {
  let result: BenchmarkMockFlowResult;

  beforeAll(async () => {
    result = await runBenchmarkMockFlow({
      manifestPath,
      createdAt: "1970-01-01T00:00:00.000Z"
    });
  });

  it("keeps high and blocking pairs out of B3 batches", () => {
    for (const snapshot of snapshotsFor("B3", result)) {
      for (const batch of snapshot.scheduledBatches) {
        expect(batchContainsHighOrBlockingPair(snapshot, batch.taskIds)).toBe(false);
      }
    }
  });

  it("records deterministic gate decisions for B4", () => {
    const b4Snapshots = snapshotsFor("B4", result);

    expect(b4Snapshots.some((snapshot) =>
      snapshot.traceEvents.some((event) => event.type === "human_gate_decision_recorded")
    )).toBe(true);
    expect(b4Snapshots.some((snapshot) =>
      snapshot.traceEvents.some((event) => event.type === "human_gate_required")
    )).toBe(true);
  });

  it("serializes blocking work after mock review", () => {
    const schemaB4 = result.snapshots.find((snapshot) =>
      snapshot.runId.includes(":B4:") && snapshot.featureId === "shared-schema-conflict"
    );

    expect(schemaB4).toBeDefined();
    expect(schemaB4?.scheduledBatches.some((batch) => batch.id.startsWith("gate-batch-"))).toBe(true);
    expect(schemaB4?.blockedTasks).toHaveLength(0);
  });

  it("produces deterministic scope violation failures from mock overrides", () => {
    const scopeSnapshots = result.snapshots.filter((snapshot) => snapshot.featureId === "scope-violation-simulated");

    expect(scopeSnapshots.some((snapshot) => snapshot.status === "failed")).toBe(true);
    expect(scopeSnapshots.some((snapshot) =>
      snapshot.scopeValidationResults.some((scopeResult) => scopeResult.violations.length > 0)
    )).toBe(true);
  });
});

function snapshotsFor(configurationId: string, result: BenchmarkMockFlowResult): RunSnapshot[] {
  return result.snapshots.filter((snapshot) => snapshot.runId.includes(`:${configurationId}:`));
}

function batchContainsHighOrBlockingPair(snapshot: RunSnapshot, taskIds: readonly string[]): boolean {
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
