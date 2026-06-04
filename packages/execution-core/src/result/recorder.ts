import type { ExecutionScope } from "@manyhands/contracts";
import type { TraceStore } from "@manyhands/trace-store";

import { execError, execLog, execWarn } from "../logging/log";
import type { ExecutorRunOutcome } from "../executor/types";
import type { GitRunner } from "../git/runner";
import { ScopeChecker } from "../scope/checker";
import {
  AgentExecutionResultSchema,
  type AgentExecutionResult,
  type AgentResultStatus,
  type ScopeCheckResult,
  type UnexpectedCommitPolicy,
  type WorktreeRecord
} from "../types";

export interface ResultRecorderDeps {
  git: GitRunner;
  traceStore: TraceStore;
  scopeChecker?: ScopeChecker;
}

export interface RecordParams {
  worktree: WorktreeRecord;
  executorOutcome: ExecutorRunOutcome;
  executionScope?: ExecutionScope;
  forbiddenPaths?: string[];
  unexpectedCommitPolicy?: UnexpectedCommitPolicy;
  commitMessage?: string;
}

/** Keep the last N chars of executor output as the actionable failure cause. */
const OUTPUT_TAIL_LIMIT = 4_000;

function tail(text: string | undefined): string | undefined {
  if (text === undefined || text.length === 0) {
    return undefined;
  }
  return text.length > OUTPUT_TAIL_LIMIT ? text.slice(-OUTPUT_TAIL_LIMIT) : text;
}

/**
 * Inspects a worktree after an agent run and produces the authoritative
 * AgentExecutionResult. `git diff` is the only source of truth (D5); the
 * orchestrator — not the agent — performs the commit on success (D6).
 */
export class ResultRecorder {
  private readonly git: GitRunner;
  private readonly traceStore: TraceStore;
  private readonly scopeChecker: ScopeChecker;

  constructor(deps: ResultRecorderDeps) {
    this.git = deps.git;
    this.traceStore = deps.traceStore;
    this.scopeChecker = deps.scopeChecker ?? new ScopeChecker();
  }

