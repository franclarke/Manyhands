import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

import type { CodexCliExecutorOptions } from "../types";
import type { CodexExecutor, CodexRunOutcome } from "./types";

/** Conventional exit codes used when the process never produced its own. */
const TIMEOUT_EXIT_CODE = 124;
const SPAWN_FAILURE_EXIT_CODE = 127;

/**
 * Builds the `codex exec` argument vector from the executor options. Pure and
 * synchronous so it can be unit-tested without spawning a process (ADR-0019).
 *
 * Instructions live in a temp file written by the caller and are passed via
 * `--instructions-file` (never stdin); `bypassApprovals` maps to
 * `--ask-for-approval never` so the agent runs non-interactively inside the
 * sandbox boundary set by `--sandbox`.
 */
export function buildCodexArgs(options: CodexCliExecutorOptions): string[] {
  const args = [
    "exec",
    "--instructions-file",
    options.instructionFilePath,
    "--sandbox",
    options.sandboxMode,
    "--model",
    options.model
  ];
  if (options.bypassApprovals) {
    args.push("--ask-for-approval", "never");
  }
  return args;
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface CodexCliExecutorDeps {
  /** Codex CLI binary. Defaults to `codex` on `$PATH`. */
  binaryPath?: string;
  /** Injectable spawn for tests. Defaults to node:child_process spawn. */
  spawn?: SpawnFn;
}

/**
 * Real CodexExecutor backed by `codex exec` (D4 — the only agent executor).
 * Spawns the CLI in the worktree, enforces a hard timeout (D10), and returns a
 * CodexRunOutcome. The orchestrator never trusts stdout to decide what changed
 * (D5); these fields are diagnostics plus the exit signal. Process-level
 * failures (binary missing, spawn error) surface as a non-zero exit outcome so
 * the seam stays total and the ResultRecorder maps them to `codex_error`.
 */
export class CodexCliExecutor implements CodexExecutor {
  private readonly binaryPath: string;
  private readonly spawnFn: SpawnFn;

  constructor(deps: CodexCliExecutorDeps = {}) {
    this.binaryPath = deps.binaryPath ?? "codex";
    this.spawnFn = deps.spawn ?? spawn;
  }

  execute(options: CodexCliExecutorOptions): Promise<CodexRunOutcome> {
    const args = buildCodexArgs(options);
    const start = Date.now();

    return new Promise<CodexRunOutcome>((resolve) => {
      const child = this.spawnFn(this.binaryPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (outcome: CodexRunOutcome): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish({
          exitCode: TIMEOUT_EXIT_CODE,
          stdout,
          stderr,
          timedOut: true,
          durationMs: Date.now() - start
        });
      }, options.timeoutMs);

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
    });
  }
}
