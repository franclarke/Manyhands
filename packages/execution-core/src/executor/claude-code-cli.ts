import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

import type { AgentExecutorOptions } from "../types";
import type { AgentExecutor, ExecutorRunOutcome } from "./types";
import { spawnExecutorProcess, type SpawnFn } from "./process";

const STDIN_DIRECTIVE = "Follow the instructions provided on stdin.";

function permissionArgsFor(bypassApprovals: boolean): string[] {
  if (bypassApprovals) {
    return ["--dangerously-skip-permissions"];
  }
  return ["--permission-mode", "acceptEdits"];
}

export function buildClaudeCodeArgs(options: AgentExecutorOptions): string[] {
  return [
    "-p",
    STDIN_DIRECTIVE,
    "--model",
    options.model,
    "--output-format",
    "text",
    ...permissionArgsFor(options.bypassApprovals)
  ];
}

export interface ClaudeCodeCliExecutorDeps {
  binaryPath?: string;
  spawn?: SpawnFn;
  readInstructions?: (filePath: string) => Promise<string>;
  useShell?: boolean;
}

/**
 * AgentExecutor backed by Claude Code CLI print mode. Like Gemini, it receives
 * the full task prompt over stdin and leaves change detection to git diff HEAD.
 */
export class ClaudeCodeCliExecutor implements AgentExecutor {
  private readonly binaryPath: string;
  private readonly spawnFn: SpawnFn;
  private readonly readInstructions: (filePath: string) => Promise<string>;
  private readonly useShell: boolean;

  constructor(deps: ClaudeCodeCliExecutorDeps = {}) {
    this.binaryPath = deps.binaryPath ?? process.env.MANYHANDS_CLAUDE_BIN ?? "claude";
    this.spawnFn = deps.spawn ?? spawn;
    this.readInstructions = deps.readInstructions ?? ((filePath) => readFile(filePath, "utf8"));
    this.useShell = deps.useShell ?? process.platform === "win32";
  }

  execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome> {
    return spawnExecutorProcess({
      binaryPath: this.binaryPath,
      args: buildClaudeCodeArgs(options),
      cwd: options.cwd,
      env: options.env,
      useShell: this.useShell,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      spawnFn: this.spawnFn,
      readInstructions: this.readInstructions,
      instructionFilePath: options.instructionFilePath,
      logScope: "claude",
      onOutput: options.onOutput
    });
  }
}
