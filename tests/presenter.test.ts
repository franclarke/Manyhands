import { describe, expect, it } from "vitest";
import { toRunPreview, toRunResponse } from "@/lib/server/runs/presenter";
import type { Workspace } from "@/lib/api-types";
import type { RunRecord } from "@/lib/server/runs/schema";
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
  totalDurationMs: 1234,
  linesChanged: 3,
  unexpectedCommitCount: 0,
  scopeViolationCount: 0
};

const EXECUTION: RunExecutionResult = {
  runId: "run-1",
  status: "completed",
  leafResults: [
    {
      taskId: "leaf-a",
      status: "success",
      baseHead: "BASE",
      currentHead: "SHA_A",
      agentCommittedUnexpectedly: false,
      diff: "patch",
      changedFiles: ["src/a.ts", "src/b.ts"],
      commitSha: "SHA_A",
      scopeCheck: { passed: true, violations: [], outOfScope: [] },
      executorExitCode: 0,
      executorDurationMs: 500,
      executorTimedOut: false,
      costUsd: 0.02
    }
  ],
  integrationResults: [
    { compositeTaskId: "root", status: "success", childResults: [], repairAttempted: false,
        preMergeFindings: [] }
  ],
  granularityVector: VECTOR,
  totalDurationMs: 1234
};

function baseRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gpt-5-codex",
    userPrompt: "Build it.",
    title: "Build it.",
    version: 0,
    status: "completed",
    createdAt: "2026-05-29T00:00:00.000Z",
    updatedAt: "2026-05-29T00:01:00.000Z",
    patches: [],
    ...overrides
  };
}

describe("presenter â€” execution summary", () => {
  it("exposes the execution summary, granularity vector, and per-leaf receipts", () => {
    const { run } = toRunResponse(baseRun({ execution: EXECUTION }));

    expect(run.execution).toBeDefined();
    expect(run.execution?.status).toBe("completed");
    expect(run.execution?.granularityVector.leafCount).toBe(1);
    expect(run.execution?.leaves).toHaveLength(1);
    const receipt = run.execution?.leaves[0];
    expect(receipt?.taskId).toBe("leaf-a");
    expect(receipt?.changedFiles).toBe(2);
    expect(receipt?.commitSha).toBe("SHA_A");
    expect(receipt?.scopePassed).toBe(true);
    expect(receipt?.costUsd).toBe(0.02);
    expect(run.execution?.integrations[0]?.compositeTaskId).toBe("root");
  });

  it("omits execution when the run has none", () => {
    const { run } = toRunResponse(baseRun());
    expect(run.execution).toBeUndefined();
  });

  it("derives preview agentCount from leafResults (not the legacy mock shape)", () => {
    const preview = toRunPreview(baseRun({ execution: EXECUTION }), new Map());
    expect(preview.agentCount).toBe(1);
  });

  it("publishes the canonical workspace id when an alias map entry resolves the run", () => {
    const canonical: Workspace = {
      id: "ws-canonical",
      slug: "canonical",
      name: "Canonical",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };
    const preview = toRunPreview(
      baseRun({ workspaceId: "ws-legacy" }),
      new Map([["ws-legacy", canonical]])
    );

    expect(preview.workspaceId).toBe("ws-canonical");
    expect(preview.workspaceName).toBe("Canonical");
    expect(toRunResponse(baseRun({ workspaceId: "ws-legacy" }), canonical.id).run.workspaceId).toBe(
      "ws-canonical"
    );
  });

  it("does not throw when a persisted run has a partial planning object (no summary/riskMatrix)", () => {
    // A failed run can carry a partial planning snapshot shaped like
    // `{ decomposition: { graph } }` with neither `summary` nor `riskMatrix`.
    // toRunPreview must not assume those fields exist, or a single bad record
    // 500s the whole `/api/runs` list.
    const partialPlanning = {
      decomposition: { graph: { rootId: "root", nodes: {}, dependencies: [] } }
    } as unknown as RunRecord["planning"];

    const preview = toRunPreview(
      baseRun({ status: "failed", planning: partialPlanning }),
      new Map()
    );

    expect(preview.nodeCount).toBeUndefined();
    expect(preview.coordinationRiskCount).toBeUndefined();
  });
});
