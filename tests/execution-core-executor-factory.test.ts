import { describe, expect, it } from "vitest";
import {
  CliAgentExecutor,
  DefaultAgentExecutorFactory,
  type ExecutorSelection
} from "@manyhands/execution-core";

const select = (executorId: ExecutorSelection["executorId"], model: string): ExecutorSelection => ({
  executorId,
  model
});

describe("DefaultAgentExecutorFactory (profile-driven)", () => {
  it("creates executors for every enabled CLI without a hardcoded switch", () => {
    const factory = new DefaultAgentExecutorFactory();

    expect(factory.create(select("gemini-cli", "gemini-2.5-pro"))).toBeInstanceOf(CliAgentExecutor);
    expect(factory.create(select("claude-code-cli", "sonnet"))).toBeInstanceOf(CliAgentExecutor);
    expect(factory.create(select("codex-cli", "gpt-5-codex"))).toBeInstanceOf(CliAgentExecutor);
  });

  it("caches one executor instance per executor id", () => {
    const factory = new DefaultAgentExecutorFactory();

    const first = factory.create(select("gemini-cli", "gemini-2.5-pro"));
    const second = factory.create(select("gemini-cli", "gemini-2.5-flash"));

    expect(second).toBe(first);
  });

  it("rejects executors that are disabled in the registry", () => {
    const factory = new DefaultAgentExecutorFactory();

    expect(() => factory.create(select("opencode-cli", "opencode-default"))).toThrow(/disabled/);
  });

  it("honours per-executor dependency overrides (binary path)", () => {
    const factory = new DefaultAgentExecutorFactory({
      "codex-cli": { binaryPath: "C:/tools/codex.exe" }
    });

    const executor = factory.create(select("codex-cli", "gpt-5-codex")) as CliAgentExecutor;

    expect(executor.binaryPath).toBe("C:/tools/codex.exe");
  });
});
