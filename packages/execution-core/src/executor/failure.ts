import { ABORTED_EXIT_CODE, SPAWN_FAILURE_EXIT_CODE } from "./process";
import type { ExecutorRunOutcome } from "./types";

/**
 * Provider-agnostic classification of why an agent CLI invocation failed.
 * The orchestrator uses this to pick the right automatic reaction (retry on a
 * different executor for quota, surface an actionable hint for auth/binary
 * problems) instead of treating every non-zero exit as an opaque failure.
 */
export type ExecutorFailureKind =
  | "timeout"
  | "aborted"
  | "binary_missing"
  | "auth"
  | "quota"
  | "model_not_found"
  | "unknown";

export interface ExecutorFailureDiagnosis {
  kind: ExecutorFailureKind;
  /** Actionable, human-readable hint surfaced in traces and the UI. */
  hint: string;
  /**
   * Whether retrying the same instructions on a DIFFERENT executor/model could
   * plausibly succeed (true for quota/timeouts, false for auth/binary issues
   * that would also need operator action).
   */
  retryableOnOtherExecutor: boolean;
}

const AUTH_PATTERN = /(401|403|unauthor|forbidden|invalid api key|api key not|authentication|not logged in|please (run|use).*(login|auth)|credit balance)/i;
const QUOTA_PATTERN = /(429|quota|rate.?limit|resource_exhausted|too many requests|overloaded|capacity)/i;
const MODEL_PATTERN = /(model\s+\S+\s+(not|isn't|is not)\s+(found|supported|available)|unknown model|invalid model|model not found|no such model)/i;
const BINARY_PATTERN = /(enoent|not recognized as an internal or external command|command not found|no se reconoce)/i;

/**
 * Classify a failed executor outcome. Returns undefined for clean exits so the
 * caller can write `const failure = classifyExecutorFailure(outcome)` and only
 * branch when something actually went wrong.
 */
export function classifyExecutorFailure(
  outcome: Pick<ExecutorRunOutcome, "exitCode" | "stdout" | "stderr" | "timedOut">
): ExecutorFailureDiagnosis | undefined {
  if (outcome.exitCode === 0) {
    return undefined;
  }
  if (outcome.timedOut) {
    return {
      kind: "timeout",
      hint: "The agent hit the hard timeout. Consider a longer per-task timeout or a faster executor for this node.",
      retryableOnOtherExecutor: true
    };
  }
  if (outcome.exitCode === ABORTED_EXIT_CODE) {
    return {
      kind: "aborted",
      hint: "The orchestrator aborted this agent (run cancellation or budget cut).",
      retryableOnOtherExecutor: false
    };
  }

  const text = `${outcome.stderr}\n${outcome.stdout}`;
  if (outcome.exitCode === SPAWN_FAILURE_EXIT_CODE || BINARY_PATTERN.test(text)) {
    return {
      kind: "binary_missing",
      hint: "The executor binary never started. Check it is installed and on PATH, or point the executor's *_BIN env var at the absolute path.",
      retryableOnOtherExecutor: true
    };
  }
  if (AUTH_PATTERN.test(text)) {
    return {
      kind: "auth",
      hint: "The executor rejected the credentials (login expired, missing API key, or empty balance). Re-authenticate that CLI and retry.",
      retryableOnOtherExecutor: true
    };
  }
  if (QUOTA_PATTERN.test(text)) {
    return {
      kind: "quota",
      hint: "The provider throttled or exhausted the quota. Retrying on a different executor/model is the fastest unblock.",
      retryableOnOtherExecutor: true
    };
  }
  if (MODEL_PATTERN.test(text)) {
    return {
      kind: "model_not_found",
      hint: "The selected model id is not available on this CLI. Check the executor registry's model list against the installed CLI version.",
      retryableOnOtherExecutor: true
    };
  }
  return {
    kind: "unknown",
    hint: "The agent exited non-zero without a recognizable cause; inspect the stderr tail in the trace.",
    retryableOnOtherExecutor: true
  };
}
