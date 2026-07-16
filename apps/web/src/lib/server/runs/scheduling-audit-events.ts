import { randomUUID } from "node:crypto";
import type { ExecutionConfig } from "@manyhands/execution-core";
import {
  findRiskPrediction,
  type BuildStaticConflictSignalsInput,
  type StaticConflictSignal,
  type TaskPairRiskMatrix
} from "@manyhands/conflict-risk";
import {
  buildSchedulingSafetyContext,
  selectScopeAwareWave,
  summarizeRiskMatrix,
  type SchedulingPolicy,
  type SchedulingWarning
} from "@manyhands/scheduler";
import type { TaskGraph } from "@manyhands/task-graph";
import type { RunEventPayloads, SchedulingAuditFallback, SchedulingAuditReason } from "@/lib/run-model/types";
import { appendRunEventRequiredWithSeq } from "./run-model-event-log";
import { effectiveExecutionConfig } from "./effective-execution-config";

type SchedulingWaveSelectedPayload = RunEventPayloads["run.scheduling.wave_selected"];

export interface SelectAndPersistSchedulingWaveInput {
  runId: string;
  graph: TaskGraph;
  candidates: readonly string[];
  /** @deprecated Ignored. Wave position is derived from durable facts under the event-log lock. */
  waveIndex?: number;
  source: SchedulingWaveSelectedPayload["source"];
  riskMatrix?: TaskPairRiskMatrix;
  repositoryIndex?: BuildStaticConflictSignalsInput["repositoryIndex"];
  staticSignals?: readonly StaticConflictSignal[];
  effectiveConfig?: ExecutionConfig;
}

export interface SelectAndPersistSchedulingWaveResult {
  selectedTaskIds: string[];
  payload: SchedulingWaveSelectedPayload;
}

export async function selectAndPersistSchedulingWave(
  input: SelectAndPersistSchedulingWaveInput
): Promise<SelectAndPersistSchedulingWaveResult> {
  const effectiveConfig = input.effectiveConfig ?? effectiveExecutionConfig(undefined);
  const policy: SchedulingPolicy = "risk_aware";
  const safety = buildSchedulingSafetyContext({
    graph: input.graph,
    taskIds: input.candidates,
    policy,
    ...(input.riskMatrix !== undefined ? { riskMatrix: input.riskMatrix } : {}),
    ...(input.repositoryIndex !== undefined ? { repositoryIndex: input.repositoryIndex } : {}),
    ...(input.staticSignals !== undefined ? { staticSignals: input.staticSignals } : {})
  });
  const selectedTaskIds = selectScopeAwareWave({
    graph: input.graph,
    candidates: input.candidates,
    riskMatrix: safety.riskMatrix,
    ...(input.repositoryIndex !== undefined ? { repositoryIndex: input.repositoryIndex } : {}),
    ...(input.staticSignals !== undefined ? { staticSignals: input.staticSignals } : {}),
    maxParallel: effectiveConfig.maxParallel
  });
  let payload!: SchedulingWaveSelectedPayload;
  await appendRunEventRequiredWithSeq(input.runId, (_seq, existingEvents) => {
    const waveIndex = existingEvents.filter((event) => event.type === "run.scheduling.wave_selected").length;
    payload = schedulingWaveSelectedPayload({
      source: input.source,
      waveId: randomUUID(),
      waveIndex,
      waveOrdinal: waveIndex + 1,
      maxParallel: effectiveConfig.maxParallel,
      routing: effectiveConfig.routing,
      policy,
      readyTaskIds: input.candidates,
      selectedTaskIds,
      riskMatrix: safety.riskMatrix,
      warnings: safety.warnings
    });
    return { actor: "system", type: "run.scheduling.wave_selected", payload };
  });

  return { selectedTaskIds, payload };
}

/** Required audit boundary for the direct Send emitted by retry_repair. */
export async function persistRetryDispatch(input: {
  runId: string;
  taskId: string;
}): Promise<{ waveId: string }> {
  const waveId = randomUUID();
  await appendRunEventRequiredWithSeq(input.runId, () => ({
    actor: "system",
    type: "run.scheduling.retry_dispatched",
    payload: {
      version: 1,
      waveId,
      taskId: input.taskId,
      source: "human_gate",
      reason: "retry_repair"
    }
  }));
  return { waveId };
}

function schedulingWaveSelectedPayload(input: {
  source: SchedulingWaveSelectedPayload["source"];
  waveId: string;
  waveIndex: number;
  waveOrdinal: number;
  maxParallel: number;
  routing: ExecutionConfig["routing"];
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
    waveId: input.waveId,
    waveIndex: input.waveIndex,
    waveOrdinal: input.waveOrdinal,
    maxParallel: input.maxParallel,
    routing: input.routing,
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
      warning.code === "missing_repository_index" ||
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
