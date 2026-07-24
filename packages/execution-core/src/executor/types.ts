import type { AgentExecutorOptions } from "../types";

/**
 * Raw outcome of a single agent-executor (Gemini CLI) invocation. The
 * orchestrator never trusts stdout to determine *what changed* (D5 — git diff is
 * the source of truth); these fields are diagnostics plus the exit signal.
 */
export interface ExecutorRunOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
  /** Diagnostic command line used to spawn the executor. Never used as a source of code changes. */
  commandLine?: string;
  tokensIn?: number;
  tokensOut?: number;
  /**
   * Total tokens, for providers that report only a total. Kept separate from
   * the in/out pair so a total is never mistaken for either half.
   */
  tokensTotal?: number;
  costUsd?: number;
}

/**
 * The single agent-executor seam. Both the deterministic mock and the real
 * Gemini CLI wrapper implement this, so the pipeline depends on the interface
 * and tests can inject a mock.
 */
export interface AgentExecutor {
  execute(options: AgentExecutorOptions): Promise<ExecutorRunOutcome>;
}
