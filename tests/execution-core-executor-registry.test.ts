import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_EXECUTOR_ID,
  CODEX_EXECUTOR_ID,
  CliAgentExecutor,
  DefaultAgentExecutorFactory,
  EXECUTOR_DESCRIPTORS,
  normalizeExecutorSelection,
  resolveLegacyModelSelection,
  usageSourceForSelection
} from "@manyhands/execution-core";

describe("execution-core executor registry", () => {
  it("maps bare model strings to the Claude Code default executor", () => {
    expect(normalizeExecutorSelection("some-model")).toEqual({
      executorId: "claude-code-cli",
      model: "some-model"
    });
    expect(resolveLegacyModelSelection("legacy-model")).toEqual({
      executorId: "claude-code-cli",
      model: "legacy-model"
    });
  });

  it("describes enabled and disabled agentic executors", () => {
    expect(EXECUTOR_DESCRIPTORS.map((descriptor) => descriptor.id)).toEqual([
      "claude-code-cli",
      "codex-cli",
      "opencode-cli"
    ]);
    expect(EXECUTOR_DESCRIPTORS.find((descriptor) => descriptor.id === CLAUDE_CODE_EXECUTOR_ID)?.enabled).toBe(true);
    expect(EXECUTOR_DESCRIPTORS.find((descriptor) => descriptor.id === CODEX_EXECUTOR_ID)?.enabled).toBe(true);
    expect(EXECUTOR_DESCRIPTORS.find((descriptor) => descriptor.id === "opencode-cli")?.enabled).toBe(false);
  });

  it("constructs enabled adapters and rejects disabled executors", () => {
    const factory = new DefaultAgentExecutorFactory({
      "claude-code-cli": { binaryPath: "claude-test" }
    });

    expect(factory.create({ executorId: "claude-code-cli", model: "sonnet" })).toBeInstanceOf(CliAgentExecutor);
    expect(factory.create({ executorId: "codex-cli", model: "gpt-5-codex" })).toBeInstanceOf(CliAgentExecutor);
    expect(() => factory.create({ executorId: "opencode-cli", model: "opencode-default" })).toThrow(/disabled/u);
  });

  it("reports structured usage for CLIs with JSON output and unavailable for the rest", () => {
    expect(usageSourceForSelection({ executorId: "claude-code-cli", model: "sonnet" })).toBe("reported");
    expect(usageSourceForSelection({ executorId: "codex-cli", model: "gpt-5-codex" })).toBe("unavailable");
  });
});
