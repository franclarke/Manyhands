import type { AgentExecutorOptions } from "../../types";
import type { ExecutorRunOutcome } from "../types";
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

/**
 * Codex prints its consumption on stdout as a `tokens used` report. Nothing
 * read it, so every attempt was journaled as usage-unavailable while the number
 * sat in the output — and RQ2, the cost side of the granularity trade-off, had
 * no data at all.
 *
 * A total, not a split: the CLI reports one figure, and inventing an in/out
 * division from it would be fabrication. Total in the other sense too — a
 * missing or malformed report leaves the outcome untouched, because a
 * fabricated zero and a measured zero must stay distinguishable.
 */
export function parseCodexOutcome(outcome: ExecutorRunOutcome): ExecutorRunOutcome {
  const total = lastReportedTokenTotal(outcome.stdout);
  return total === undefined ? outcome : { ...outcome, tokensTotal: total };
}

/** The CLI prints a running total; the last report is the run's consumption. */
function lastReportedTokenTotal(stdout: string | undefined): number | undefined {
  if (stdout === undefined || stdout.length === 0) return undefined;
  let total: number | undefined;
  // Either `tokens used: 2048`, or `tokens used` with the figure on the next line.
  const pattern = /tokens used:?[ \t]*(?:\r?\n[ \t]*)?(\d[\d,._]*)/giu;
  for (const match of stdout.matchAll(pattern)) {
    const value = Number.parseInt((match[1] ?? "").replace(/[,._]/gu, ""), 10);
    if (Number.isFinite(value)) total = value;
  }
  return total;
}

export const CODEX_PROFILE: CliExecutorProfile = {
  id: CODEX_EXECUTOR_ID,
  logScope: "codex",
  buildArgs: buildCodexArgs,
  parseOutcome: parseCodexOutcome
};
