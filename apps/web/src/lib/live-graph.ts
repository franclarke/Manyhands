import type { PlanningFlowResult } from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import type {
  LegacyExecutionProjection,
  LegacyRunSnapshot
} from "@/lib/server/runs/legacy-projection-types";
import { applyPatches } from "@/lib/server/runs/patches";
import { compatibleGraphPatches } from "@/lib/server/runs/plan-graph-storage";
import type { RunRecord, RunStatus } from "@/lib/server/runs/schema";

/** Minimal shape of a real execution-core RunExecutionResult (opaque in the record). */
interface RealExecutionResult {
  leafResults?: ReadonlyArray<RealLeafResult>;
  integrationResults?: ReadonlyArray<RealIntegrationResult>;
}

interface RealLeafResult {
  taskId: string;
  status: string;
  diff: string;
  changedFiles: string[];
  commitSha?: string;
  scopeCheck: { passed: boolean; violations: string[]; outOfScope?: string[] };
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

interface RealIntegrationResult {
  compositeTaskId: string;
  status: string;
  childResults: RealLeafResult[];
  integrationCommitSha?: string;
  repairAttempted: boolean;
}

/**
 * Project a Fase B RunRecord into a RunSnapshot-shaped object that toRunGraphViewModel
 * can consume. We never re-validate the result through the core Zod schema because the
 * intermediate planning snapshot is intentionally partial (no agent results yet).
 */
export function projectRunRecordToSnapshot(
  run: RunRecord,
  options: { applyPatches?: boolean } = {}
): LegacyRunSnapshot | null {
  const shouldApplyPatches = options.applyPatches ?? true;
  // A persisted run can carry only a partial planning snapshot (e.g. a failed
  // run with `{ decomposition: { graph } }` and no feature/summary/schedule).
  // `buildPlanningSnapshot` assumes the full shape, so gate on it here and let
  // the projection degrade to `null` (its declared contract) instead of throwing
  // on `planning.decomposition.feature.id`.
  const planning = isProjectablePlanning(run.planning) ? run.planning : null;
  let snapshot: LegacyRunSnapshot | null = null;
  if (run.execution !== undefined) {
    const execution = run.execution as LegacyExecutionProjection & RealExecutionResult;
    if (isProjectableSnapshot(execution.snapshot)) {
      // Legacy mock execution flow carries its own pre-built snapshot.
      snapshot = execution.snapshot;
    } else if (Array.isArray(execution.leafResults) && planning !== null) {
      // Real execution-core RunExecutionResult: overlay leaf results + execution
      // traces onto the planning structure so the canvas/inspector/trace tab
      // project the real (possibly failed) execution instead of "No execution yet".
      snapshot = buildExecutionSnapshot(run, planning, execution);
    }
  }
  if (snapshot === null && planning !== null) {
    snapshot = buildPlanningSnapshot(run, planning);
  }
  if (snapshot === null || !shouldApplyPatches) {
    return snapshot;
  }
  return applyPatches(
    snapshot,
    compatibleGraphPatches(run, snapshot.graphSnapshot as unknown as TaskGraph)
  );
}

/**
 * Maps a real RunExecutionResult onto the planning snapshot: each leaf result
 * becomes an agentRunResult (so statusForNode resolves done/failed instead of
 * the planned fallback), and the persisted execution traces are merged in so the
 * Trace tab shows worktree/executor/integration events per task.
 */
function buildExecutionSnapshot(
  run: RunRecord,
  planning: PlanningFlowResult,
  execution: RealExecutionResult
): LegacyRunSnapshot {
  const base = buildPlanningSnapshot(run, planning);
  const agentRunResults = (execution.leafResults ?? []).map((leaf) =>
    leafToAgentRunResult(run.runId, leaf)
  );
  const integrationRunResults = (execution.integrationResults ?? []).map((integration) =>
    integrationToAgentRunResult(run.runId, integration)
  );
  const executionTraces = (run.executionTraces ?? []) as LegacyRunSnapshot["traceEvents"];
  return {
    ...base,
    agentRunResults: [...agentRunResults, ...integrationRunResults] as LegacyRunSnapshot["agentRunResults"],
    ...(execution.integrationResults !== undefined ? { integrationResults: execution.integrationResults } : {}),
    traceEvents: [...base.traceEvents, ...executionTraces],
    metadata: { ...base.metadata, deterministic: false }
  } as LegacyRunSnapshot;
}

function leafToAgentRunResult(
  runId: string,
  leaf: RealLeafResult
): LegacyRunSnapshot["agentRunResults"][number] {
  const usageUnavailable =
    leaf.tokensIn === undefined && leaf.tokensOut === undefined && leaf.costUsd === undefined;
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
      executorTimedOut: leaf.executorTimedOut,
      usageUnavailable
    },
    ...(leaf.commitSha !== undefined ? { commitHash: leaf.commitSha } : {})
  } as LegacyRunSnapshot["agentRunResults"][number];
}

