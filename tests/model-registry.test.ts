import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  EXECUTOR_OPTIONS,
  CLAUDE_CODE_EXECUTOR_ID,
  MODEL_OPTIONS,
  findModel,
  findModelForSelection,
  normalizeExecutorOverride
} from "@/lib/models";

describe("model registry", () => {
  it("keeps Claude Code as the default while exposing the multi-executor registry", () => {
    const defaultModel = findModel(DEFAULT_MODEL_ID);

    expect(defaultModel?.executorId).toBe(CLAUDE_CODE_EXECUTOR_ID);
    expect(defaultModel?.capabilities).toEqual(["planning", "execution", "repair"]);
    expect(defaultModel?.usage).toBe("unavailable");
    expect(EXECUTOR_OPTIONS.map((executor) => executor.id)).toEqual([
      "claude-code-cli",
      "codex-cli",
      "opencode-cli"
    ]);
    expect(MODEL_OPTIONS.some((model) => model.executorId === "codex-cli")).toBe(true);
    expect(EXECUTOR_OPTIONS.find((executor) => executor.id === "codex-cli")?.enabled).toBe(true);
  });

  it("normalizes valid executor selections and keeps model lookup executor-scoped", () => {
    expect(normalizeExecutorOverride({ executorId: "claude-code-cli", model: "haiku" })).toEqual({
      executorId: "claude-code-cli",
      model: "haiku"
    });
    expect(normalizeExecutorOverride({ executorId: "codex-cli", model: "gpt-5-codex" })).toEqual({
      executorId: "codex-cli",
      model: "gpt-5-codex"
    });
    expect(findModelForSelection({ executorId: "claude-code-cli", model: "sonnet" })?.enabled).toBe(true);
    expect(normalizeExecutorOverride({ executorId: "claude-code-cli", model: "" })).toBeUndefined();
  });
});
