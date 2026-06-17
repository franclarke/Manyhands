import {
  CLAUDE_CODE_EXECUTOR_ID,
  DEFAULT_EXECUTOR_SELECTION,
  EXECUTOR_IDS,
  resolveLegacyModelSelection,
  type ExecutorId,
  type ExecutorSelection
} from "@manyhands/execution-core";
import type { RunRecord } from "./schema";

const EXECUTOR_ID_SET = new Set<string>(EXECUTOR_IDS);

function isExecutorId(value: string | undefined): value is ExecutorId {
  return value !== undefined && EXECUTOR_ID_SET.has(value);
}

export function planningSelection(run: Pick<RunRecord, "model" | "planningModel" | "planningExecutorId">): ExecutorSelection {
  if (isExecutorId(run.planningExecutorId)) {
    return {
      executorId: run.planningExecutorId,
      model: run.planningModel ?? run.model
    };
  }
  return DEFAULT_EXECUTOR_SELECTION;
}

export function executionSelection(run: Pick<RunRecord, "model" | "defaultExecutionSelection">): ExecutorSelection {
  return run.defaultExecutionSelection ?? resolveLegacyModelSelection(run.model);
}

export function repairSelection(
  run: Pick<RunRecord, "model" | "defaultExecutionSelection" | "defaultRepairSelection">
): ExecutorSelection {
  return run.defaultRepairSelection ?? executionSelection(run);
}

export function groundingSelection(run: Pick<RunRecord, "model" | "defaultExecutionSelection">): ExecutorSelection {
  return executionSelection(run);
}

export function titlerSelection(run: Pick<RunRecord, "model" | "planningModel" | "planningExecutorId">): ExecutorSelection {
  const planning = planningSelection(run);
  return planning.executorId === CLAUDE_CODE_EXECUTOR_ID ? planning : DEFAULT_EXECUTOR_SELECTION;
}
