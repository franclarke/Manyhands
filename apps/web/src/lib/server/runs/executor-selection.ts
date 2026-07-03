import {
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
  return resolveLegacyModelSelection(run.planningModel ?? run.model) ?? DEFAULT_EXECUTOR_SELECTION;
}

export function executionSelection(
  run: Pick<RunRecord, "model" | "planningModel" | "planningExecutorId" | "defaultExecutionSelection">
): ExecutorSelection {
  const planning = planningSelection(run);
  if (run.defaultExecutionSelection !== undefined) {
    assertSameSelection("defaultExecutionSelection", planning, run.defaultExecutionSelection);
    return run.defaultExecutionSelection;
  }
  return planning;
}

export function repairSelection(
  run: Pick<RunRecord, "model" | "planningModel" | "planningExecutorId" | "defaultExecutionSelection" | "defaultRepairSelection">
): ExecutorSelection {
  const execution = executionSelection(run);
  if (run.defaultRepairSelection !== undefined) {
    assertSameSelection("defaultRepairSelection", execution, run.defaultRepairSelection);
    return run.defaultRepairSelection;
  }
  return execution;
}

export function groundingSelection(
  run: Pick<RunRecord, "model" | "planningModel" | "planningExecutorId" | "defaultExecutionSelection">
): ExecutorSelection {
  return executionSelection(run);
}

export function titlerSelection(run: Pick<RunRecord, "model" | "planningModel" | "planningExecutorId">): ExecutorSelection {
  return planningSelection(run);
}

function assertSameSelection(label: string, expected: ExecutorSelection, actual: ExecutorSelection): void {
  if (actual.executorId === expected.executorId && actual.model === expected.model) {
    return;
  }
  throw new Error(
    `${label} must match the initial run selection "${expected.executorId}/${expected.model}", got "${actual.executorId}/${actual.model}".`
  );
}