  async record(params: RecordParams): Promise<AgentExecutionResult> {
    const { worktree, executorOutcome } = params;
    const taskId = worktree.taskId;
    const baseHead = worktree.baseCommit;
    const policy: UnexpectedCommitPolicy = params.unexpectedCommitPolicy ?? "reject";

    const base = {
      taskId,
      baseHead,
      executorExitCode: executorOutcome.exitCode,
      executorDurationMs: executorOutcome.durationMs,
      executorTimedOut: executorOutcome.timedOut,
      // Always carry the executor's output tails so the UI can show the cause of
      // a failure (e.g. Gemini quota/auth). Harmless on success.
      stderrTail: tail(executorOutcome.stderr),
      stdoutTail: tail(executorOutcome.stdout),
      tokensIn: executorOutcome.tokensIn,
      tokensOut: executorOutcome.tokensOut,
      costUsd: executorOutcome.costUsd
    };

    const passedScope: ScopeCheckResult = { passed: true, violations: [] };

    // 1. Executor-level failures short-circuit before any git inspection. The
    // stderr/stdout tails in `base` preserve the actionable cause.
    if (executorOutcome.timedOut) {
      execWarn("result", "leaf failed: executor timed out", {
        task: taskId,
        durationMs: executorOutcome.durationMs,
        stderrTail: base.stderrTail
      });
      return this.finalize({ ...base, status: "timeout", currentHead: baseHead, diff: "", changedFiles: [], scopeCheck: passedScope });
    }
    if (executorOutcome.exitCode !== 0) {
      execError("result", "leaf failed: executor exited non-zero", {
        task: taskId,
        exitCode: executorOutcome.exitCode,
        durationMs: executorOutcome.durationMs,
        stderrTail: base.stderrTail ?? base.stdoutTail
      });
      return this.finalize({ ...base, status: "executor_error", currentHead: baseHead, diff: "", changedFiles: [], scopeCheck: passedScope });
    }

    // 2. Did the agent commit on its own? (D6 / ADR-0021)
    const head = await this.git.head(worktree.path);
    if (head !== baseHead) {
      this.traceStore.append({
        type: "unexpected_commit_detected",
        actor: "system",
        taskId,
        payload: { commitSha: head, policy }
      });

      if (policy === "reject") {
        execWarn("result", "leaf failed: agent committed unexpectedly (policy=reject)", {
          task: taskId,
          commitSha: head
        });
        return this.finalize({
          ...base,
          status: "agent_committed_unexpectedly",
          currentHead: head,
          agentCommittedUnexpectedly: true,
          diff: "",
          changedFiles: [],
          scopeCheck: passedScope
        });
      }

      // accept: validate the agent's committed range and keep its commit.
      const changedFiles = await this.git.diffRangeNameOnly({ cwd: worktree.path, from: baseHead, to: head });
      const diff = await this.git.diffRange({ cwd: worktree.path, from: baseHead, to: head });
      const scopeCheck = this.scopeChecker.check({
        changedFiles,
        executionScope: params.executionScope,
        forbiddenPaths: params.forbiddenPaths
      });
      if (!scopeCheck.passed) {
        this.appendScopeFailure(taskId, scopeCheck.violations);
        execWarn("result", "leaf failed: scope violation (agent-committed range)", {
          task: taskId,
          violations: scopeCheck.violations
        });
        return this.finalize({ ...base, status: "scope_violation", currentHead: head, agentCommittedUnexpectedly: true, diff, changedFiles, scopeCheck });
      }
      execLog("result", "leaf succeeded (kept agent commit, policy=accept)", {
        task: taskId,
        commitSha: head,
        changedFiles: changedFiles.length
      });
      return this.finalize({ ...base, status: "success", currentHead: head, agentCommittedUnexpectedly: true, diff, changedFiles, commitSha: head, scopeCheck });
    }

    // 3. Normal path: stage, inspect, scope-check, and (on success) commit.
    await this.git.addAll(worktree.path);
    const changedFiles = await this.git.diffCachedNameOnly(worktree.path);

    if (changedFiles.length === 0) {
      // Exit 0 but nothing changed: the agent ran yet produced no diff — a very
      // common "execute did nothing" case worth surfacing with its output tail.
      execWarn("result", "leaf failed: agent produced no changes (empty diff)", {
        task: taskId,
        durationMs: executorOutcome.durationMs,
        stdoutTail: base.stdoutTail ?? base.stderrTail
      });
      return this.finalize({ ...base, status: "empty_diff", currentHead: baseHead, diff: "", changedFiles: [], scopeCheck: passedScope });
    }

    const scopeCheck = this.scopeChecker.check({
      changedFiles,
      executionScope: params.executionScope,
      forbiddenPaths: params.forbiddenPaths
    });
    const diff = await this.git.diffCached(worktree.path);

    if (!scopeCheck.passed) {
      this.appendScopeFailure(taskId, scopeCheck.violations);
      execWarn("result", "leaf failed: scope violation", {
        task: taskId,
        changedFiles: changedFiles.length,
        violations: scopeCheck.violations
      });
      return this.finalize({ ...base, status: "scope_violation", currentHead: baseHead, diff, changedFiles, scopeCheck });
    }

    const commitSha = await this.git.commit({
      cwd: worktree.path,
      message: params.commitMessage ?? `mh: ${taskId}`
    });
    this.traceStore.append({
      type: "agent_committed",
      actor: "system",
      taskId,
      payload: { commitSha, changedFiles }
    });
    execLog("result", "leaf succeeded (orchestrator committed)", {
      task: taskId,
      commitSha,
      changedFiles: changedFiles.length,
      durationMs: executorOutcome.durationMs
    });

    return this.finalize({ ...base, status: "success", currentHead: commitSha, diff, changedFiles, commitSha, scopeCheck });
  }

  private appendScopeFailure(taskId: string, violations: string[]): void {
    this.traceStore.append({
      type: "scope_check_failed",
      actor: "system",
      taskId,
      payload: { violations }
    });
  }

  private finalize(input: {
    taskId: string;
    status: AgentResultStatus;
    baseHead: string;
    currentHead: string;
    agentCommittedUnexpectedly?: boolean | undefined;
    diff: string;
    changedFiles: string[];
    commitSha?: string | undefined;
    scopeCheck: ScopeCheckResult;
    executorExitCode: number;
    executorDurationMs: number;
    executorTimedOut: boolean;
    stderrTail?: string | undefined;
    stdoutTail?: string | undefined;
    tokensIn?: number | undefined;
    tokensOut?: number | undefined;
    costUsd?: number | undefined;
  }): AgentExecutionResult {
    return AgentExecutionResultSchema.parse({
      taskId: input.taskId,
      status: input.status,
      baseHead: input.baseHead,
      currentHead: input.currentHead,
      agentCommittedUnexpectedly: input.agentCommittedUnexpectedly ?? false,
      diff: input.diff,
      changedFiles: input.changedFiles,
      commitSha: input.commitSha,
      scopeCheck: input.scopeCheck,
      executorExitCode: input.executorExitCode,
      executorDurationMs: input.executorDurationMs,
      executorTimedOut: input.executorTimedOut,
      stderrTail: input.stderrTail,
      stdoutTail: input.stdoutTail,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      costUsd: input.costUsd
    });
  }
}
