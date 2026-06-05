import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  EXECUTOR_OPTIONS,
  GEMINI_EXECUTOR_ID,
  MODEL_OPTIONS,
  findModel,
  findModelForSelection,
  normalizeExecutorOverride
} from "@/lib/models";

describe("model registry", () => {
  it("keeps Gemini CLI as the default while exposing the multi-executor registry", () => {
    const defaultModel = findModel(DEFAULT_MODEL_ID);

    expect(defaultModel?.executorId).toBe(GEMINI_EXECUTOR_ID);
    expect(defaultModel?.capabilities).toEqual(["planning", "execution", "repair"]);
    expect(defaultModel?.usage).toBe("unavailable");
    expect(EXECUTOR_OPTIONS.map((executor) => executor.id)).toEqual([
      "gemini-cli",
      "claude-code-cli",
      "codex-cli",
      "opencode-cli"
    ]);
    expect(MODEL_OPTIONS.some((model) => model.executorId === "claude-code-cli")).toBe(true);
    expect(EXECUTOR_OPTIONS.find((executor) => executor.id === "codex-cli")?.enabled).toBe(false);
  });

  it("normalizes valid executor selections and keeps model lookup executor-scoped", () => {
    expect(normalizeExecutorOverride({ executorId: "gemini-cli", model: "gemini-2.5-flash" })).toEqual({
      executorId: "gemini-cli",
      model: "gemini-2.5-flash"
    });
    expect(normalizeExecutorOverride({ executorId: "claude-code-cli", model: "sonnet" })).toEqual({
      executorId: "claude-code-cli",
      model: "sonnet"
    });
    expect(findModelForSelection({ executorId: "claude-code-cli", model: "sonnet" })?.enabled).toBe(true);
    expect(normalizeExecutorOverride({ executorId: "gemini-cli", model: "" })).toBeUndefined();
  });
});
