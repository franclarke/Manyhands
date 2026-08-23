import type { AgentExecutorOptions } from "../../types";
import type { ExecutorRunOutcome } from "../types";
import type { CliExecutorProfile } from "../cli-executor";
import { CODEX_EXECUTOR_ID } from "../registry";
import { conservativeCostForTotalTokens } from "../../pricing";

/**
 * Codex CLI headless mode. Approval is global; sandbox and config options are
 * scoped to `exec` so `--ignore-user-config` cannot reset them.
 */
export function buildCodexArgs(options: AgentExecutorOptions): string[] {
  const sandboxMode = options.bypassApprovals ? "danger-full-access" : "workspace-write";
  return [
    "--ask-for-approval",
    "never",
    "exec",
    "--sandbox",
    sandboxMode,
    // Codex 0.148 can ignore the flag when user config is disabled, so keep
    // the legacy config override aligned with the requested sandbox mode.
    "-c",
    `sandbox_mode="${sandboxMode}"`,
    "-c",
    "sandbox_workspace_write.network_access=false",
    // The broker uses an attempt-local CODEX_HOME, so do not rely on a host
    // config file to choose the native Windows enforcement implementation.
    "-c",
    `windows.sandbox="${options.windowsSandbox ?? "elevated"}"`,
    "--cd",
    options.cwd,
    "--add-dir",
    options.cwd,
    "--model",
    options.model,
    "--color",
    "never",
    "--ephemeral",
    "--ignore-user-config",
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
export function parseCodexOutcome(
  outcome: ExecutorRunOutcome,
  model?: string,
  expectedSandbox?: "workspace-write" | "danger-full-access"
): ExecutorRunOutcome {
  // Both streams are searched: which one carries the report is the CLI's
  // choice, and a real run lost its measurement because only stdout was read.
  const total = lastReportedTokenTotal(outcome.stdout) ?? lastReportedTokenTotal(outcome.stderr);
  const failureDiagnosis = codexSandboxFailure(outcome, expectedSandbox);
  if (total === undefined) {
    return failureDiagnosis === undefined ? outcome : { ...outcome, failureDiagnosis };
  }
  const costUsd = outcome.costUsd ?? (model === undefined
    ? undefined
    : conservativeCostForTotalTokens(model, total));
  return {
    ...outcome,
    tokensTotal: total,
    ...(failureDiagnosis === undefined ? {} : { failureDiagnosis }),
    ...(costUsd !== undefined ? { costUsd } : {})
  };
}

function codexSandboxFailure(
  outcome: Pick<ExecutorRunOutcome, "stdout" | "stderr">,
  expectedSandbox: "workspace-write" | "danger-full-access" | undefined
): ExecutorRunOutcome["failureDiagnosis"] {
  if (expectedSandbox === undefined) return undefined;
  const text = `${outcome.stderr}\n${outcome.stdout}`;
  if (
    /sandbox setup required:\s*sandbox users missing or incompatible with marker version/iu.test(text) ||
    /orchestrator_helper_launch_canceled:[^\r\n]*failed to launch setup helper/iu.test(text) ||
    /ERROR codex_core::tools::router:[^\r\n]*windows sandbox failed:[^\r\n]*CreateProcessWithLogonW failed:\s*2147942522/iu.test(text)
  ) {
    return {
      kind: "sandbox_unavailable",
      hint: "Codex could not initialize the selected native Windows sandbox; repair that backend or explicitly select one that has passed the Stage 8 capability gate.",
      retryableOnOtherExecutor: false
    };
  }
  const preamble = codexPreamble(text);
  const actual = /^sandbox:\s*([^\s[]+)/imu.exec(preamble)?.[1]?.toLowerCase();
  if (actual === undefined || actual === expectedSandbox) return undefined;
  return {
    kind: "sandbox_unavailable",
    hint: `Codex started with sandbox ${actual}, but ManyHands required ${expectedSandbox}; unattended execution was blocked.`,
    retryableOnOtherExecutor: false
  };
}

function codexPreamble(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n");
  const start = normalized.indexOf("OpenAI Codex v");
  if (start < 0) return "";
  const userBoundary = normalized.indexOf("\n--------\nuser\n", start);
  return normalized.slice(start, userBoundary < 0 ? normalized.length : userBoundary);
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
  parseOutcome: (outcome, options) => parseCodexOutcome(
    outcome,
    options.model,
    options.bypassApprovals ? "danger-full-access" : "workspace-write"
  )
};
