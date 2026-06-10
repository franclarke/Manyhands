import type { AgentExecutorOptions } from "../../types";
import type { CliExecutorProfile } from "../cli-executor";
import { GEMINI_EXECUTOR_ID } from "../registry";
import type { ExecutorRunOutcome } from "../types";

/**
 * Short directive passed via `-p`. Gemini CLI enters non-interactive (headless)
 * mode only when `--prompt` has a non-empty value, and that value is *appended*
 * to whatever arrives on stdin. We feed the full leaf/repair instructions over
 * stdin (no arg-length limit) and use this directive as the headless trigger.
 */
const STDIN_DIRECTIVE = "Follow-instructions-on-stdin";

/**
 * Builds the `gemini` argument vector. Pure and synchronous so it can be
 * unit-tested without spawning a process. Verified against gemini-cli 0.44.1:
 *   --model <m>            model selection
 *   --approval-mode yolo   auto-approve all tool calls (headless autonomy)
 *   --skip-trust           trust this fresh worktree for the session (no prompt)
 *   -o json                structured output: response text + token stats
 *   -p <directive>         non-empty value required to enter headless mode
 */
export function buildGeminiArgs(options: AgentExecutorOptions): string[] {
  return [
    "--model", options.model,
    "--approval-mode", "yolo",
    "--skip-trust",
    "-o", "json",
    "-p", STDIN_DIRECTIVE
  ];
}

interface GeminiJsonEnvelope {
  response?: unknown;
  stats?: { models?: Record<string, { tokens?: { prompt?: unknown; candidates?: unknown } }> };
  error?: { message?: unknown };
}

function tryParseEnvelope(stdout: string): GeminiJsonEnvelope | undefined {
  const trimmed = stdout.trim();
  const candidates = [trimmed];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first > 0 && last > first) {
    // Tolerate log noise around the JSON envelope.
    candidates.push(trimmed.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    if (!candidate.startsWith("{")) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as GeminiJsonEnvelope;
      }
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

/**
 * Best-effort parse of gemini's `-o json` envelope: extracts the human response
 * text and the reported token usage (summed across the models the CLI used).
 * Total by design — anything unexpected passes through untouched so an older
 * CLI emitting plain text keeps working.
 */
export function parseGeminiOutcome(outcome: ExecutorRunOutcome): ExecutorRunOutcome {
  const envelope = tryParseEnvelope(outcome.stdout);
  if (envelope === undefined) {
    return outcome;
  }

  const parsed: ExecutorRunOutcome = { ...outcome };

  if (typeof envelope.response === "string") {
    parsed.stdout = envelope.response;
  }

  const errorMessage = envelope.error?.message;
  if (typeof errorMessage === "string" && errorMessage.length > 0) {
    parsed.stderr = `${outcome.stderr}${outcome.stderr ? "\n" : ""}${errorMessage}`;
  }

  const models = envelope.stats?.models;
  if (models !== undefined) {
    let tokensIn = 0;
    let tokensOut = 0;
    let reported = false;
    for (const model of Object.values(models)) {
      const prompt = model?.tokens?.prompt;
      const candidates = model?.tokens?.candidates;
      if (typeof prompt === "number" && Number.isFinite(prompt)) {
        tokensIn += prompt;
        reported = true;
      }
      if (typeof candidates === "number" && Number.isFinite(candidates)) {
        tokensOut += candidates;
        reported = true;
      }
    }
    if (reported) {
      parsed.tokensIn = tokensIn;
      parsed.tokensOut = tokensOut;
    }
  }

  return parsed;
}

export const GEMINI_PROFILE: CliExecutorProfile = {
  id: GEMINI_EXECUTOR_ID,
  logScope: "gemini",
  buildArgs: buildGeminiArgs,
  parseOutcome: parseGeminiOutcome
};
