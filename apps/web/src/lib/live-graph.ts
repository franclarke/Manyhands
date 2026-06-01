import type {
  MockExecutionFlowResult,
  MockPlanningFlowResult,
  RunSnapshot
} from "@manyhands/core";
import { applyPatches } from "@/lib/server/runs/patches";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";

/** Minimal shape of a real execution-core RunExecutionResult (opaque in the record). */
interface RealExecutionResult {
  leafResults?: ReadonlyArray<RealLeafResult>;
}

interface RealLeafResult {
  taskId: string;
  status: string;
  diff: string;
  changedFiles: string[];
  commitSha?: string;
  scopeCheck: { passed: boolean; violations: string[] };
  validationResult?: { passed: boolean };
  executorDurationMs: number;
  executorExitCode: number;
  executorTimedOut: boolean;
  stderrTail?: string;
  stdoutTail?: string;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

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
    const execution = run.execution as MockExecutionFlowResult & RealExecutionResult;
    if (execution.snapshot !== undefined) {
      // Legacy mock execution flow carries its own pre-built snapshot.
      snapshot = execution.snapshot;
    } else if (Array.isArray(execution.leafResults) && run.planning !== undefined) {
      // Real execution-core RunExecutionResult: overlay leaf results + execution
      // traces onto the planning structure so the canvas/inspector/trace tab
      // project the real (possibly failed) execution instead of "No execution yet".
      snapshot = buildExecutionSnapshot(run, run.planning as MockPlanningFlowResult, execution);
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

/**
 * Maps a real RunExecutionResult onto the planning snapshot: each leaf result
 * becomes an agentRunResult (so statusForNode resolves done/failed instead of
 * the planned fallback), and the persisted execution traces are merged in so the
 * Trace tab shows worktree/executor/integration events per task.
 */
function buildExecutionSnapshot(
  run: RunRecord,
  planning: MockPlanningFlowResult,
  execution: RealExecutionResult
): RunSnapshot {
  const base = buildPlanningSnapshot(run, planning);
  const agentRunResults = (execution.leafResults ?? []).map((leaf) =>
    leafToAgentRunResult(run.runId, leaf)
  );
  const executionTraces = (run.executionTraces ?? []) as RunSnapshot["traceEvents"];
  return {
    ...base,
    agentRunResults: agentRunResults as RunSnapshot["agentRunResults"],
    traceEvents: [...base.traceEvents, ...executionTraces],
    metadata: { ...base.metadata, deterministic: false }
  } as RunSnapshot;
}

function leafToAgentRunResult(
  runId: string,
  leaf: RealLeafResult
): RunSnapshot["agentRunResults"][number] {
  return {
    taskId: leaf.taskId,
    worktree: `.manyhands/worktrees/${runId}/${leaf.taskId}`,
    branch: `mh/${runId}/${leaf.taskId}`,
    success: leaf.status === "success",
    diff: leaf.diff,
    changedFiles: [...leaf.changedFiles],
    validation: { checks: [], passed: leaf.validationResult?.passed ?? leaf.status === "success" },
    scopeViolations: [...leaf.scopeCheck.violations],
    stdout: leaf.stdoutTail ?? "",
    stderr: leaf.stderrTail ?? "",
    reportedSymbols: [],
    metrics: {
      durationMs: leaf.executorDurationMs,
      costUsd: leaf.costUsd ?? 0,
      tokensIn: leaf.tokensIn ?? 0,
      tokensOut: leaf.tokensOut ?? 0
    },
    metadata: {
      status: leaf.status,
      executorExitCode: leaf.executorExitCode,
      executorTimedOut: leaf.executorTimedOut
    },
    ...(leaf.commitSha !== undefined ? { commitHash: leaf.commitSha } : {})
  } as RunSnapshot["agentRunResults"][number];
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
      // Only lab/scenario runs and the deterministic fallback are "mock". Real
      // prompt runs (Gemini/Anthropic planning) are not — so the toolbar badge
      // doesn't tag a real run with "/ mock".
      deterministic: run.scenarioId !== undefined || run.decomposition?.provider === "deterministic"
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
