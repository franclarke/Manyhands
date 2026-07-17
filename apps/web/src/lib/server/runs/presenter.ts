import type { RunPreview, RunResponse, StageSelection } from "@/lib/api-types";
import type { Workspace } from "@/lib/api-types";
import { isExecutionResult, toExecutionSummary } from "@/lib/execution-summary";
import { getWorkspaceRepository, WorkspaceNotFoundError } from "@/lib/server/workspaces";
import type { LegacyExecutionProjection } from "./legacy-projection-types";
import type { RunRecord } from "./schema";

/** Normalize a persisted per-stage selection into the API shape (drops `effort: undefined`). */
function toStagePayload(selection: NonNullable<RunRecord["executionSelection"]>): StageSelection {
  return {
    executorId: selection.executorId,
    model: selection.model,
    ...(selection.effort !== undefined ? { effort: selection.effort } : {})
  };
}

/**
 * Defensive view over the opaque persisted `planning` payload. The store types
 * `planning` as `z.unknown()`, so a record may carry only a partial snapshot;
 * every field here is optional on purpose.
 */
type PlanningPreviewShape = {
  summary?: { taskCount?: number };
  riskMatrix?: ReadonlyArray<{ level?: string }>;
};

/**
 * Count risks flagged `blocking`/`high`, or `undefined` when the record has no
 * usable risk matrix (so the caller can leave `coordinationRiskCount` unset).
 */
function countBlockingRisks(riskMatrix: PlanningPreviewShape["riskMatrix"]): number | undefined {
  if (!Array.isArray(riskMatrix)) return undefined;
  return riskMatrix.filter(
    (entry) => entry?.level === "blocking" || entry?.level === "high"
  ).length;
}

