import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  CLAUDE_CODE_PROFILE,
  CliAgentExecutor,
  buildClaudeCodeArgs,
  parseClaudeCodeOutcome,
  type AgentExecutorOptions,
  type ExecutorRunOutcome
} from "@manyhands/execution-core";

function optionsFor(cwd: string, overrides: Partial<AgentExecutorOptions> = {}): AgentExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "sonnet",
    timeoutMs: 300_000,
    bypassApprovals: true,
    ...overrides
  };
}

function outcome(partial: Partial<ExecutorRunOutcome>): ExecutorRunOutcome {
  return { exitCode: 0, stdout: "", stderr: "", timedOut: false, durationMs: 5, ...partial };
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

describe("buildClaudeCodeArgs", () => {
  it("uses print mode with structured JSON output and headless permissions", () => {
    expect(buildClaudeCodeArgs(optionsFor("/repo"))).toEqual([
      "-p",
      "Follow the instructions provided on stdin.",
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--dangerously-skip-permissions"
    ]);
  });

  it("falls back to acceptEdits permission mode when approvals are not bypassed", () => {
    expect(buildClaudeCodeArgs(optionsFor("/repo", { bypassApprovals: false }))).toEqual([
      "-p",
      "Follow the instructions provided on stdin.",
      "--model",
      "sonnet",
      "--output-format",
      "json",
      "--permission-mode",
      "acceptEdits"
    ]);
  });
});

describe("parseClaudeCodeOutcome", () => {
  it("extracts the result text, reported usage and cost from the JSON envelope", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "Implemented the feature.",
      total_cost_usd: 0.1234,
      usage: { input_tokens: 1500, output_tokens: 420 },
      session_id: "sess-1"
    });

    const parsed = parseClaudeCodeOutcome(outcome({ stdout }));

    expect(parsed.stdout).toBe("Implemented the feature.");
    expect(parsed.tokensIn).toBe(1500);
    expect(parsed.tokensOut).toBe(420);
    expect(parsed.costUsd).toBeCloseTo(0.1234);
  });

  it("keeps the envelope error text visible when the run errored", () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "Credit balance is too low",
      usage: { input_tokens: 10, output_tokens: 0 }
    });

    const parsed = parseClaudeCodeOutcome(outcome({ stdout, exitCode: 1 }));

    expect(parsed.stderr).toContain("Credit balance is too low");
  });

  it("passes non-JSON output through untouched", () => {
    const raw = outcome({ stdout: "plain text" });
    expect(parseClaudeCodeOutcome(raw)).toEqual(raw);
  });
});

describe("CliAgentExecutor with the Claude Code profile (injected spawn)", () => {
  it("captures and parses structured output", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CLAUDE_CODE_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.stdout.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          type: "result",
          is_error: false,
          result: "done",
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 20 }
        })
      )
    );
    child.stderr.emit("data", Buffer.from("warn\n"));
    child.emit("close", 0);

    await expect(promise).resolves.toMatchObject({
      exitCode: 0,
      stdout: "done",
      stderr: "warn\n",
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.01,
      timedOut: false
    });
  });

  it("surfaces spawn errors as non-zero outcomes", async () => {
    const child = fakeChild();
    const executor = new CliAgentExecutor(CLAUDE_CODE_PROFILE, depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("error", new Error("spawn claude ENOENT"));

    await expect(promise).resolves.toMatchObject({ exitCode: 127, timedOut: false });
  });

  it("kills the process and marks timeouts", async () => {
    const child = fakeChild();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    const executor = new CliAgentExecutor(CLAUDE_CODE_PROFILE, depsFor(child));

    const result = await executor.execute(optionsFor("/repo", { timeoutMs: 5 }));

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(killed).toBe(true);
  });
});
