import type { AgentExecutorOptions } from "../../types";
import type { CliExecutorProfile } from "../cli-executor";
import { CLAUDE_CODE_EXECUTOR_ID } from "../registry";
import type { ExecutorRunOutcome } from "../types";

const STDIN_DIRECTIVE = "Follow the instructions provided on stdin.";

function permissionArgsFor(bypassApprovals: boolean): string[] {
  if (bypassApprovals) {
    return ["--dangerously-skip-permissions"];
  }
  return ["--permission-mode", "acceptEdits"];
}

/**
 * Claude Code print mode (`-p`) with `--output-format json`: one JSON result
 * envelope on stdout carrying the response text plus reported usage and cost.
 */
export function buildClaudeCodeArgs(options: AgentExecutorOptions): string[] {
  return [
    "-p",
    STDIN_DIRECTIVE,
    "--model",
    options.model,
    "--output-format",
    "json",
    ...permissionArgsFor(options.bypassApprovals)
  ];
}

interface ClaudeResultEnvelope {
  type?: unknown;
  is_error?: unknown;
  result?: unknown;
  total_cost_usd?: unknown;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cache_creation_input_tokens?: unknown;
    cache_read_input_tokens?: unknown;
  };
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Best-effort parse of the Claude Code result envelope. Extracts the response
 * text, reported token usage (`usageSource: "reported"` downstream) and the
 * exact cost. Total by design — non-JSON output passes through untouched.
 */
export function parseClaudeCodeOutcome(outcome: ExecutorRunOutcome): ExecutorRunOutcome {
  const trimmed = outcome.stdout.trim();
  if (!trimmed.startsWith("{")) {
    return outcome;
  }
  let envelope: ClaudeResultEnvelope;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null) {
      return outcome;
    }
    envelope = parsed as ClaudeResultEnvelope;
  } catch {
    return outcome;
  }
  if (envelope.type !== "result") {
    return outcome;
  }

  const parsedOutcome: ExecutorRunOutcome = { ...outcome };

  if (typeof envelope.result === "string") {
    parsedOutcome.stdout = envelope.result;
    if (envelope.is_error === true) {
      parsedOutcome.stderr = `${outcome.stderr}${outcome.stderr ? "\n" : ""}${envelope.result}`;
    }
  }

  const inputTokens = asFiniteNumber(envelope.usage?.input_tokens);
  const cacheCreation = asFiniteNumber(envelope.usage?.cache_creation_input_tokens) ?? 0;
  const cacheRead = asFiniteNumber(envelope.usage?.cache_read_input_tokens) ?? 0;
  if (inputTokens !== undefined) {
    parsedOutcome.tokensIn = inputTokens + cacheCreation + cacheRead;
  }
  const outputTokens = asFiniteNumber(envelope.usage?.output_tokens);
  if (outputTokens !== undefined) {
    parsedOutcome.tokensOut = outputTokens;
  }
  const cost = asFiniteNumber(envelope.total_cost_usd);
  if (cost !== undefined) {
    parsedOutcome.costUsd = cost;
  }

  return parsedOutcome;
}

export const CLAUDE_CODE_PROFILE: CliExecutorProfile = {
  id: CLAUDE_CODE_EXECUTOR_ID,
  logScope: "claude",
  buildArgs: buildClaudeCodeArgs,
  parseOutcome: parseClaudeCodeOutcome
};
