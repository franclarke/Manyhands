import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODEL_ID,
  EXECUTOR_OPTIONS,
  CLAUDE_CODE_EXECUTOR_ID,
  MODEL_OPTIONS,
  findModel,
  findModelForSelection,
  normalizeExecutorOverride,
  runtimeCapabilitiesForSelection
} from "@/lib/models";

describe("model registry", () => {
  it("keeps Claude Code as the default while exposing the multi-executor registry", () => {
    const defaultModel = findModel(DEFAULT_MODEL_ID);

    expect(defaultModel?.executorId).toBe(CLAUDE_CODE_EXECUTOR_ID);
    expect(defaultModel?.capabilities).toEqual(["planning", "execution", "repair"]);
    expect(defaultModel?.usage).toBe("reported");
    expect(EXECUTOR_OPTIONS.map((executor) => executor.id)).toEqual(["claude-code-cli", "codex-cli"]);
    expect(MODEL_OPTIONS.some((model) => model.executorId === "codex-cli")).toBe(true);
    expect(EXECUTOR_OPTIONS.find((executor) => executor.id === "codex-cli")?.enabled).toBe(true);
  });

  it("exposes ChatGPT Codex models gpt-5.5/5.4/5.4-mini with effort support", () => {
    const codexModels = MODEL_OPTIONS.filter((m) => m.executorId === "codex-cli");
    const ids = codexModels.map((m) => m.id);
    expect(ids).toContain("gpt-5.5");
    expect(ids).toContain("gpt-5.4");
    expect(ids).toContain("gpt-5.4-mini");
    expect(ids).not.toContain("gpt-5-codex");
    for (const id of ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"]) {
      const model = codexModels.find((m) => m.id === id);
      expect(model?.supportsEffort, `${id} should support effort`).toBe(true);
    }
    expect(codexModels.find((m) => m.id === "gpt-5.5")?.capabilities).toContain("planning");
  });

  it("normalizes valid executor selections and keeps model lookup executor-scoped", () => {
    expect(normalizeExecutorOverride({ executorId: "claude-code-cli", model: "haiku" })).toEqual({
      executorId: "claude-code-cli",
      model: "haiku"
    });
    expect(normalizeExecutorOverride({ executorId: "codex-cli", model: "gpt-5.5" })).toEqual({
      executorId: "codex-cli",
      model: "gpt-5.5"
    });
    expect(findModelForSelection({ executorId: "claude-code-cli", model: "sonnet" })?.enabled).toBe(true);
    expect(normalizeExecutorOverride({ executorId: "claude-code-cli", model: "" })).toBeUndefined();
  });

  it("only exposes controls the selected executor can actually honor", () => {
    expect(runtimeCapabilitiesForSelection({ executorId: "claude-code-cli", model: "sonnet" })).toMatchObject({
      selectable: true,
      supportsReasoningEffort: false
    });
    expect(runtimeCapabilitiesForSelection({ executorId: "codex-cli", model: "gpt-5.5" })).toMatchObject({
      selectable: true,
      supportsReasoningEffort: true
    });
    expect(normalizeExecutorOverride({ executorId: "opencode-cli", model: "opencode-default" })).toBeUndefined();
    expect(normalizeExecutorOverride({ executorId: "claude-code-cli", model: "not-a-model" })).toBeUndefined();
  });
});
