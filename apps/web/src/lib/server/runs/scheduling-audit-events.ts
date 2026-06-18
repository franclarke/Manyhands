import { findRiskPrediction, type TaskPairRiskMatrix } from "@manyhands/conflict-risk";
import {
  buildSchedulingSafetyContext,
  selectScopeAwareWave,
  summarizeRiskMatrix,
  type SchedulingPolicy,
  type SchedulingWarning
} from "@manyhands/scheduler";
import type { TaskGraph } from "@manyhands/task-graph";
import type { RunEventPayloads, SchedulingAuditFallback, SchedulingAuditReason } from "@/lib/run-model/types";
import { appendRunEventRequired } from "./run-model-event-log";

type SchedulingWaveSelectedPayload = RunEventPayloads["run.scheduling.wave_selected"];

export interface SelectAndPersistSchedulingWaveInput {
  runId: string;
  graph: TaskGraph;
  candidates: readonly string[];
  waveIndex: number;
  source: SchedulingWaveSelectedPayload["source"];
  riskMatrix?: TaskPairRiskMatrix;
  maxParallel?: number;
}

export interface SelectAndPersistSchedulingWaveResult {
  selectedTaskIds: string[];
  payload: SchedulingWaveSelectedPayload;
}

export async function selectAndPersistSchedulingWave(
  input: SelectAndPersistSchedulingWaveInput
): Promise<SelectAndPersistSchedulingWaveResult> {
  const policy: SchedulingPolicy = "risk_aware";
  const safety = buildSchedulingSafetyContext({
    graph: input.graph,
    taskIds: input.candidates,
    policy,
    ...(input.riskMatrix !== undefined ? { riskMatrix: input.riskMatrix } : {})
  });
  const selectedTaskIds = selectScopeAwareWave({
    graph: input.graph,
    candidates: input.candidates,
    riskMatrix: safety.riskMatrix,
    ...(input.maxParallel !== undefined ? { maxParallel: input.maxParallel } : {})
  });
  const payload = schedulingWaveSelectedPayload({
    source: input.source,
    waveIndex: input.waveIndex,
    policy,
    readyTaskIds: input.candidates,
    selectedTaskIds,
    riskMatrix: safety.riskMatrix,
    warnings: safety.warnings
  });

  await appendRunEventRequired(input.runId, {
    actor: "system",
    type: "run.scheduling.wave_selected",
    payload
  });

  return { selectedTaskIds, payload };
}

function schedulingWaveSelectedPayload(input: {
  source: SchedulingWaveSelectedPayload["source"];
  waveIndex: number;
  policy: SchedulingPolicy;
  readyTaskIds: readonly string[];
  selectedTaskIds: readonly string[];
  riskMatrix: TaskPairRiskMatrix;
  warnings: readonly SchedulingWarning[];
}): SchedulingWaveSelectedPayload {
  const selectedSet = new Set(input.selectedTaskIds);
  const blockedTaskIds = input.readyTaskIds.filter((taskId) => !selectedSet.has(taskId));
  return {
    version: 1,
    source: input.source,
    waveIndex: input.waveIndex,
    policy: input.policy,
    readyTaskIds: [...input.readyTaskIds],
    selectedTaskIds: [...input.selectedTaskIds],
    blockedTaskIds,
    blockedReasons: blockedTaskIds.map((taskId) =>
      blockedReason(taskId, input.selectedTaskIds, input.riskMatrix)
    ),
    riskSummary: summarizeRiskMatrix(input.riskMatrix),
    fallbacks: fallbackWarnings(input.warnings),
    warnings: input.warnings.map(warningPayload)
  };
}

function blockedReason(
  taskId: string,
  selectedTaskIds: readonly string[],
  riskMatrix: TaskPairRiskMatrix
): SchedulingAuditReason {
  const related = selectedTaskIds
    .map((selectedTaskId) => ({
      taskId: selectedTaskId,
      prediction: findRiskPrediction(riskMatrix, taskId, selectedTaskId)
    }))
    .filter(({ prediction }) => prediction?.level === "high" || prediction?.level === "blocking");
  const first = related[0];
  if (first?.prediction !== undefined) {
    return {
      taskId,
      reason: first.prediction.explanation,
      relatedTaskIds: related.map((item) => item.taskId),
      riskLevel: first.prediction.level
    };
  }

  return {
    taskId,
    reason: "not selected in this wave because maxParallel or stable wave ordering selected another ready task first",
    relatedTaskIds: [...selectedTaskIds]
  };
}

function fallbackWarnings(warnings: readonly SchedulingWarning[]): SchedulingAuditFallback[] {
  return warnings
    .filter((warning) =>
      warning.code === "missing_contract" ||
      warning.code === "empty_scope" ||
      warning.code === "risk_matrix_missing" ||
      warning.code === "risk_matrix_incomplete"
    )
    .map(warningPayload);
}

function warningPayload(warning: SchedulingWarning): SchedulingAuditFallback {
  return {
    code: warning.code,
    taskIds: [...warning.taskIds],
    message: warning.message
  };
}
