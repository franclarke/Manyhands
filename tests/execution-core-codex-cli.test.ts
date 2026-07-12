import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  CODEX_EXECUTOR_ID,
  CODEX_PROFILE,
  CliAgentExecutor,
  buildCodexArgs,
  getExecutorDescriptor,
  type AgentExecutorOptions
} from "@manyhands/execution-core";

function optionsFor(cwd: string, overrides: Partial<AgentExecutorOptions> = {}): AgentExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "gpt-5-codex",
    timeoutMs: 300_000,
    bypassApprovals: false,
    ...overrides
  };
}

function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    kill: (signal?: string) => boolean;
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => true;
  return child;
}

function depsFor(child: ReturnType<typeof fakeChild>) {
  return {
    spawn: () => child as never,
    readInstructions: async () => "do the thing",
    useShell: false
  };
}

describe("buildCodexArgs", () => {
  it("runs codex exec headless with a writable sandbox and stdin prompt", () => {
    expect(buildCodexArgs(optionsFor("/repo"))).toEqual([
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "exec",
      "--model",
      "gpt-5-codex",
      "--color",
      "never",
      "--ephemeral",
      "--skip-git-repo-check",
      "-"
    ]);
  });

  it("swaps the sandbox for full bypass when approvals are bypassed", () => {
    expect(buildCodexArgs(optionsFor("/repo", { bypassApprovals: true }))).toEqual([
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
      "exec",
      "--model",
      "gpt-5-codex",
      "--color",
      "never",
      "--ephemeral",
      "--skip-git-repo-check",
      "-"
    ]);
  });

  it("passes reasoning effort to codex exec when configured", () => {
    expect(buildCodexArgs(optionsFor("/repo", { reasoningEffort: "medium" }))).toContain(
      'model_reasoning_effort="medium"'
    );
  });
});

describe("Codex executor registry entry", () => {
  it("is enabled with gpt-5.5 as default model", () => {
    const descriptor = getExecutorDescriptor(CODEX_EXECUTOR_ID);
    expect(descriptor.enabled).toBe(true);
    expect(descriptor.defaultModel).toBe("gpt-5.5");
    expect(descriptor.binaryEnvVar).toBe("MANYHANDS_CODEX_BIN");
  });
});

describe("CliAgentExecutor with the Codex profile (injected spawn)", () => {
  it("captures stdout/stderr and exit code", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CODEX_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.stdout.emit("data", Buffer.from("implemented\n"));
    child.emit("close", 0);

    await expect(promise).resolves.toMatchObject({
      exitCode: 0,
      stdout: "implemented\n",
      timedOut: false
    });
  });

  it("surfaces spawn errors as non-zero outcomes", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CODEX_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("error", new Error("spawn codex ENOENT"));

    await expect(promise).resolves.toMatchObject({ exitCode: 127, timedOut: false });
  });

  it("runs Windows batch shims through a shell", async () => {
    const child = fakeChild();
    let shellOption: SpawnOptionsWithoutStdio["shell"] | undefined;
    const executor = new CliAgentExecutor(CODEX_PROFILE, {
      readInstructions: async () => "do the thing",
      binaryPath: "C:\\tools\\codex.cmd",
      spawn: (_command, _args, options) => {
        shellOption = options.shell;
        return child as never;
      }
    });

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("close", 0);

    await promise;
    expect(shellOption).toBe(true);
  });
});
