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
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
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
    const exitCode = script.exitCode ?? 0;
    (child as unknown as { exitCode: number | null }).exitCode = exitCode;
    emitter.emit("close", exitCode);
  });
  return child;
}

function makeRunner(scripts: FakeChildScript[], useShell: boolean) {
  const calls: SpawnCall[] = [];
  let next = 0;
  let activeRoot: ChildProcess | undefined;
  const spawn = (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    calls.push({ command, args, options });
    if (command === "taskkill") {
      const killer = fakeChild({ exitCode: 0 });
      queueMicrotask(() => {
        if (activeRoot !== undefined) {
          (activeRoot as unknown as { signalCode: NodeJS.Signals | null }).signalCode = "SIGKILL";
          activeRoot.emit("close", null, "SIGKILL");
        }
      });
      return killer;
    }
    const script = scripts[Math.min(next, scripts.length - 1)];
    next += 1;
    const child = fakeChild(script ?? {});
    activeRoot = child;
    return child;
  };
  return { runner: new ChildProcessValidationRunner({ spawn, useShell, platform: "linux" }), calls };
}

function command(overrides: Partial<ExecutionValidationCommand> = {}): ExecutionValidationCommand {
  return { command: "npm", args: ["test"], timeoutMs: 5_000, cwd: "worktree", ...overrides };
}

const ctx = { worktreePath: "/wt", repoRoot: "/repo" };

describe("ChildProcessValidationRunner — shell handling", () => {
  it.each(["npm", "pnpm", "yarn", "npx"])(
    "keeps %s argv structured when the legacy useShell flag is true",
    async (binary) => {
      const { runner, calls } = makeRunner([{ exitCode: 0 }], true);
      const result = await runner.run([command({ command: binary, args: ["test"] })], ctx);
      expect(result.passed).toBe(true);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.command).toBe(binary);
      expect(calls[0]?.args).toEqual(["test"]);
      expect(calls[0]?.options.shell).toBe(false);
    }
  );

  it("spawns without a shell when useShell is false", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 0 }], false);
    await runner.run([command()], ctx);
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("wraps Windows package-manager shims without enabling Node shell interpolation", async () => {
    const calls: SpawnCall[] = [];
    const spawn = (binary: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
      calls.push({ command: binary, args, options });
      return fakeChild({ exitCode: 0 });
    };
    const runner = new ChildProcessValidationRunner({ spawn, useShell: false, platform: "win32" });

    const result = await runner.run([command({ command: "npm", args: ["test"] })], ctx);

    expect(result.passed).toBe(true);
    expect(calls[0]?.command.toLowerCase()).toMatch(/cmd\.exe$/u);
    expect(calls[0]?.args.slice(0, 4)).toEqual(["/d", "/v:off", "/s", "/c"]);
    expect(calls[0]?.args[4]?.toLowerCase()).toContain("npm.cmd");
    expect(calls[0]?.args[4]).toContain("test");
    expect(calls[0]?.options.shell).toBe(false);
    expect(calls[0]?.options.windowsVerbatimArguments).toBe(true);
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

  it("allows node -e JavaScript metacharacters as structured args", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 0, stdout: "ok\n" }], false);
    const script = "const text=`a|b > c`; if(!/a|b/.test(text)) throw new Error('bad');";
    const result = await runner.run([command({ command: "node", args: ["-e", script] })], ctx);

    expect(result.passed).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["-e", script]);
    expect(calls[0]?.options.shell).toBe(false);
  });

  it("rejects standalone shell redirection operators", async () => {
    const { runner, calls } = makeRunner([{ exitCode: 0 }], false);
    const result = await runner.run([command({ args: ["test", ">", "out.txt"] })], ctx);

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

  it("normalizes the placeholder-tsc message (TypeScript not installed) to 127", async () => {
    // When a project has no local TypeScript, `npx tsc` resolves to the squatted
    // `tsc` npm package, which exits 1 with this banner. That is a missing
    // toolchain (infra), not a type error in the code — normalize it to 127.
    const { runner } = makeRunner(
      [
        {
          exitCode: 1,
          stdout:
            "\nThis is not the tsc command you are looking for\n\n" +
            "To get access to the TypeScript compiler, tsc, from the command line either:\n" +
            "- Use npm install typescript to first add TypeScript to your project before using npx\n"
        }
      ],
      true
    );
    const result = await runner.run([command({ command: "npx", args: ["tsc", "--noEmit"] })], ctx);
    expect(result.passed).toBe(false);
    expect(result.exitCode).toBe(127);
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
  it("does not return while a validation descendant can still write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "mh-validation-tree-"));
    const started = join(directory, "descendant-started.txt");
    const lateWrite = join(directory, "late-write.txt");
    const descendantPath = join(directory, "descendant.cjs");
    const parentPath = join(directory, "parent.cjs");
    await writeFile(descendantPath, [
      `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(lateWrite)}, "stale"), 800);`,
      "setInterval(() => {}, 1000);"
    ].join(""), "utf8");
    await writeFile(parentPath, [
      'const { spawn } = require("node:child_process");',
      `spawn(process.execPath, [${JSON.stringify(descendantPath)}], { stdio: "ignore" });`,
      `require("node:fs").writeFileSync(${JSON.stringify(started)}, "started");`,
      "setInterval(() => {}, 1000);"
    ].join(""), "utf8");

    try {
      const runner = new ChildProcessValidationRunner();
      const result = await runner.run(
        [command({ command: "node", args: [parentPath], timeoutMs: 250 })],
        { worktreePath: directory, repoRoot: directory }
      );

      expect(result.exitCode).toBe(124);
      expect(existsSync(started)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 900));
      expect(existsSync(lateWrite)).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
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
