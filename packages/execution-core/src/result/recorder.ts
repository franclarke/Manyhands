import type { ExecutionScope, ExpectedOutput, ScopeContract } from "@manyhands/contracts";
import type { TraceStore } from "@manyhands/trace-store";

import { execError, execLog, execWarn } from "../logging/log";
import { classifyExecutorFailure } from "../executor/failure";
import type { ExecutorRunOutcome } from "../executor/types";
import type { GitRunner } from "../git/runner";
import { GROUNDING_STUB_PATTERN } from "../run/grounding-stub";
import { DEFAULT_ARTIFACT_GLOBS, OVERSIZED_CHANGE_THRESHOLD } from "../scope/artifacts";
import { ScopeChecker } from "../scope/checker";
import {
  AgentExecutionResultSchema,
  type AgentExecutionResult,
  type AgentResultStatus,
  type ScopeCheckResult,
  type ScopePolicy,
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
  scopeContract?: Pick<ScopeContract, "allowedPaths" | "forbiddenPaths"> & {
    outputRoots?: readonly string[] | undefined;
  };
  forbiddenPaths?: string[];
  expectedOutput?: ExpectedOutput;
  scopePolicy?: ScopePolicy;
  unexpectedCommitPolicy?: UnexpectedCommitPolicy;
  commitMessage?: string;
  usageSource?: "reported" | "estimated" | "unavailable";
  /**
   * HEAD the worktree is expected to be at when the agent finished — the
   * baseline for detecting an unexpected agent commit. Defaults to the
   * worktree's baseCommit (correct for a freshly-created worktree). Leaf repair
   * re-enters an existing worktree whose HEAD already sits at the orchestrator's
   * prior commit, so it passes that HEAD here to avoid mistaking the
   * orchestrator's own commit for an agent commit.
   */
  expectedHead?: string;
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
    const baseHead = params.expectedHead ?? worktree.baseCommit;
    const policy: UnexpectedCommitPolicy = params.unexpectedCommitPolicy ?? "reject";

    // When the CLI reported real usage in its structured output, that beats the
    // registry's static declaration — the numbers came from the provider.
    const reportedUsage =
      executorOutcome.tokensIn !== undefined ||
      executorOutcome.tokensTotal !== undefined ||
      executorOutcome.tokensOut !== undefined ||
      executorOutcome.costUsd !== undefined;
    const failureDiagnosis = classifyExecutorFailure(executorOutcome);

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
      ...(failureDiagnosis !== undefined
        ? { failureKind: failureDiagnosis.kind, failureHint: failureDiagnosis.hint }
        : {}),
      tokensIn: executorOutcome.tokensIn,
      tokensTotal: executorOutcome.tokensTotal,
      tokensOut: executorOutcome.tokensOut,
      costUsd: executorOutcome.costUsd,
      usageSource: reportedUsage ? ("reported" as const) : params.usageSource
    };

    const passedScope: ScopeCheckResult = { passed: true, violations: [], outOfScope: [] };

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
      // (No staging filter possible here — the commit is the agent's — so the
      // oversized advisory is the only artifact guard on this branch.)
      const changedFiles = await this.git.diffRangeNameOnly({ cwd: worktree.path, from: baseHead, to: head });
      this.appendOversizedChangeAdvisory(taskId, changedFiles.length);
      const diff = await this.git.diffRange({ cwd: worktree.path, from: baseHead, to: head });
      const scopeCheck = this.scopeChecker.check({
        changedFiles,
        createdFiles: await this.git.diffRangeAddedFiles({ cwd: worktree.path, from: baseHead, to: head }),
        executionScope: params.executionScope,
        scopeContract: params.scopeContract,
        forbiddenPaths: params.forbiddenPaths,
        worktreeRoot: worktree.path
      });
      if (!scopeCheck.passed) {
        this.appendScopeFailure(taskId, scopeCheck.violations);
        execWarn("result", "leaf failed: scope violation (agent-committed range)", {
          task: taskId,
          violations: scopeCheck.violations
        });
        return this.finalize({ ...base, status: "scope_violation", currentHead: head, agentCommittedUnexpectedly: true, diff, changedFiles, scopeCheck });
      }
      this.appendScopeAdvisory(taskId, scopeCheck.outOfScope);
      execLog("result", "leaf succeeded (kept agent commit, policy=accept)", {
        task: taskId,
        commitSha: head,
        changedFiles: changedFiles.length
      });
      return this.finalize({ ...base, status: "success", currentHead: head, agentCommittedUnexpectedly: true, diff, changedFiles, commitSha: head, scopeCheck });
    }

    // 3. Normal path: stage, inspect, scope-check, and (on success) commit.
    // Artifact globs are excluded at staging time: a leaf that ran `npm install`
    // in a repo without .gitignore must not commit node_modules.
    await this.git.addAllExcluding(worktree.path, DEFAULT_ARTIFACT_GLOBS);
    const changedFiles = await this.git.diffCachedNameOnly(worktree.path);
    this.appendOversizedChangeAdvisory(taskId, changedFiles.length);

    if (changedFiles.length === 0) {
      // An empty diff is normally a failure ("execute did nothing"). But it is a
      // legitimate NO-OP when the grounding baseline already fully satisfies the
      // leaf's contract — e.g. a barrel/re-export the scaffolder produced in full,
      // leaving the agent nothing to add. We accept that case as success with no
      // commit (nothing for integration to cherry-pick) only when we can prove it.
      const baselineEvidence = await this.baselineSatisfiesContract(
        worktree.path,
        baseHead,
        params.expectedOutput,
        params.executionScope
      );
      if (baselineEvidence !== undefined) {
        execLog("result", "leaf succeeded (no-op: grounding baseline already satisfies the contract)", {
          task: taskId,
          durationMs: executorOutcome.durationMs
        });
        return this.finalize({ ...base, status: "success", disposition: "already_satisfied", noOp: true, baselineEvidence, currentHead: baseHead, diff: "", changedFiles: [], scopeCheck: passedScope });
      }
      // Exit 0 but nothing changed and the contract is not already satisfied: the
      // agent ran yet produced no diff — surface it with its output tail.
      execWarn("result", "leaf failed: agent produced no changes (empty diff)", {
        task: taskId,
        durationMs: executorOutcome.durationMs,
        stdoutTail: base.stdoutTail ?? base.stderrTail
      });
      return this.finalize({ ...base, status: "empty_diff", currentHead: baseHead, diff: "", changedFiles: [], scopeCheck: passedScope });
    }

    const scopeCheck = this.scopeChecker.check({
      changedFiles,
      createdFiles: await this.git.diffCachedAddedFiles(worktree.path),
      executionScope: params.executionScope,
      scopeContract: params.scopeContract,
      forbiddenPaths: params.forbiddenPaths,
      worktreeRoot: worktree.path
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

    const scopePolicy = params.scopePolicy ?? "strict";
    if (scopeCheck.outOfScope.length > 0 && scopePolicy !== "advisory") {
      this.appendScopePolicyResult(taskId, scopeCheck.outOfScope, scopePolicy);
      return this.finalize({
        ...base,
        status: scopePolicy === "gate" ? "scope_gated" : "scope_violation",
        disposition: scopePolicy === "gate" ? "gated" : "failed",
        currentHead: baseHead,
        diff,
        changedFiles,
        scopeCheck
      });
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

    this.appendScopeAdvisory(taskId, scopeCheck.outOfScope);
    return this.finalize({ ...base, status: "success", currentHead: commitSha, diff, changedFiles, commitSha, scopeCheck });
  }

  /**
   * An empty diff is a legitimate no-op (not a failure) only when the grounding
   * baseline already fully satisfies the leaf's contract: every concrete
   * implementation-path file exists at the baseline and none still carries the
   * unimplemented-stub marker. Conservative by design — no concrete paths, or any
   * lingering stub, keeps the empty diff a failure so a leaf that did no real work
   * is never silently accepted as success.
   */
  private async baselineSatisfiesContract(
    cwd: string,
    ref: string,
    expectedOutput: ExpectedOutput | undefined,
    scope: ExecutionScope | undefined
  ): Promise<{ expectedPaths: string[]; verifiedPaths: string[] } | undefined> {
    const implPaths = (expectedOutput?.changedFiles ?? scope?.implementationPaths ?? [])
      .filter((path) => !path.includes("*"));
    if (implPaths.length === 0) {
      return undefined;
    }
    const verifiedPaths: string[] = [];
    for (const path of implPaths) {
      const content = await this.git.showFile({ cwd, ref, path });
      if (content === null) {
        return undefined;
      }
      if (GROUNDING_STUB_PATTERN.test(content)) {
        return undefined;
      }
      verifiedPaths.push(path);
    }
    return { expectedPaths: implPaths, verifiedPaths };
  }

  private appendScopePolicyResult(taskId: string, outOfScope: string[], policy: ScopePolicy): void {
    this.traceStore.append({
      type: policy === "gate" ? "scope_gate_required" : "scope_check_failed",
      actor: "system",
      taskId,
      payload: { policy, outOfScope }
    });
  }

  /** Likely scope leak signal: huge changed-file counts are logged, never failed. */
  private appendOversizedChangeAdvisory(taskId: string, changedFileCount: number): void {
    if (changedFileCount <= OVERSIZED_CHANGE_THRESHOLD) {
      return;
    }
    execWarn("result", "oversized change: possible scope leak", {
      task: taskId,
      changedFiles: changedFileCount,
      threshold: OVERSIZED_CHANGE_THRESHOLD
    });
    this.traceStore.append({
      type: "scope_advisory",
      actor: "system",
      taskId,
      payload: { reason: "oversized_change", changedFiles: changedFileCount, threshold: OVERSIZED_CHANGE_THRESHOLD }
    });
  }

  private appendScopeFailure(taskId: string, violations: string[]): void {
    this.traceStore.append({
      type: "scope_check_failed",
      actor: "system",
      taskId,
      payload: { violations }
    });
  }

  /**
   * Records files the agent touched outside its (LLM-guessed) allow-list. This is
   * advisory only — the leaf still succeeds and commits. It exists so an
   * out-of-lane change stays visible in the timeline and can feed conflict-risk.
   */
  private appendScopeAdvisory(taskId: string, outOfScope: string[]): void {
    if (outOfScope.length === 0) {
      return;
    }
    this.traceStore.append({
      type: "scope_advisory",
      actor: "system",
      taskId,
      payload: { outOfScope }
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
    noOp?: boolean | undefined;
    disposition?: AgentExecutionResult["disposition"];
    baselineEvidence?: AgentExecutionResult["baselineEvidence"];
    scopeCheck: ScopeCheckResult;
    executorExitCode: number;
    executorDurationMs: number;
    executorTimedOut: boolean;
    stderrTail?: string | undefined;
    stdoutTail?: string | undefined;
    failureKind?: AgentExecutionResult["failureKind"] | undefined;
    failureHint?: string | undefined;
    tokensIn?: number | undefined;
    tokensTotal?: number | undefined;
    tokensOut?: number | undefined;
    costUsd?: number | undefined;
    usageSource?: "reported" | "estimated" | "unavailable" | undefined;
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
      noOp: input.noOp,
      disposition: input.disposition ?? dispositionForStatus(input.status),
      baselineEvidence: input.baselineEvidence,
      scopeCheck: input.scopeCheck,
      executorExitCode: input.executorExitCode,
      executorDurationMs: input.executorDurationMs,
      executorTimedOut: input.executorTimedOut,
      stderrTail: input.stderrTail,
      stdoutTail: input.stdoutTail,
      failureKind: input.failureKind,
      failureHint: input.failureHint,
      tokensIn: input.tokensIn,
      tokensTotal: input.tokensTotal,
      tokensOut: input.tokensOut,
      costUsd: input.costUsd,
      usageSource: input.usageSource
    });
  }
}

function dispositionForStatus(status: AgentResultStatus): NonNullable<AgentExecutionResult["disposition"]> {
  if (status === "success") return "changed";
  if (status === "scope_gated") return "gated";
  return "failed";
}
