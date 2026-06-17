import type { AgentExecutorOptions } from "../../types";
import type { CliExecutorProfile } from "../cli-executor";
import { CODEX_EXECUTOR_ID } from "../registry";

/**
 * Codex CLI headless mode: `codex exec` runs one autonomous turn without a TUI.
 * The trailing `-` makes codex read the full prompt from stdin (same transport
 * as every other executor — no arg-length limits). The worktree is the spawn
 * cwd, and `--skip-git-repo-check` keeps codex from refusing nested worktrees.
 *
 * Sandbox tiers:
 *   default      → `--sandbox workspace-write` (write inside cwd, no escapes)
 *   bypass       → `--dangerously-bypass-approvals-and-sandbox` (the worktree
 *                  is already the isolation boundary — mirrors gemini's yolo)
 */
export function buildCodexArgs(options: AgentExecutorOptions): string[] {
  return [
    "exec",
    "--model",
    options.model,
    ...(options.reasoningEffort ? ["-c", `model_reasoning_effort="${options.reasoningEffort}"`] : []),
    ...(options.bypassApprovals
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["--sandbox", "workspace-write"]),
    "--skip-git-repo-check",
    "-"
  ];
}

export const CODEX_PROFILE: CliExecutorProfile = {
  id: CODEX_EXECUTOR_ID,
  logScope: "codex",
  buildArgs: buildCodexArgs
};
