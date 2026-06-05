import type { ChildProcess, SpawnOptions } from "node:child_process";

import type { ExecutorRunOutcome } from "./types";

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

/** Conventional exit codes used when the process never produced its own. */
export const TIMEOUT_EXIT_CODE = 124;
export const SPAWN_FAILURE_EXIT_CODE = 127;
/** Mirrors the shell convention for "terminated by signal" — used on abort. */
export const ABORTED_EXIT_CODE = 130;

/**
 * Kills an executor process and its descendants. On Windows a shelled CLI shim
 * often runs under cmd.exe/PowerShell, so child.kill only reaches the shell.
 */
export function killProcessTree(child: ChildProcess, spawnFn: SpawnFn): void {
  if (process.platform === "win32" && typeof child.pid === "number") {
    try {
      spawnFn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    } catch {
      // Fall through to a best-effort signal.
    }
  }
  child.kill("SIGKILL");
}

export interface SpawnExecutorParams {
  binaryPath: string;
  args: string[];
  cwd: string;
  env?: Record<string, string> | undefined;
  useShell: boolean;
  timeoutMs: number;
  /** Aborts the run: kills the process tree and resolves with an aborted outcome. */
  signal?: AbortSignal | undefined;
  spawnFn: SpawnFn;
  readInstructions: (filePath: string) => Promise<string>;
  instructionFilePath: string;
}

/**
 * Shared CLI-executor process driver used by both the Gemini and Claude Code
 * executors (they differ only in binary + arg vector). Spawns the CLI in the
 * worktree, pipes the instruction file over stdin, enforces the hard timeout
 * (D10), and tears down the whole process tree on timeout **or abort** so a
 * cancelled/over-budget run actually stops the subprocess instead of leaving it
 * burning quota. The orchestrator never trusts stdout to decide what changed
 * (D5) — these fields are diagnostics plus the exit signal.
 */
export function spawnExecutorProcess(params: SpawnExecutorParams): Promise<ExecutorRunOutcome> {
  const { spawnFn, binaryPath, args, cwd, env, useShell, timeoutMs, signal, readInstructions, instructionFilePath } =
    params;
  const start = Date.now();

  return new Promise<ExecutorRunOutcome>((resolve) => {
    if (signal?.aborted === true) {
      resolve({
        exitCode: ABORTED_EXIT_CODE,
        stdout: "",
        stderr: "aborted before start",
        timedOut: false,
        durationMs: 0
      });
      return;
    }

    const child = spawnFn(binaryPath, args, {
      cwd,
      env: { ...process.env, ...(env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (outcome: ExecutorRunOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    const onAbort = (): void => {
      killProcessTree(child, spawnFn);
      finish({
        exitCode: ABORTED_EXIT_CODE,
        stdout,
        stderr: `${stderr}${stderr ? "\n" : ""}aborted by orchestrator`,
        timedOut: false,
        durationMs: Date.now() - start
      });
    };

    const timer = setTimeout(() => {
      killProcessTree(child, spawnFn);
      finish({
        exitCode: TIMEOUT_EXIT_CODE,
        stdout,
        stderr,
        timedOut: true,
        durationMs: Date.now() - start
      });
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: Error) => {
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout,
        stderr: stderr + (stderr ? "\n" : "") + error.message,
        timedOut: false,
        durationMs: Date.now() - start
      });
    });

    child.on("close", (code) => {
      finish({
        exitCode: code ?? SPAWN_FAILURE_EXIT_CODE,
        stdout,
        stderr,
        timedOut: false,
        durationMs: Date.now() - start
      });
    });

    // Listeners are attached synchronously above; only then read the instruction
    // file and feed it over stdin. Guard EPIPE: the child may exit before we
    // finish writing.
    readInstructions(instructionFilePath).then(
      (prompt) => {
        child.stdin?.on("error", () => undefined);
        child.stdin?.end(prompt);
      },
      (error: Error) => {
        killProcessTree(child, spawnFn);
        finish({
          exitCode: SPAWN_FAILURE_EXIT_CODE,
          stdout,
          stderr: `${stderr}${stderr ? "\n" : ""}failed to read instructions: ${error.message}`,
          timedOut: false,
          durationMs: Date.now() - start
        });
      }
    );
  });
}
