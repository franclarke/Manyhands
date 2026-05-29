import type { RunPreview, RunResponse } from "@/lib/api-types";
import type { Workspace } from "@/lib/api-types";
import type { MockExecutionFlowResult, MockPlanningFlowResult } from "@manyhands/core";
import type { RunRecord } from "./schema";

export function toRunResponse(run: RunRecord): RunResponse {
  const payload: RunResponse["run"] = {
    runId: run.runId,
    workspaceId: run.workspaceId,
    granularity: run.granularity,
    model: run.model,
    userPrompt: run.userPrompt,
    title: run.title,
    status: run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt
  };
  if (run.scenarioId !== undefined) payload.scenarioId = run.scenarioId;
  if (run.pausedDuring !== undefined) payload.pausedDuring = run.pausedDuring;
  if (run.interruptedDuring !== undefined) payload.interruptedDuring = run.interruptedDuring;
  if (run.errorMessage !== undefined) payload.errorMessage = run.errorMessage;
  if (run.approvedAt !== undefined) payload.approvedAt = run.approvedAt;
  if (run.startedAt !== undefined) payload.startedAt = run.startedAt;
  if (run.completedAt !== undefined) payload.completedAt = run.completedAt;
  if (run.heartbeatAt !== undefined) payload.heartbeatAt = run.heartbeatAt;
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
  return { run: payload };
}

export function toRunPreview(run: RunRecord, workspaces: ReadonlyMap<string, Workspace>): RunPreview {
  const preview: RunPreview = {
    id: run.runId,
    workspaceId: run.workspaceId,
    title: run.title,
    userPrompt: run.userPrompt,
    scenarioId: run.scenarioId,
    status: run.status,
    granularity: run.granularity,
    model: run.model,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    href: `/runs/${run.runId}`
  };

  const workspace = workspaces.get(run.workspaceId);
  if (workspace !== undefined) {
    preview.workspaceName = workspace.name;
  }

  const planning = run.planning as MockPlanningFlowResult | undefined;
  if (planning !== undefined) {
    preview.nodeCount = planning.summary.taskCount;
  }

  const execution = run.execution as MockExecutionFlowResult | undefined;
  if (execution !== undefined) {
    preview.agentCount = execution.results.length;
    preview.conflictCount = execution.planning.riskMatrix.filter(
      (entry) => entry.level === "blocking" || entry.level === "high"
    ).length;
  } else if (planning !== undefined) {
    preview.conflictCount = planning.riskMatrix.filter(
      (entry) => entry.level === "blocking" || entry.level === "high"
    ).length;
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