export function toRunResponse(run: RunRecord, canonicalWorkspaceId: string = run.workspaceId): RunResponse {
  const payload: RunResponse["run"] = {
    runId: run.runId,
    workspaceId: canonicalWorkspaceId,
    granularity: run.granularity,
    model: run.model,
    userPrompt: run.userPrompt,
    title: run.title,
    status: run.status,
    version: run.version,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
  if (run.validation !== undefined) payload.validation = run.validation;
  if (run.pendingDecision !== undefined) payload.pendingDecision = run.pendingDecision;
  if (run.planningExecutorId !== undefined) payload.planningExecutorId = run.planningExecutorId;
  if (run.planningModel !== undefined) payload.planningModel = run.planningModel;
  if (run.defaultExecutionSelection !== undefined) payload.defaultExecutionSelection = run.defaultExecutionSelection;
  if (run.defaultRepairSelection !== undefined) payload.defaultRepairSelection = run.defaultRepairSelection;
  if (run.planningSelection !== undefined) payload.planningSelection = toStagePayload(run.planningSelection);
  if (run.executionSelection !== undefined) payload.executionSelection = toStagePayload(run.executionSelection);
  if (run.repairSelection !== undefined) payload.repairSelection = toStagePayload(run.repairSelection);
  if (run.summary !== undefined) payload.summary = run.summary;
  if (run.pausedDuring !== undefined) payload.pausedDuring = run.pausedDuring;
  if (run.interruptedDuring !== undefined) payload.interruptedDuring = run.interruptedDuring;
  if (run.errorMessage !== undefined) payload.errorMessage = run.errorMessage;
  if (run.approvedAt !== undefined) payload.approvedAt = run.approvedAt;
  if (run.startedAt !== undefined) payload.startedAt = run.startedAt;
  if (run.completedAt !== undefined) payload.completedAt = run.completedAt;
  if (run.heartbeatAt !== undefined) payload.heartbeatAt = run.heartbeatAt;
  if (run.finalApplicationStatus !== undefined) payload.finalApplicationStatus = run.finalApplicationStatus;
  if (run.finalBranchName !== undefined) payload.finalBranchName = run.finalBranchName;
  if (run.finalCommitSha !== undefined) payload.finalCommitSha = run.finalCommitSha;
  if (run.appliedToRepoPath !== undefined) payload.appliedToRepoPath = run.appliedToRepoPath;
  if (run.appliedAt !== undefined) payload.appliedAt = run.appliedAt;
  if (run.exportedPatchPath !== undefined) payload.exportedPatchPath = run.exportedPatchPath;
  if (run.finalApplicationMessage !== undefined) payload.finalApplicationMessage = run.finalApplicationMessage;
  if (run.baseCommit !== undefined) payload.baseCommit = run.baseCommit;
  if (run.integrationCommitSha !== undefined) payload.integrationCommitSha = run.integrationCommitSha;
  if (run.nodeReviews !== undefined) payload.nodeReviews = run.nodeReviews;
  if (run.planningCritic !== undefined) payload.planningCritic = run.planningCritic;
  if (run.seamCritic !== undefined) payload.seamCritic = run.seamCritic;
  if (run.repositoryGrounding !== undefined) payload.repositoryGrounding = run.repositoryGrounding;
  if (run.decomposition !== undefined) {
    const decompositionPayload: NonNullable<RunResponse["run"]["decomposition"]> = {
      provider: run.decomposition.provider,
      model: run.decomposition.model,
      fallbackUsed: run.decomposition.fallbackUsed,
      validationErrors: run.decomposition.validationErrors,
      generatedAt: run.decomposition.generatedAt
    };
    if (run.decomposition.promptTemplateVersion !== undefined) decompositionPayload.promptTemplateVersion = run.decomposition.promptTemplateVersion;
    if (run.decomposition.fallbackReason !== undefined) decompositionPayload.fallbackReason = run.decomposition.fallbackReason;
    if (run.decomposition.usage !== undefined) {
      const usagePayload: { inputTokens: number; outputTokens: number; costUsd?: number } = {
        inputTokens: run.decomposition.usage.inputTokens,
        outputTokens: run.decomposition.usage.outputTokens
      };
      if (run.decomposition.usage.costUsd !== undefined) usagePayload.costUsd = run.decomposition.usage.costUsd;
      decompositionPayload.usage = usagePayload;
    }
    payload.decomposition = decompositionPayload;
  }
  if (isExecutionResult(run.execution)) {
    payload.execution = toExecutionSummary(run.execution);
  }
  return { run: payload };
}

/** Public API projection: legacy workspace aliases never escape as dangling ids. */
export async function toCanonicalRunResponse(run: RunRecord): Promise<RunResponse> {
  try {
    const workspace = await getWorkspaceRepository().get(run.workspaceId);
    return toRunResponse(run, workspace.id);
  } catch (error) {
    // Pre-workspace fixtures and records whose workspace was deliberately
    // deleted have no canonical target. Preserve their recorded id, but never
    // hide lock, corruption or migration failures behind that compatibility.
    if (error instanceof WorkspaceNotFoundError) return toRunResponse(run);
    throw error;
  }
}

export function toRunPreview(run: RunRecord, workspaces: ReadonlyMap<string, Workspace>): RunPreview {
  const workspace = workspaces.get(run.workspaceId);
  const preview: RunPreview = {
    id: run.runId,
    workspaceId: workspace?.id ?? run.workspaceId,
    title: run.title,
    userPrompt: run.userPrompt,
    summary: run.summary,
    status: run.status,
    granularity: run.granularity,
    model: run.model,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    href: `/runs/${run.runId}`
  };

  if (workspace !== undefined) {
    preview.workspaceName = workspace.name;
  }

  // `run.planning`/`run.execution` are persisted opaque payloads (schema:
  // `z.unknown()`). A run can carry a partial snapshot — e.g. a failed run with
  // `{ decomposition: { graph } }` and no `summary`/`riskMatrix` — so every
  // field access here must tolerate absence; otherwise one bad record 500s the
  // whole `/api/runs` list.
  const planning = run.planning as PlanningPreviewShape | undefined;
  if (planning?.summary?.taskCount !== undefined) {
    preview.nodeCount = planning.summary.taskCount;
  }

  if (isExecutionResult(run.execution)) {
    // Real execution engine (RunExecutionResult).
    preview.agentCount = run.execution.leafResults.length;
    const risks = countBlockingRisks(planning?.riskMatrix);
    if (risks !== undefined) preview.coordinationRiskCount = risks;
  } else if ((run.execution as LegacyExecutionProjection | undefined) !== undefined) {
    // Legacy Lab-mode execution snapshot.
    const execution = run.execution as LegacyExecutionProjection & {
      planning?: PlanningPreviewShape;
    };
    preview.agentCount = execution.results.length;
    const risks = countBlockingRisks(execution.planning?.riskMatrix);
    if (risks !== undefined) preview.coordinationRiskCount = risks;
  } else {
    const risks = countBlockingRisks(planning?.riskMatrix);
    if (risks !== undefined) preview.coordinationRiskCount = risks;
  }

  if (run.completedAt !== undefined && run.startedAt !== undefined) {
    const ms = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    if (!Number.isNaN(ms) && ms >= 0) {
      preview.durationLabel = formatDuration(ms);
    }
  }
  return preview;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${String(remaining).padStart(2, "0")}s`;
}
