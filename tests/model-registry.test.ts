import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  GEMINI_EXECUTOR_ID,
  MODEL_OPTIONS,
  findModel,
  normalizeExecutorOverride
} from "@/lib/models";

describe("model registry", () => {
  it("keeps Gemini CLI as the default executor-backed model registry", () => {
    const defaultModel = findModel(DEFAULT_MODEL_ID);

    expect(defaultModel?.executorId).toBe(GEMINI_EXECUTOR_ID);
    expect(defaultModel?.capabilities).toEqual(["planning", "execution", "repair"]);
    expect(defaultModel?.usage).toBe("unavailable");
    expect(MODEL_OPTIONS.every((model) => model.executorId === GEMINI_EXECUTOR_ID)).toBe(true);
  });

  it("normalizes only valid Gemini executor overrides", () => {
    expect(normalizeExecutorOverride({ executorId: "gemini-cli", model: "gemini-2.5-flash" })).toEqual({
      executorId: "gemini-cli",
      model: "gemini-2.5-flash"
    });
    expect(normalizeExecutorOverride({ executorId: "codex-cli", model: "gpt-5-codex" })).toBeUndefined();
    expect(normalizeExecutorOverride({ executorId: "gemini-cli", model: "" })).toBeUndefined();
  });
});
