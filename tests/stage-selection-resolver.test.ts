import { describe, expect, it } from "vitest";
import {
  executionSelection,
  groundingSelection,
  planningSelection,
  repairSelection,
  titlerSelection
} from "@/lib/server/runs/executor-selection";
import { RunConfigurationError } from "@/lib/server/runs/errors";

describe("StageSelection resolver — canonical fields", () => {
  it("returns persisted canonical selections verbatim with per-stage effort", () => {
    const run = {
      model: "gpt-5.5",
      planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "high" },
      executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
      repairSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "xhigh" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(executionSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.4", effort: "xhigh" });
    expect(groundingSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(titlerSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
  });
});

describe("StageSelection resolver — legacy migration", () => {
  it("folds a single legacy reasoningEffort into every effort-supporting stage (Codex/Codex)", () => {
    const run = {
      model: "gpt-5.5",
      planningModel: "gpt-5.5",
      planningExecutorId: "codex-cli",
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.4" },
      executionConfig: { reasoningEffort: "high" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(executionSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.4", effort: "high" });
  });

  it("never copies legacy effort onto a Claude stage (Codex planning / Claude execution)", () => {
    const run = {
      model: "sonnet",
      planningModel: "gpt-5.5",
      planningExecutorId: "codex-cli",
      defaultExecutionSelection: { executorId: "claude-code-cli", model: "sonnet" },
      executionConfig: { reasoningEffort: "low" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "low" });
    expect(executionSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(repairSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
  });

  it("applies legacy effort to a Codex execution when planning is Claude (Claude/Codex)", () => {
    const run = {
      model: "gpt-5.5",
      planningModel: "sonnet",
      planningExecutorId: "claude-code-cli",
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      executionConfig: { reasoningEffort: "medium" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(executionSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "medium" });
  });

  it("resolves a known legacy bare model string to its registered executor", () => {
    expect(executionSelection({ model: "gpt-5.5" } as const)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(executionSelection({ model: "sonnet" } as const)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
  });

  it("preserves an explicit executor even when its model is no longer registered", () => {
    const run = {
      model: "retired-opus",
      planningExecutorId: "claude-code-cli",
      planningModel: "retired-opus",
      defaultExecutionSelection: { executorId: "claude-code-cli", model: "retired-opus" }
    } as const;
    expect(planningSelection(run)).toEqual({ executorId: "claude-code-cli", model: "retired-opus" });
    expect(executionSelection(run)).toEqual({ executorId: "claude-code-cli", model: "retired-opus" });
  });
});

describe("StageSelection resolver — legacy readability & explicit failures", () => {
  it("keeps a historical unknown bare model readable via the documented default executor (string preserved)", () => {
    // Historical runs on since-removed models must still resolve for display and
    // never mutate into a DIFFERENT model. New runs can't introduce this: the
    // create route rejects a non-registered selection up front (see run-create tests).
    expect(executionSelection({ model: "claude-opus-4.7" } as const)).toEqual({
      executorId: "claude-code-cli",
      model: "claude-opus-4.7"
    });
  });

  it("throws when a canonical selection contradicts its legacy mirror", () => {
    const run = {
      model: "gpt-5.5",
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      defaultExecutionSelection: { executorId: "claude-code-cli", model: "sonnet" }
    } as const;
    expect(() => executionSelection(run)).toThrow(RunConfigurationError);
  });
});
