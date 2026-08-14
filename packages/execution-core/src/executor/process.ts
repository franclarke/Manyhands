import { basename } from "node:path";

import { BoundedOutput } from "./bounded-output";

import { execError, execLog, execWarn } from "../logging/log";
import type { ExecutorOutputChunk } from "../types";
import { buildAgentEnvironment } from "./agent-env";
import { killProcessTree, type SpawnFn } from "./kill";
import { registerLiveProcess, unregisterLiveProcess } from "./live-process-registry";
import type { ExecutorRunOutcome } from "./types";

export { killProcessTree, type SpawnFn } from "./kill";

/** Conventional exit codes used when the process never produced its own. */
export const TIMEOUT_EXIT_CODE = 124;
export const SPAWN_FAILURE_EXIT_CODE = 127;
/** Mirrors the shell convention for "terminated by signal" — used on abort. */
export const ABORTED_EXIT_CODE = 130;

export interface SpawnExecutorParams {
  binaryPath: string;
  args: string[];
  cwd: string;
  env?: Record<string, string> | undefined;
  isolatedEnvironment?: boolean | undefined;
  /** @deprecated Executor argv is always spawned without Node shell interpolation. */
  useShell: boolean;
  windowsVerbatimArguments?: boolean | undefined;
  timeoutMs: number;
  /** Aborts the run: kills the process tree and resolves with an aborted outcome. */
  signal?: AbortSignal | undefined;
  /**
   * Registers the live child under this owner (the runId) so cancellation can
   * force-kill and VERIFY everything still running for the run (INV-2).
   */
  processOwnerId?: string | undefined;
  attemptId?: string | undefined;
  spawnFn: SpawnFn;
  readInstructions: (filePath: string) => Promise<string>;
  instructionFilePath: string;
  /**
   * When set, the driver emits structured spawn-lifecycle logs under this scope
   * ("spawning agent", "agent timed out", "spawn failed", "agent exited"). This is
   * high-value for diagnosing "the executor never ran" failures (ENOENT, missing
   * binary). Left undefined the driver stays silent. The worktree dir is named
   * after the taskId, so its basename correlates every line back to the task.
   */
  logScope?: string | undefined;
  /** Emits raw stdout/stderr chunks as they arrive. Diagnostics only; D5 stays git-diff based. */
  onOutput?: ((chunk: ExecutorOutputChunk) => void) | undefined;
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
  const {
    spawnFn,
    binaryPath,
    args,
    cwd,
    env,
    isolatedEnvironment,
    windowsVerbatimArguments,
    timeoutMs,
    signal,
    processOwnerId,
    attemptId,
    readInstructions,
    instructionFilePath,
    logScope,
    onOutput
  } = params;
  const start = Date.now();
  const task = basename(cwd);
  const commandLine = formatCommandLine(binaryPath, args);

