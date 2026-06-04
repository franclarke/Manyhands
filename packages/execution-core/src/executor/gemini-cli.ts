import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { execError, execLog, execWarn } from "../logging/log";
import type { AgentExecutorOptions, SandboxMode } from "../types";
import type { AgentExecutor, ExecutorRunOutcome } from "./types";

/** Conventional exit codes used when the process never produced its own. */
const TIMEOUT_EXIT_CODE = 124;
const SPAWN_FAILURE_EXIT_CODE = 127;

/**
 * Short directive passed via `-p`. Gemini CLI enters non-interactive (headless)
 * mode only when `--prompt` has a non-empty value, and that value is *appended*
 * to whatever arrives on stdin. We feed the full leaf/repair instructions over
 * stdin (no arg-length limit) and use this directive as the headless trigger.
 */
const STDIN_DIRECTIVE = "Follow-instructions-on-stdin";

/**
 * Maps the legacy Codex SandboxMode to a Gemini approval mode. Gemini has no
 * `workspace-write`/`danger-full-access` OS sandbox; `yolo` auto-approves every
 * tool call so the agent can edit files and run commands inside the worktree
 * without prompting (which would hang a headless run). Real confinement comes
 * from the isolated git worktree + the ScopeChecker, not from Gemini.
 */
function approvalModeFor(_sandboxMode: SandboxMode): string {
  return "yolo";
}

/**
 * Builds the `gemini` argument vector. Pure and synchronous so it can be
 * unit-tested without spawning a process. The prompt is NOT an argument — it is
 * piped over stdin; `-p` carries only the short headless-trigger directive.
 * Verified against gemini-cli 0.44.1:
 *   --model <m>            model selection
 *   --approval-mode yolo   auto-approve all tool calls (headless autonomy)
 *   --skip-trust           trust this fresh worktree for the session (no prompt)
 *   -o text                stable, parse-free output
 *   -p <directive>         non-empty value required to enter headless mode
 */
