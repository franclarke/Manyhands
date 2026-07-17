import type { ExecutionSummary } from "@/lib/api-types";
import type { RunExecutionResult } from "@manyhands/execution-core";

/**
 * Narrows the opaque `run.execution` field to a real-engine RunExecutionResult.
 * Distinguishes it from the legacy imported execution projection (which has
 * `results`/`planning`, not `leafResults`/`granularityVector`).
 */
export function isExecutionResult(value: unknown): value is RunExecutionResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "granularityVector" in value &&
    Array.isArray((value as { leafResults?: unknown }).leafResults)
  );
}

/** Compact, serializable execution summary + per-leaf receipts for the API/UI. */
export function toExecutionSummary(result: RunExecutionResult): ExecutionSummary {
  return {
    status: result.status,
    totalDurationMs: result.totalDurationMs,
    granularityVector: result.granularityVector,
    leaves: result.leafResults.map((leaf) => {
      const receipt: ExecutionSummary["leaves"][number] = {
        taskId: leaf.taskId,
        status: leaf.status,
        changedFiles: leaf.changedFiles.length,
        scopePassed: leaf.scopeCheck.passed,
        durationMs: leaf.executorDurationMs
      };
      if (leaf.commitSha !== undefined) receipt.commitSha = leaf.commitSha;
      if (leaf.costUsd !== undefined) receipt.costUsd = leaf.costUsd;
      return receipt;
    }),
    integrations: result.integrationResults.map((integration) => ({
      compositeTaskId: integration.compositeTaskId,
      status: integration.status
    }))
  };
}
