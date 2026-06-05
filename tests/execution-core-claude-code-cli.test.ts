import { EventEmitter } from "node:events";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  ClaudeCodeCliExecutor,
  buildClaudeCodeArgs,
  type AgentExecutorOptions
} from "@manyhands/execution-core";

function optionsFor(cwd: string): AgentExecutorOptions {
  return {
    cwd,
    instructionFilePath: join(cwd, "instructions.txt"),
    model: "sonnet",
    timeoutMs: 300_000,
    sandboxMode: "workspace-write",
    bypassApprovals: true
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

describe("buildClaudeCodeArgs", () => {
  it("uses print mode, model selection, text output, and headless permissions", () => {
    expect(buildClaudeCodeArgs(optionsFor("/repo"))).toEqual([
      "-p",
      "Follow the instructions provided on stdin.",
      "--model",
      "sonnet",
      "--output-format",
      "text",
      "--dangerously-skip-permissions"
    ]);
  });
});

describe("ClaudeCodeCliExecutor (injected spawn)", () => {
  it("captures stdout/stderr and exit code", async () => {
    const child = fakeChild();
    const executor = new ClaudeCodeCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.stdout.emit("data", Buffer.from("done\n"));
    child.stderr.emit("data", Buffer.from("warn\n"));
    child.emit("close", 0);

    await expect(promise).resolves.toMatchObject({
      exitCode: 0,
      stdout: "done\n",
      stderr: "warn\n",
      timedOut: false
    });
  });

  it("surfaces spawn errors as non-zero outcomes", async () => {
    const child = fakeChild();
    const executor = new ClaudeCodeCliExecutor(depsFor(child));

    const promise = executor.execute(optionsFor("/repo"));
    child.emit("error", new Error("spawn claude ENOENT"));

    await expect(promise).resolves.toMatchObject({
      exitCode: 127,
      timedOut: false
    });
  });

  it("kills the process and marks timeouts", async () => {
    const child = fakeChild();
    let killed = false;
    child.kill = () => {
      killed = true;
      return true;
    };
    const executor = new ClaudeCodeCliExecutor(depsFor(child));

    const outcome = await executor.execute({ ...optionsFor("/repo"), timeoutMs: 5 });

    expect(outcome.exitCode).toBe(124);
    expect(outcome.timedOut).toBe(true);
    expect(killed).toBe(true);
  });
});
