import type { AgentExecutorOptions } from "../../types";
import type { CliExecutorProfile } from "../cli-executor";
import { CODEX_EXECUTOR_ID } from "../registry";

/**
 * Codex CLI headless mode. Global permission flags must appear before `exec`;
 * the trailing `-` makes Codex read the full prompt from stdin.
 */
export function buildCodexArgs(options: AgentExecutorOptions): string[] {
  return [
    "--sandbox",
    options.bypassApprovals ? "danger-full-access" : "workspace-write",
    "--ask-for-approval",
    "never",
    "exec",
    "--model",
    options.model,
    "--color",
    "never",
    "--ephemeral",
    ...(options.reasoningEffort ? ["-c", `model_reasoning_effort="${options.reasoningEffort}"`] : []),
    "--skip-git-repo-check",
    "-"
  ];
}

export const CODEX_PROFILE: CliExecutorProfile = {
  id: CODEX_EXECUTOR_ID,
  logScope: "codex",
  buildArgs: buildCodexArgs
};