  return new Promise<ExecutorRunOutcome>((resolve) => {
    if (signal?.aborted === true) {
      resolve({
        exitCode: ABORTED_EXIT_CODE,
        stdout: "",
        stderr: "aborted before start",
        timedOut: false,
        durationMs: 0,
        commandLine
      });
      return;
    }

    if (logScope !== undefined) {
      execLog(logScope, "spawning agent", {
        task,
        binary: binaryPath,
        args,
        timeoutMs,
        shell: false,
        ...(windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments } : {}),
        cwd
      });
    }

    let child: ReturnType<SpawnFn>;
    try {
      child = spawnFn(binaryPath, args, {
        cwd,
        // B-006 (CF-28): agents never inherit the whole server environment —
        // only the allowlist plus the caller's explicitly-declared overrides.
        env: isolatedEnvironment ? env ?? {} : { ...buildAgentEnvironment(), ...(env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        ...(windowsVerbatimArguments !== undefined ? { windowsVerbatimArguments } : {}),
        // POSIX: own process group, so killProcessTree's kill(-pid) reaches every
        // descendant. Windows ignores detached-for-groups; taskkill /t covers it.
        detached: process.platform !== "win32"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (logScope !== undefined) {
        execError(logScope, "spawn failed before process start", {
          task,
          binary: binaryPath,
          message,
          hint: "binary could not be launched — check it is executable and on PATH / the executor's *_BIN env var"
        });
      }
      resolve({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout: "",
        stderr: message,
        timedOut: false,
        durationMs: Date.now() - start,
        commandLine
      });
      return;
    }

    if (processOwnerId !== undefined) {
      registerLiveProcess(processOwnerId, child, {
        runId: processOwnerId,
        label: logScope ?? "executor",
        ...(attemptId !== undefined ? { attemptId } : {})
      });
      // 'close' fires on every exit path (clean, timeout-kill, abort-kill).
      child.once("close", () => unregisterLiveProcess(processOwnerId, child));
    }

    const stdout = new BoundedOutput();
    const stderr = new BoundedOutput();
    let settled = false;
    let terminating = false;

    const finish = (outcome: ExecutorRunOutcome): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };

    const terminateAndFinish = async (
      buildOutcome: (terminationVerified: boolean) => ExecutorRunOutcome
    ): Promise<void> => {
      if (settled || terminating) return;
      terminating = true;
      const terminationVerified = await killProcessTree(child, spawnFn);
      finish(buildOutcome(terminationVerified));
    };

    const onAbort = (): void => {
      void terminateAndFinish((terminationVerified) => ({
          exitCode: ABORTED_EXIT_CODE,
          stdout: stdout.text(),
          stderr:
            `${stderr.text()}${stderr.text() ? "\n" : ""}aborted by orchestrator` +
            (terminationVerified ? "" : "\nprocess-tree termination could not be verified"),
          timedOut: false,
          durationMs: Date.now() - start,
          commandLine
        }));
    };

    const timer = setTimeout(() => {
      if (logScope !== undefined) {
        execWarn(logScope, "agent timed out — killing process tree", {
          task,
          timeoutMs,
          durationMs: Date.now() - start,
          stderrTail: stderr.text()
        });
      }
      void terminateAndFinish((terminationVerified) => ({
          exitCode: TIMEOUT_EXIT_CODE,
          stdout: stdout.text(),
          stderr:
            stderr.text() +
            (terminationVerified
              ? ""
              : `${stderr.text() ? "\n" : ""}process-tree termination could not be verified`),
          timedOut: true,
          durationMs: Date.now() - start,
          commandLine
        }));
    }, timeoutMs);

    signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout.append(text);
      onOutput?.({ stream: "stdout", chunk: text });
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr.append(text);
      onOutput?.({ stream: "stderr", chunk: text });
    });

    child.on("error", (error: Error) => {
      if (terminating) return;
      // Most common real failure: binary missing / not on PATH (ENOENT). This is
      // exactly the "executor never ran" symptom — surface it loudly.
      if (logScope !== undefined && !settled) {
        execError(logScope, "spawn failed — agent never started", {
          task,
          binary: binaryPath,
          code: (error as NodeJS.ErrnoException).code,
          message: error.message,
          hint: "binary not found — check it is on PATH / the executor's *_BIN env var"
        });
      }
      finish({
        exitCode: SPAWN_FAILURE_EXIT_CODE,
        stdout: stdout.text(),
        stderr: `${stderr.text()}${stderr.text() ? "\n" : ""}${error.message}`,
        timedOut: false,
        durationMs: Date.now() - start,
        commandLine
      });
    });

    child.on("close", (code) => {
      if (terminating) return;
      // Only log when this close is what settles the run — after a timeout/abort
      // the process still emits close, but that outcome is already decided.
      if (logScope !== undefined && !settled) {
        const durationMs = Date.now() - start;
        if (code === 0) {
          execLog(logScope, "agent exited cleanly", { task, exitCode: 0, durationMs });
        } else {
          execWarn(logScope, "agent exited non-zero", {
            task,
            exitCode: code ?? SPAWN_FAILURE_EXIT_CODE,
            durationMs,
            stderrTail: stderr.text()
          });
        }
      }
      finish({
        exitCode: code ?? SPAWN_FAILURE_EXIT_CODE,
        stdout: stdout.text(),
        stderr: stderr.text(),
        timedOut: false,
        durationMs: Date.now() - start,
        commandLine
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
        if (logScope !== undefined && !settled) {
          execError(logScope, "failed to read instruction file", {
            task,
            path: instructionFilePath,
            message: error.message
          });
        }
        void terminateAndFinish((terminationVerified) => ({
            exitCode: SPAWN_FAILURE_EXIT_CODE,
            stdout: stdout.text(),
            stderr:
              `${stderr.text()}${stderr.text() ? "\n" : ""}failed to read instructions: ${error.message}` +
              (terminationVerified ? "" : "\nprocess-tree termination could not be verified"),
            timedOut: false,
            durationMs: Date.now() - start,
            commandLine
          }));
      }
    );
  });
}

function formatCommandLine(binaryPath: string, args: readonly string[]): string {
  return [binaryPath, ...args].map(quoteForDisplay).join(" ");
}

function quoteForDisplay(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}
