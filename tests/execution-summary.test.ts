import { describe, expect, it } from "vitest";
import { isExecutionResult, toExecutionSummary } from "@/lib/execution-summary";
import type { GranularityVector, RunExecutionResult } from "@manyhands/execution-core";

const VECTOR: GranularityVector = {
  depth: 1,
  leafCount: 1,
  compositeCount: 1,
  avgLeafDepth: 1,
  maxLeafDepth: 1,
  dependencyCount: 0,
  avgAcceptanceCriteriaPerLeaf: 1,
  integrationSuccessRate: 1,
  leafSuccessRate: 1,
  conflictRate: 0,
  totalDurationMs: 10,
  linesChanged: 2,
  unexpectedCommitCount: 0,
  scopeViolationCount: 0
};

const RESULT: RunExecutionResult = {
  runId: "r1",
  status: "completed",
  leafResults: [
    {
      taskId: "a",
      status: "success",
      baseHead: "BASE",
      currentHead: "SHA",
      agentCommittedUnexpectedly: false,
      diff: "d",
      changedFiles: ["src/a.ts"],
      commitSha: "SHA",
      scopeCheck: { passed: true, violations: [], outOfScope: [] },
      executorExitCode: 0,
      executorDurationMs: 5,
      executorTimedOut: false
    }
  ],
  integrationResults: [],
  granularityVector: VECTOR,
  totalDurationMs: 10
};

describe("isExecutionResult", () => {
  it("accepts a real RunExecutionResult", () => {
    expect(isExecutionResult(RESULT)).toBe(true);
  });

  it("rejects the legacy mock execution shape and non-objects", () => {
    expect(isExecutionResult({ results: [], planning: {} })).toBe(false);
    expect(isExecutionResult(undefined)).toBe(false);
    expect(isExecutionResult(null)).toBe(false);
  });
});

describe("toExecutionSummary", () => {
  it("maps status, granularity vector, and per-leaf receipts", () => {
    const summary = toExecutionSummary(RESULT);
    expect(summary.status).toBe("completed");
    expect(summary.granularityVector.leafCount).toBe(1);
    expect(summary.leaves[0]).toMatchObject({
      taskId: "a",
      changedFiles: 1,
      commitSha: "SHA",
      scopePassed: true,
      durationMs: 5
    });
  });
});
