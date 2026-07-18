import { describe, expect, it } from "vitest";

import {
  defaultStageSelection,
  executionSelection,
  planningSelection,
  repairSelection
} from "@/lib/server/runs/executor-selection";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

describe("canonical StageSelection resolver", () => {
  it("returns each immutable persisted stage selection verbatim", () => {
    const run = makeRunRecordV2({
      planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "xhigh" },
      executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
      repairSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" }
    });

    expect(planningSelection(run)).toEqual(run.planningSelection);
    expect(executionSelection(run)).toEqual(run.executionSelection);
    expect(repairSelection(run)).toEqual(run.repairSelection);
  });

  it("returns a fresh canonical default", () => {
    const first = defaultStageSelection();
    const second = defaultStageSelection();
    expect(first).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(first).not.toBe(second);
  });
});
