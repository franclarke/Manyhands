import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { AgentExecutorOptions, SandboxMode } from "../types";
import type { AgentExecutor, ExecutorRunOutcome } from "./types";
import { spawnExecutorProcess, type SpawnFn } from "./process";

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
 * Delegates the process mechanics to the shared `spawnExecutorProcess` driver
 * (also used by the Claude Code executor): it reads the instruction file written
 * by the orchestrator, spawns the CLI in the worktree piping those instructions
 * to stdin, enforces a hard timeout (D10), and tears down the process tree on
 * timeout or abort. The orchestrator never trusts stdout to decide what changed
 * (D5); these fields are diagnostics plus the exit signal. Process-level failures
 * (binary missing, spawn error, unreadable instructions) surface as a non-zero
 * exit outcome so the seam stays total and the ResultRecorder maps them to
 * `executor_error` (keeping stderr as the cause).
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
    return spawnExecutorProcess({
      binaryPath: this.binaryPath,
      args: buildGeminiArgs(options),
      cwd: options.cwd,
      env: options.env,
      useShell: this.useShell,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      spawnFn: this.spawnFn,
      readInstructions: this.readInstructions,
      instructionFilePath: options.instructionFilePath
    });
  }
}
