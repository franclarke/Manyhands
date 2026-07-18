import { DEFAULT_EXECUTOR_SELECTION, type StageSelection } from "@manyhands/execution-core";
import type { RunRecord, StageSelectionInput } from "./schema";

type SelectionSource = Pick<RunRecord, "planningSelection" | "executionSelection" | "repairSelection">;

export function defaultStageSelection(): StageSelectionInput {
  return { ...DEFAULT_EXECUTOR_SELECTION };
}

export function planningSelection(run: SelectionSource): StageSelection {
  return selection(run.planningSelection);
}

export function executionSelection(run: SelectionSource): StageSelection {
  return selection(run.executionSelection);
}

export function repairSelection(run: SelectionSource): StageSelection {
  return selection(run.repairSelection);
}

function selection(value: StageSelectionInput): StageSelection {
  return {
    executorId: value.executorId,
    model: value.model,
    ...(value.effort !== undefined ? { effort: value.effort } : {})
  };
}
