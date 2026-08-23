import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { SpawnOptions } from "node:child_process";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  CODEX_EXECUTOR_ID,
  CODEX_PROFILE,
  CliAgentExecutor,
  ResultRecorder,
  buildCodexArgs,
  getExecutorDescriptor,
  type AgentExecutorOptions,
  type WorktreeRecord
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

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
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "workspace-write",
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      "sandbox_workspace_write.network_access=false",
      "-c",
      'windows.sandbox="elevated"',
      "--cd",
      "/repo",
      "--add-dir",
      "/repo",
      "--model",
      "gpt-5-codex",
      "--color",
      "never",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "-"
    ]);
  });

  it("swaps the sandbox for full bypass when approvals are bypassed", () => {
    expect(buildCodexArgs(optionsFor("/repo", { bypassApprovals: true }))).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "danger-full-access",
      "-c",
      'sandbox_mode="danger-full-access"',
      "-c",
      "sandbox_workspace_write.network_access=false",
      "-c",
      'windows.sandbox="elevated"',
      "--cd",
      "/repo",
      "--add-dir",
      "/repo",
      "--model",
      "gpt-5-codex",
      "--color",
      "never",
      "--ephemeral",
      "--ignore-user-config",
      "--skip-git-repo-check",
      "-"
    ]);
  });

  it("uses the explicitly selected native Windows workspace implementation", () => {
    expect(buildCodexArgs(optionsFor("/repo", { windowsSandbox: "unelevated" }))).toContain(
      'windows.sandbox="unelevated"'
    );
    expect(buildCodexArgs(optionsFor("/repo"))).toContain('windows.sandbox="elevated"');
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

  it("fails as sandbox_unavailable when Codex exits zero after starting read-only", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CODEX_PROFILE, depsFor(child));
    const promise = executor.execute(optionsFor("/repo", { windowsSandbox: "elevated" }));
    child.stderr.emit("data", Buffer.from([
      "OpenAI Codex v0.148.0",
      "sandbox: read-only",
      "patch rejected: writing is blocked by read-only sandbox; rejected by user approval settings"
    ].join("\n")));
    child.emit("close", 0);

    const executorOutcome = await promise;
    const git = new FakeGitRunner({ heads: { "/repo": "BASE_SHA" }, diffCachedNameOnly: [] });
    const recorder = new ResultRecorder({ git, traceStore: new InMemoryTraceStore() });
    const worktree: WorktreeRecord = {
      taskId: "task:sandbox-probe",
      runId: "run:sandbox-probe",
      kind: "leaf",
      path: "/repo",
      branch: "mh/run-sandbox-probe/task-sandbox-probe",
      baseCommit: "BASE_SHA",
      status: "active",
      createdAt: "2026-08-20T00:00:00.000Z"
    };

    const result = await recorder.record({ worktree, executorOutcome });

    expect(result).toMatchObject({
      status: "executor_error",
      failureKind: "sandbox_unavailable",
      executorExitCode: 0
    });
    expect(git.calls).toHaveLength(0);
  });

  it("does not mistake sandbox text echoed from the user prompt for the Codex preamble", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CODEX_PROFILE, depsFor(child));
    const promise = executor.execute(optionsFor("/repo", { windowsSandbox: "elevated" }));
    child.stderr.emit("data", Buffer.from([
      "OpenAI Codex v0.148.0",
      "sandbox: workspace-write [workdir]",
      "--------",
      "user",
      "Diagnose this historical line without treating it as the current sandbox:",
      "sandbox: read-only"
    ].join("\n")));
    child.emit("close", 0);

    const outcome = await promise;
    expect(outcome.exitCode).toBe(0);
    expect(outcome.failureDiagnosis).toBeUndefined();
  });

  it("reports sandbox_unavailable when native Windows sandbox setup cannot launch", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CODEX_PROFILE, depsFor(child));
    const promise = executor.execute(optionsFor("/repo", { windowsSandbox: "elevated" }));
    child.stderr.emit("data", Buffer.from([
      "sandbox setup required: sandbox users missing or incompatible with marker version",
      "orchestrator_helper_launch_canceled: ShellExecuteExW failed to launch setup helper: 1223"
    ].join("\n")));
    child.emit("close", 1);

    await expect(promise).resolves.toMatchObject({
      exitCode: 1,
      failureDiagnosis: {
        kind: "sandbox_unavailable",
        retryableOnOtherExecutor: false
      }
    });
  });

  it("reports sandbox_unavailable when the native Windows sandbox cannot create its logon process", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CODEX_PROFILE, depsFor(child));
    const promise = executor.execute(optionsFor("/repo", { windowsSandbox: "elevated" }));
    child.stderr.emit("data", Buffer.from([
      "OpenAI Codex v0.148.0",
      "sandbox: workspace-write [workdir]",
      "--------",
      "user",
      "Implement the requested change.",
      "ERROR codex_core::tools::router: apply_patch failed: windows sandbox failed: CreateProcessWithLogonW failed: 2147942522"
    ].join("\n")));
    child.emit("close", 0);

    await expect(promise).resolves.toMatchObject({
      exitCode: 0,
      failureDiagnosis: {
        kind: "sandbox_unavailable",
        retryableOnOtherExecutor: false
      }
    });
  });

  it("runs Windows batch shims through explicit cmd.exe without shell:true", async () => {
    const child = fakeChild();
    let call:
      | { command: string; args: readonly string[]; options: SpawnOptions }
      | undefined;
    const executor = new CliAgentExecutor(CODEX_PROFILE, {
      readInstructions: async () => "do the thing",
      binaryPath: "C:\\Program Files\\Codex & Tools\\codex.cmd",
      platform: "win32",
      hostEnv: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
      spawn: (command, args, options) => {
        call = { command, args, options };
        return child as never;
      }
    });

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("close", 0);

    await promise;
    expect(call).toBeDefined();
    expect(call?.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(call?.options.shell).toBe(false);
    expect(call?.options.windowsVerbatimArguments).toBe(true);
    expect(call?.args.slice(0, 4)).toEqual(["/d", "/v:off", "/s", "/c"]);
    expect(call?.args[4]).toContain("C:\\Program^ Files\\Codex^ ^&^ Tools\\codex.cmd");
    expect(call?.args[4]).toContain('^^^"--model^^^"');
  });
});