export function buildGeminiArgs(options: AgentExecutorOptions): string[] {
  return [
    "--model", options.model,
    "--approval-mode", approvalModeFor(options.sandboxMode),
    "--skip-trust",
    "-o", "text",
    "-p", STDIN_DIRECTIVE
  ];
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface GeminiCliExecutorDeps {
  /**
   * Gemini CLI binary. Defaults to `$MANYHANDS_GEMINI_BIN` when set, else
   * `gemini` on `$PATH`. On Windows the npm shim is `gemini.ps1`/`gemini.cmd`,
   * which lives in the npm global prefix and is often absent from a
   * non-interactive shell's PATH — point the env var at the absolute path then.
   */
  binaryPath?: string;
  /** Injectable spawn for tests. Defaults to node:child_process spawn. */
  spawn?: SpawnFn;
  /** Injectable instructions reader for tests. Defaults to fs.readFile (utf8). */
  readInstructions?: (filePath: string) => Promise<string>;
  /**
   * Run through a shell. Required on Windows so a `.cmd`/`.ps1` shim resolves;
   * defaults to true on win32, false elsewhere. Injectable so unit tests stay
   * platform-independent.
   */
  useShell?: boolean;
}

/**
 * Real AgentExecutor backed by the Gemini CLI (replaces the Codex executor).
 * Reads the instruction file written by the orchestrator, spawns the CLI in the
 * worktree piping those instructions to stdin, enforces a hard timeout (D10),
 * and returns an ExecutorRunOutcome. The orchestrator never trusts stdout to
 * decide what changed (D5); these fields are diagnostics plus the exit signal.
 * Process-level failures (binary missing, spawn error, unreadable instructions)
 * surface as a non-zero exit outcome so the seam stays total and the
 * ResultRecorder maps them to `executor_error` (keeping stderr as the cause).
 */
export class GeminiCliExecutor implements AgentExecutor {
  private readonly binaryPath: string;
  private readonly spawnFn: SpawnFn;
  private readonly readInstructions: (filePath: string) => Promise<string>;
  private readonly useShell: boolean;

  constructor(deps: GeminiCliExecutorDeps = {}) {
    this.binaryPath = deps.binaryPath ?? process.env.MANYHANDS_GEMINI_BIN ?? "gemini";
    this.spawnFn = deps.spawn ?? spawn;
    this.readInstructions = deps.readInstructions ?? ((filePath) => readFile(filePath, "utf8"));
    this.useShell = deps.useShell ?? process.platform === "win32";
  }

  execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome> {
    const args = buildGeminiArgs(options);
    const start = Date.now();
    // The worktree dir is named after the taskId, so its basename correlates
    // every log line back to the leaf/integration task that spawned it.
    const task = basename(options.cwd);

    execLog("gemini", "spawning agent", {
      task,
      binary: this.binaryPath,
      model: options.model,
      approvalMode: approvalModeFor(options.sandboxMode),
      timeoutMs: options.timeoutMs,
      shell: this.useShell,
      cwd: options.cwd
    });

    return new Promise<ExecutorRunOutcome>((resolve) => {
      const child = this.spawnFn(this.binaryPath, args, {
        cwd: options.cwd,
        env: { ...process.env, ...(options.env ?? {}) },
        stdio: ["pipe", "pipe", "pipe"],
        shell: this.useShell
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
        resolve(outcome);
      };

      const timer = setTimeout(() => {
        execWarn("gemini", "agent timed out — killing process tree", {
          task,
          timeoutMs: options.timeoutMs,
          durationMs: Date.now() - start,
          stderrTail: tailText(stderr)
        });
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
        // Most common real failure: binary missing / not on PATH (ENOENT). This
        // is exactly the "executes no funcionan" symptom — surface it loudly.
        execError("gemini", "spawn failed — agent never started", {
          task,
          binary: this.binaryPath,
          code: (error as NodeJS.ErrnoException).code,
          message: error.message,
          hint: "Verifica MANYHANDS_GEMINI_BIN / que `gemini` esté en PATH"
        });
        finish({
          exitCode: SPAWN_FAILURE_EXIT_CODE,
          stdout,
          stderr: stderr + (stderr ? "\n" : "") + error.message,
          timedOut: false,
          durationMs: Date.now() - start
        });
      });

      child.on("close", (code) => {
        const durationMs = Date.now() - start;
        if (settled) {
          return;
        }
        if (code === 0) {
          execLog("gemini", "agent exited cleanly", { task, exitCode: 0, durationMs });
        } else {
          execWarn("gemini", "agent exited non-zero", {
            task,
            exitCode: code ?? SPAWN_FAILURE_EXIT_CODE,
            durationMs,
            stderrTail: tailText(stderr)
          });
        }
        finish({
          exitCode: code ?? SPAWN_FAILURE_EXIT_CODE,
          stdout,
          stderr,
          timedOut: false,
          durationMs
        });
      });

      // Listeners are attached synchronously above; only then read the
      // instruction file and feed it over stdin so gemini starts working.
      // Guard EPIPE: the child may exit before we finish writing.
      this.readInstructions(options.instructionFilePath).then(
        (prompt) => {
          child.stdin?.on("error", () => undefined);
          child.stdin?.end(prompt);
        },
        (error: Error) => {
          execError("gemini", "failed to read instruction file", {
            task,
            path: options.instructionFilePath,
            message: error.message
          });
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

/** Last slice of executor output — the actionable cause to print in a log line. */
function tailText(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const LIMIT = 1_000;
  return trimmed.length > LIMIT ? trimmed.slice(-LIMIT) : trimmed;
}

/**
 * Kills the Gemini process and its descendants. On Windows a shelled `.cmd`/
 * `.ps1` runs under cmd.exe, so `child.kill` only reaches the shell —
 * `taskkill /T /F` tears down the whole tree. Falls back to SIGKILL when there
 * is no PID (e.g. an injected fake child in tests) or off Windows.
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
