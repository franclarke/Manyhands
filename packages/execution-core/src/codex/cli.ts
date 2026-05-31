import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { CodexCliExecutorOptions } from "../types";
import type { CodexExecutor, CodexRunOutcome } from "./types";

/** Conventional exit codes used when the process never produced its own. */
const TIMEOUT_EXIT_CODE = 124;
const SPAWN_FAILURE_EXIT_CODE = 127;

/**
 * Builds the `codex exec` argument vector from the executor options. Pure and
 * synchronous so it can be unit-tested without spawning a process (ADR-0019).
 *
 * The prompt is NOT an argument — `codex exec` reads its instructions from
 * stdin (the CLI has no `--instructions-file` flag). `codex exec` is already
 * non-interactive by design, so there is NO `--ask-for-approval` flag here
 * (that belongs to the interactive `codex` command; passing it to `exec` makes
 * the CLI reject the whole invocation). Autonomy is bounded solely by
 * `--sandbox`; `bypassApprovals` is therefore a no-op at the arg layer and kept
 * only for interface symmetry with the mock. Verified against codex-cli 0.135.0.
 */
export function buildCodexArgs(options: CodexCliExecutorOptions): string[] {
  const args = ["exec", "--sandbox", options.sandboxMode, "--model", options.model];
  // Reasoning effort is a fixed experimental condition set once per matrix run,
  // not a per-leaf variable — so it is sourced from the environment, not the
  // options schema. codex-cli defaults to `xhigh`, which can push a single leaf
  // past the D10 timeout (>300s); `low`/`medium` brings the same task to ~60s,
  // which is what makes the B0–B4 × G3/G6/G9 matrix tractable. `-c key=value`
  // is codex's config-override flag (verified against 0.135.0).
  const effort = process.env.MANYHANDS_CODEX_REASONING;
  if (effort) {
    args.push("-c", `model_reasoning_effort=${effort}`);
  }
  return args;
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface CodexCliExecutorDeps {
  /**
   * Codex CLI binary. Defaults to `$MANYHANDS_CODEX_BIN` when set, else `codex`
   * on `$PATH`. On Windows the npm shim is `codex.cmd`, which lives in the npm
   * global prefix and is often absent from a non-interactive shell's PATH —
   * point the env var at the absolute `.cmd` path in that case.
   */
  binaryPath?: string;
  /** Injectable spawn for tests. Defaults to node:child_process spawn. */
  spawn?: SpawnFn;
  /** Injectable instructions reader for tests. Defaults to fs.readFile (utf8). */
  readInstructions?: (filePath: string) => Promise<string>;
  /**
   * Run through a shell. Required on Windows so a `.cmd` shim resolves; defaults
   * to true on win32, false elsewhere. Injectable so unit tests stay
   * platform-independent.
   */
  useShell?: boolean;
}

/**
 * Real CodexExecutor backed by `codex exec` (D4 — the only agent executor).
 * Reads the instruction file written by the orchestrator, spawns the CLI in the
 * worktree piping those instructions to stdin, enforces a hard timeout (D10),
 * and returns a CodexRunOutcome. The orchestrator never trusts stdout to decide
 * what changed (D5); these fields are diagnostics plus the exit signal.
 * Process-level failures (binary missing, spawn error, unreadable instructions)
 * surface as a non-zero exit outcome so the seam stays total and the
 * ResultRecorder maps them to `codex_error`.
 */
export class CodexCliExecutor implements CodexExecutor {
  private readonly binaryPath: string;
  private readonly spawnFn: SpawnFn;
  private readonly readInstructions: (filePath: string) => Promise<string>;
  private readonly useShell: boolean;

  constructor(deps: CodexCliExecutorDeps = {}) {
    this.binaryPath = deps.binaryPath ?? process.env.MANYHANDS_CODEX_BIN ?? "codex";
    this.spawnFn = deps.spawn ?? spawn;
    this.readInstructions = deps.readInstructions ?? ((filePath) => readFile(filePath, "utf8"));
    this.useShell = deps.useShell ?? process.platform === "win32";
  }

  execute(options: CodexCliExecutorOptions): Promise<CodexRunOutcome> {
    const args = buildCodexArgs(options);
    const start = Date.now();

    return new Promise<CodexRunOutcome>((resolve) => {
      const child = this.spawnFn(this.binaryPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        shell: this.useShell
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
        killProcessTree(child, this.spawnFn);
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

      // Listeners are attached synchronously above; only then read the
      // instruction file and feed it over stdin so codex starts working.
      // Guard EPIPE: the child may exit before we finish writing.
      this.readInstructions(options.instructionFilePath).then(
        (prompt) => {
          child.stdin?.on("error", () => undefined);
          child.stdin?.end(prompt);
        },
        (error: Error) => {
          killProcessTree(child, this.spawnFn);
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
}

/**
 * Kills the Codex process and its descendants. On Windows a shelled `.cmd` runs
 * under cmd.exe, so `child.kill` only reaches the shell — `taskkill /T /F`
 * tears down the whole tree. Falls back to SIGKILL when there is no PID (e.g.
 * an injected fake child in tests) or off Windows.
 */
function killProcessTree(child: ChildProcess, spawnFn: SpawnFn): void {
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
