import type { CodexCliExecutorOptions } from "../types";

/**
 * Raw outcome of a single Codex CLI invocation. The orchestrator never trusts
 * stdout to determine *what changed* (D5 — git diff is the source of truth);
 * these fields are diagnostics plus the exit signal.
 */
export interface CodexRunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
}

/**
 * The single agent-executor seam (D4). Both the deterministic mock and the real
 * `codex exec` wrapper implement this, so the pipeline depends on the interface
 * and tests can inject a mock.
 */
export interface CodexExecutor {
  execute(options: CodexCliExecutorOptions): Promise<CodexRunOutcome>;
}
