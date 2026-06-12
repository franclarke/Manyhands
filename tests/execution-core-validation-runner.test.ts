/**
 * ChildProcessValidationRunner — Windows-safe spawning.
 *
 * The run that motivated this: parent validation spawned `npm` without a shell
 * on win32 → ENOENT → exit 127 dressed up as a merge conflict. These tests pin
 * the contract: shell on win32 (npm/pnpm/yarn/npx are .cmd shims), unsafe
 * LLM-authored commands rejected pre-spawn (126), timeouts kill the whole
 * process tree, and "binary missing under shell" is normalized back to 127.
 */
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { ChildProcessValidationRunner } from "@manyhands/execution-core";
import type { ExecutionValidationCommand } from "@manyhands/contracts";

interface FakeChildScript {
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  errorMessage?: string;
  /** Never emit close/error — simulates a hung process (timeout path). */
  hang?: boolean;
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

function fakeChild(script: FakeChildScript): ChildProcess {
  const emitter = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = Object.assign(emitter, {
    stdout,
    stderr,
    pid: 4242,
    kill: vi.fn().mockReturnValue(true)
  }) as unknown as ChildProcess;

  queueMicrotask(() => {
    if (script.stdout !== undefined) stdout.emit("data", Buffer.from(script.stdout));
    if (script.stderr !== undefined) stderr.emit("data", Buffer.from(script.stderr));
    if (script.hang === true) return;
    if (script.errorMessage !== undefined) {
      emitter.emit("error", new Error(script.errorMessage));
      return;
    }
    emitter.emit("close", script.exitCode ?? 0);
  });
  return child;
}

function makeRunner(scripts: FakeChildScript[], useShell: boolean) {
  const calls: SpawnCall[] = [];
  let next = 0;
  const spawn = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ command, args, options });
    const script = scripts[Math.min(next, scripts.length - 1)];
    next += 1;
    return fakeChild(script ?? {});
  };
  return { runner: new ChildProcessValidationRunner({ spawn, useShell }), calls };
}

function command(overrides: Partial<ExecutionValidationCommand> = {}): ExecutionValidationCommand {
  return { command: "npm", args: ["test"], timeoutMs: 5_000, cwd: "worktree", ...overrides };
}

const ctx = { worktreePath: "/wt", repoRoot: "/repo" };

describe("ChildProcessValidationRunner — shell handling", () => {
  it.each(["npm", "pnpm", "yarn", "npx"])(
    "spawns %s through a shell when useShell is true, without altering command or args",
    async (binary) => {
      const { runner, calls } = makeRunner([{ exitCode: 0 }], true);
      const result = await runner.run([command({ command: binary, args: ["test"] })], ctx);
      expect(result.passed).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.command).toBe(binary);
      expect(calls[0]?.args).toEqual(["test"]);
      expect(calls[0]?.options.shell).toBe(true);
    }
  );

  it("spawns without a shell when useShell is false", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 0 }], false);
    await runner.run([command()], ctx);
    expect(calls[0]?.options.shell).toBe(false);
  });
});

describe("ChildProcessValidationRunner — unsafe commands", () => {
  it("rejects shell metacharacters in args with exit 126 and never spawns", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 0 }], true);
    const result = await runner.run([command({ args: ["test", "&& rm -rf /"] })], ctx);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(126);
    expect(result.output).toContain("validation command rejected (unsafe)");
    expect(calls).toHaveLength(0);
  });

  it("rejects path traversal in the command name with exit 126", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 0 }], true);
    const result = await runner.run([command({ command: "../../evil" })], ctx);
    expect(result.exitCode).toBe(126);
    expect(calls).toHaveLength(0);
  });
});

describe("ChildProcessValidationRunner — failure normalization", () => {
  it("keeps 127 for a spawn error event (no shell, binary missing)", async () => {
    const { runner } = makeRunner([{ errorMessage: "spawn npm ENOENT" }], false);
    const result = await runner.run([command()], ctx);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.output).toContain("ENOENT");
  });

  it("normalizes cmd.exe 'is not recognized' (exit 1 under shell) to 127", async () => {
    const { runner } = makeRunner(
      [{ exitCode: 1, stderr: "'npm' is not recognized as an internal or external command,\noperable program or batch file." }],
      true
    );
    const result = await runner.run([command()], ctx);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(127);
    expect(result.output).toContain("is not recognized");
  });

  it("does NOT rewrite a genuine test failure exit code", async () => {
    const { runner } = makeRunner([{ exitCode: 1, stdout: "1 test failed" }], true);
    const result = await runner.run([command()], ctx);
    expect(result.exitCode).toBe(1);
  });
});

describe("ChildProcessValidationRunner — timeout", () => {
  it("kills the process tree on timeout and reports exit 124", async () => {
    vi.useFakeTimers();
    try {
      const { runner, calls } = makeRunner([{ hang: true }], true);
      const pending = runner.run([command({ timeoutMs: 1_000 })], ctx);
      await vi.advanceTimersByTimeAsync(1_001);
      const result = await pending;
      expect(result.passed).toBe(false);
      expect(result.exitCode).toBe(124);
      if (process.platform === "win32") {
        // killProcessTree shells out to taskkill /t — the tree kill is the point.
        const taskkill = calls.find((call) => call.command === "taskkill");
        expect(taskkill?.args).toContain("/t");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("ChildProcessValidationRunner — short-circuit", () => {
  it("stops at the first failing command", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 2, stdout: "lint failed\n" }, { exitCode: 0 }], true);
    const result = await runner.run([command({ command: "eslint" }), command()], ctx);
    expect(result.exitCode).toBe(2);
    expect(calls).toHaveLength(1);
  });
});
