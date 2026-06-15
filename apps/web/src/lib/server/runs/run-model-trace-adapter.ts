import type { TraceEvent } from "@manyhands/trace-store";
import type { RunModelEventInput } from "./run-model-event-log";

export interface TraceAdapterContext {
  runId: string;
  defaultModel: string;
}

export function runModelEventsFromTrace(
  event: TraceEvent,
  context: TraceAdapterContext
): RunModelEventInput[] {
  const taskId = event.taskId;
  const at = event.timestamp;
  const payload = event.payload;

  switch (event.type) {
    case "batch_started": {
      const batchId = stringValue(payload.batchId) ?? "wave-unknown";
      const taskIds = stringArray(payload.taskIds);
      const index = indexFromBatchId(batchId);
      return [
        {
          actor: "system",
          at,
          type: "wave.planned",
          payload: { waves: [{ waveId: batchId, index, nodeIds: taskIds, unlockedBySeams: [] }] }
        },
        {
          actor: "system",
          at,
          type: "wave.opened",
          payload: { waveId: batchId, nodeIds: taskIds }
        }
      ];
    }
    case "batch_completed": {
      const batchId = stringValue(payload.batchId);
      return batchId !== undefined
        ? [{ actor: "system", at, type: "wave.closed", payload: { waveId: batchId } }]
        : [];
    }
    case "agent_started": {
      if (taskId === undefined) return [];
      return [
        {
          actor: "agent",
          at,
          type: "node.execution.started",
          payload: { nodeId: taskId, agent: "gemini-cli", model: context.defaultModel }
        }
      ];
    }
    case "executor_started": {
      if (taskId === undefined) return [];
      return [
        {
          actor: "agent",
          at,
          type: "node.execution.started",
          payload: {
            nodeId: taskId,
            agent: stringValue(payload.executorId) ?? "gemini-cli",
            model: stringValue(payload.model) ?? context.defaultModel
          }
        }
      ];
    }
    case "executor_output": {
      if (taskId === undefined) return [];
      const chunk = stringValue(payload.chunk);
      if (chunk === undefined) return [];
      const stream = stringValue(payload.stream) === "stderr" ? "stderr" : "stdout";
      return [
        {
          actor: "agent",
          at,
          type: "node.cli.output",
          payload: { nodeId: taskId, stream, chunk }
        }
      ];
    }
    case "executor_completed": {
      if (taskId === undefined) return [];
      const timedOut = payload.timedOut === true;
      const exitCode = numberValue(payload.exitCode) ?? 0;
      const passed = !timedOut && exitCode === 0;
      return [
        {
          actor: "agent",
          at,
          type: "node.verify.iteration",
          payload: {
            nodeId: taskId,
            iteration: 1,
            maxIterations: 1,
            build: passed ? "pass" : "fail",
            testsPass: passed ? 1 : 0,
            testsTotal: 1
          }
        }
      ];
    }
    case "validation_started": {
      if (taskId === undefined) return [];
      return [
        {
          actor: "system",
          at,
          type: "node.verify.iteration",
          payload: {
            nodeId: taskId,
            iteration: 1,
            maxIterations: 1,
            build: "pass",
            testsPass: 0,
            testsTotal: Math.max(1, numberValue(payload.commandCount) ?? 1)
          }
        }
      ];
    }
    case "cherry_pick_conflict": {
      if (taskId === undefined) return [];
      return [
        {
          actor: "system",
          at,
          type: "conflict.detected",
          payload: {
            conflictId: `integration:${taskId}:conflict`,
            dimension: "textual",
            status: "detected",
            nodeIds: [taskId, ...(stringValue(payload.childTaskId) !== undefined ? [stringValue(payload.childTaskId)!] : [])],
            files: stringArray(payload.files),
            autoResolvable: true,
            diagnosisRef: `diagnosis://runs/${context.runId}/integration/${taskId}`
          }
        }
      ];
    }
    default:
      return [];
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function indexFromBatchId(batchId: string): number {
  const match = /(\d+)$/.exec(batchId);
  return match?.[1] !== undefined ? Math.max(0, Number(match[1]) - 1) : 0;
}
