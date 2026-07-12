import { describe, expect, it } from "vitest";
import {
  executionSelection,
  groundingSelection,
  planningSelection,
  repairSelection,
  titlerSelection
} from "@/lib/server/runs/executor-selection";

describe("run executor selection resolver", () => {
  it("keeps Claude selected consistently when Claude is configured", () => {
    const run = {
      model: "sonnet",
      planningModel: "sonnet",
      planningExecutorId: "claude-code-cli",
      defaultExecutionSelection: { executorId: "claude-code-cli", model: "sonnet" },
      defaultRepairSelection: { executorId: "claude-code-cli", model: "sonnet" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(titlerSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(executionSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(repairSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(groundingSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
  });

  it("uses Codex for planning/titler/execution/repair/grounding when Codex is selected", () => {
    const run = {
      model: "gpt-5.5",
      planningModel: "gpt-5.5",
      planningExecutorId: "codex-cli",
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.5" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(titlerSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(executionSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(groundingSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
  });

  it("keeps legacy Claude-only runs on Claude", () => {
    const run = { model: "sonnet" } as const;

    expect(planningSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(titlerSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(executionSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(groundingSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
  });

  it("does not map legacy OpenAI model strings onto Claude for execution or grounding", () => {
    const run = { model: "gpt-5.5" } as const;

    expect(planningSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(titlerSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(executionSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(groundingSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
  });

  it("uses the initial planning selection as the default for every phase when execution defaults are absent", () => {
    const run = {
      model: "gpt-5.5",
      planningModel: "gpt-5.5",
      planningExecutorId: "codex-cli"
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(titlerSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(executionSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(groundingSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
  });

  it("allows planning and execution to use different selections", () => {
    const run = {
      model: "gpt-5.5",
      planningModel: "sonnet",
      planningExecutorId: "claude-code-cli",
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.5" }
    } as const;

    expect(planningSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(titlerSelection(run)).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(executionSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
    expect(groundingSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
  });

  it("uses the execution selection for repair when repair defaults are absent", () => {
    const run = {
      model: "gpt-5.5",
      planningModel: "sonnet",
      planningExecutorId: "claude-code-cli",
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" }
    } as const;

    expect(repairSelection(run)).toEqual({ executorId: "codex-cli", model: "gpt-5.5" });
  });
});