function integrationToAgentRunResult(
  runId: string,
  integration: RealIntegrationResult
): LegacyRunSnapshot["agentRunResults"][number] {
  const success = integration.status === "success" || integration.status === "executor_repair_success";
  const changedFiles = uniqueStrings(integration.childResults.flatMap((child) => child.changedFiles ?? []));
  return {
    taskId: integration.compositeTaskId,
    worktree: `.manyhands/worktrees/${runId}/${integration.compositeTaskId}`,
    branch: `mh/${runId}/${integration.compositeTaskId}`,
    success,
    diff: "",
    changedFiles,
    validation: { checks: [], passed: success },
    scopeViolations: [],
    stdout: "",
    stderr: "",
    reportedSymbols: [],
    metrics: {
      durationMs: 0,
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0
    },
    metadata: {
      status: integration.status,
      repairAttempted: integration.repairAttempted,
      usageUnavailable: true
    },
    ...(integration.integrationCommitSha !== undefined ? { commitHash: integration.integrationCommitSha } : {})
  } as LegacyRunSnapshot["agentRunResults"][number];
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function buildPlanningSnapshot(run: RunRecord, planning: PlanningFlowResult): LegacyRunSnapshot {
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
      // Only the deterministic fallback is "mock". Real prompt runs
      // (Gemini/Anthropic planning) are not — so the toolbar badge doesn't
      // tag a real run with "/ mock".
      deterministic: run.decomposition?.provider === "deterministic"
    }
  } as LegacyRunSnapshot;
}

function snapshotStatusFor(status: RunStatus): LegacyRunSnapshot["status"] {
  switch (status) {
    case "completed":
      return "executed";
    case "failed":
      return "failed";
    default:
      return "planned";
  }
}

/**
 * Structural guard over the opaque persisted `planning` payload. True only when
 * it has the full shape `buildPlanningSnapshot`/`buildExecutionSnapshot`
 * consume: `decomposition.feature.id`, `decomposition.graph` (rootId + nodes),
 * `decomposition.contracts`, `summary.mode`, and `schedule.batches`. Failed or
 * in-flight runs can persist only a partial snapshot, so any caller that wants
 * a projected `RunSnapshot` must gate on this. Single source of truth shared
 * with run-model projection.
 */
export function isProjectablePlanning(value: unknown): value is PlanningFlowResult {
  if (!isRecord(value)) return false;
  const decomposition = asRecord(value.decomposition);
  if (decomposition === undefined) return false;
  const feature = asRecord(decomposition.feature);
  const graph = asRecord(decomposition.graph);
  const summary = asRecord(value.summary);
  const schedule = asRecord(value.schedule);
  return (
    typeof feature?.id === "string" &&
    typeof graph?.rootId === "string" &&
    isRecord(graph.nodes) &&
    Array.isArray(decomposition.contracts) &&
    typeof summary?.mode === "string" &&
    Array.isArray(schedule?.batches)
  );
}

/**
 * Structural guard over the opaque persisted `execution.snapshot` payload. True
 * only when it carries the fields the projection dereferences: a `graphSnapshot`
 * with a `nodes` record and a `contracts` array. A legacy/corrupt record can
 * persist `{ snapshot: {} }`; returning that would violate the `RunSnapshot |
 * null` contract and crash consumers on `snapshot.graphSnapshot.nodes`. Single
 * source of truth shared with run-model projection.
 */
export function isProjectableSnapshot(value: unknown): value is LegacyRunSnapshot {
  if (!isRecord(value)) return false;
  const graphSnapshot = asRecord(value.graphSnapshot);
  if (graphSnapshot === undefined) return false;
  return isRecord(graphSnapshot.nodes) && Array.isArray(value.contracts);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
