import type {
  MockExecutionFlowResult,
  MockPlanningFlowResult,
  RunSnapshot
} from "@manyhands/core";
import { applyPatches } from "@/lib/server/runs/patches";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";

/**
 * Project a Fase B RunRecord into a RunSnapshot-shaped object that toRunGraphViewModel
 * can consume. We never re-validate the result through the core Zod schema because the
 * intermediate planning snapshot is intentionally partial (no agent results yet).
 */
export function projectRunRecordToSnapshot(
  run: RunRecord,
  options: { applyPatches?: boolean } = {}
): RunSnapshot | null {
  const shouldApplyPatches = options.applyPatches ?? true;
  let snapshot: RunSnapshot | null = null;
  if (run.execution !== undefined) {
    const execution = run.execution as MockExecutionFlowResult;
    if (execution.snapshot !== undefined) {
      snapshot = execution.snapshot;
    }
  }
  if (snapshot === null && run.planning !== undefined) {
    snapshot = buildPlanningSnapshot(run, run.planning as MockPlanningFlowResult);
  }
  if (snapshot === null || !shouldApplyPatches) {
    return snapshot;
  }
  return applyPatches(snapshot, run.patches ?? []);
}

function buildPlanningSnapshot(run: RunRecord, planning: MockPlanningFlowResult): RunSnapshot {
  return {
    runId: run.runId,
    featureId: planning.decomposition.feature.id,
    status: snapshotStatusFor(run.status),
    decompositionMode: planning.summary.mode,
    featureRequest: planning.decomposition.feature,
    graphSnapshot: planning.decomposition.graph,
    contracts: planning.decomposition.contracts,
    riskPredictions: planning.riskMatrix,
    staticConflictSignals: planning.staticConflictSignals,
    scheduledBatches: planning.schedule.batches,
    blockedTasks: [],
    agentRunResults: [],
    scopeValidationResults: [],
    traceEvents: planning.traces,
    summary: planning.summary,
    metadata: {
      schemaVersion: "manyhands.run-snapshot.v1",
      createdAt: run.createdAt,
      deterministic: true
    }
  } as RunSnapshot;
}

function snapshotStatusFor(status: RunStatus): RunSnapshot["status"] {
  switch (status) {
    case "completed":
      return "executed";
    case "failed":
      return "failed";
    default:
      return "planned";
  }
}
