import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionScope, ExecutionValidationCommand, InterfaceContract } from "@manyhands/contracts";
import type { TraceStore } from "@manyhands/trace-store";

import { FixedAgentExecutorFactory, type AgentExecutorFactory } from "../executor/factory";
import {
  resolveLegacyModelSelection,
  usageSourceForSelection,
  type ExecutorSelection
} from "../executor/registry";
import type { AgentExecutor } from "../executor/types";
import type { GitRunner } from "../git/runner";
import { execError, execLog, execWarn } from "../logging/log";
import { DEFAULT_ARTIFACT_GLOBS } from "../scope/artifacts";
import { ScopeChecker } from "../scope/checker";

import {
  AgentExecutionResultSchema,
  IntegrationResultSchema,
  type AppliedChildCommit,
  type AgentExecutionResult,
  type IntegrationFailureCode,
  type IntegrationResult,
  type IntegrationStatus,
  type IntegrationRepairAttempt,
  type OmittedChildCommit,
  type PreMergeFinding,
  type ValidationRunResult,
  type WorktreeRecord
} from "../types";
import { computePreMergeFindings } from "./pre-merge";
import { checkRepairedFiles, describeSyntaxFindings, type SyntaxCheckResult } from "./syntax-check";
import { classifyDeferredValidation } from "../validation/deferred";
import type { ValidationRunner } from "../validation/runner";
import { ChildProcessValidationRunner } from "../validation/runner";
import { ChildProcessDependencyInstaller, type DependencyInstaller } from "../validation/dependencies";

export interface IntegrationAgentDeps {
  git: GitRunner;
  executor?: AgentExecutor;
  executorFactory?: AgentExecutorFactory;
  traceStore: TraceStore;
  repoRoot: string;
  validationRunner?: ValidationRunner;
  dependencyInstaller?: DependencyInstaller;
  scopeChecker?: ScopeChecker;
  /** Writes the repair instructions file. Injectable for tests. */
  writeInstructions?: (path: string, content: string) => Promise<void>;
  /** Post-repair syntactic validation. Injectable for tests. */
  checkSyntax?: (params: { worktreePath: string; files: readonly string[] }) => Promise<SyntaxCheckResult>;
  now?: () => string;
}

export interface IntegrationRepairConfig {
  selection?: ExecutorSelection;
  model?: string;
  timeoutMs: number;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  bypassApprovals?: boolean;
  maxRepairsPerIntegration?: number;
}

const DEFAULT_MAX_REPAIRS_PER_INTEGRATION = 4;

/** What a child task set out to do — feeds the Composer's semantic repair. */
export interface ChildIntent {
  taskId: string;
  goal: string;
  consumes: string[];
  produces: string[];
}

/**
 * A conflict predicted at planning time (conflict-risk). Threaded into the
 * Composer so a cherry-pick conflict is repaired WITH the foresight that
 * produced it — the colliding files were flagged, and why — instead of blind.
 */
export interface PredictedConflictHint {
  taskAId: string;
  taskBId: string;
  level: "low" | "medium" | "high" | "blocking";
  sharedFiles: string[];
  sharedSymbols: string[];
  explanation: string;
}

export interface IntegrationParams {
  compositeTaskId: string;
  /** Integration worktree on the parent branch; children are cherry-picked here. */
  worktree: WorktreeRecord;
  /** Successful children's results, in topological dependency order. */
  childResults: AgentExecutionResult[];
  repair: IntegrationRepairConfig;
  parentValidationCommands?: ExecutionValidationCommand[];
  executionScope?: ExecutionScope;
  forbiddenPaths?: string[];
  // ── Contract-aware composition ──
  /** The composite's goal — what the integrated children must collectively achieve. */
  parentGoal?: string;
  /** Canonical seams defined when this composite was decomposed (source of truth for repair). */
  sharedInterfaces?: InterfaceContract[];
  /** Per-child intent, keyed by taskId, so repair knows WHY each change exists. */
  childIntents?: ChildIntent[];
  /** Run-level cancellation: aborts the repair executor's process tree. */
  signal?: AbortSignal;
  /** Conflicts predicted at planning time; repair surfaces the ones whose files collide. */
  predictedConflicts?: PredictedConflictHint[];
}

/**
 * Integrates completed children into the parent branch via cherry-pick, with a
 * bounded agent repair budget for conflicts (D8 / ADR-0025). git diff stays the
 * source of truth (D5) and the orchestrator — never the agent — commits (D6).
 */
export class IntegrationAgent {
  private readonly git: GitRunner;
  private readonly executorFactory: AgentExecutorFactory;
  private readonly traceStore: TraceStore;
  private readonly repoRoot: string;
  private readonly validationRunner: ValidationRunner;
  private readonly dependencyInstaller: DependencyInstaller;
  private readonly scopeChecker: ScopeChecker;
  private readonly writeInstructions: (path: string, content: string) => Promise<void>;
  private readonly checkSyntax: (params: {
    worktreePath: string;
    files: readonly string[];
  }) => Promise<SyntaxCheckResult>;

  constructor(deps: IntegrationAgentDeps) {
    this.git = deps.git;
    this.executorFactory =
      deps.executorFactory ?? new FixedAgentExecutorFactory(requireExecutor(deps.executor));
    this.traceStore = deps.traceStore;
    this.repoRoot = deps.repoRoot;
    this.validationRunner = deps.validationRunner ?? new ChildProcessValidationRunner();
    this.dependencyInstaller = deps.dependencyInstaller ?? new ChildProcessDependencyInstaller();
    this.scopeChecker = deps.scopeChecker ?? new ScopeChecker();
    this.writeInstructions = deps.writeInstructions ?? ((path, content) => writeFile(path, content, "utf8"));
    this.checkSyntax = deps.checkSyntax ?? checkRepairedFiles;
  }

  async integrate(params: IntegrationParams): Promise<IntegrationResult> {
    const { compositeTaskId, worktree, childResults } = params;
    const childTaskIds = childResults.map((child) => child.taskId);
    execLog("integrate", "integration started", {
      task: compositeTaskId,
      children: childTaskIds,
      worktree: worktree.path
    });

    this.traceStore.append({
      type: "integration_started",
      actor: "system",
      taskId: compositeTaskId,
      payload: { childTaskIds }
    });

    const appliedCommits: AppliedChildCommit[] = [];
    const omittedChildCommits: OmittedChildCommit[] = [];
    const repairAttempts: IntegrationRepairAttempt[] = [];

    // Any non-successful child means we never start integration (ADR-0025).
    const failedChild = childResults.find((child) => child.status !== "success");
    if (failedChild) {
      execWarn("integrate", "skipping integration: a child task failed", {
        task: compositeTaskId,
        failedChild: failedChild.taskId,
        childStatus: failedChild.status
      });
      omittedChildCommits.push(
        ...childResults
          .filter((child) => child.status !== "success")
          .map((child) => ({
            childTaskId: child.taskId,
            reason: "child_failed" as const,
            status: child.status,
            ...(child.commitSha !== undefined ? { commitSha: child.commitSha } : {})
          }))
      );
      return this.finalize(params, "child_failed", {
        repairAttempted: false,
        failureCode: "child_failed",
        omittedChildCommits
      });
    }

    // A no-op child (empty diff because grounding already satisfied its contract)
    // legitimately has no commit — its deliverable is already in the integration
    // base, so it is excluded from the missing-commit guard and cherry-pick below.
    const missingCommitChild = childResults.find(
      (child) => child.noOp !== true && child.commitSha === undefined
    );
    if (missingCommitChild) {
      execWarn("integrate", "skipping integration: successful child has no commit", {
        task: compositeTaskId,
        child: missingCommitChild.taskId,
        childStatus: missingCommitChild.status
      });
      omittedChildCommits.push({
        childTaskId: missingCommitChild.taskId,
        reason: "missing_child_commit",
        status: missingCommitChild.status
      });
      return this.finalize(params, "child_failed", {
        repairAttempted: false,
        failureCode: "missing_child_commit",
        omittedChildCommits,
        preMergeFindings: [
          {
            severity: "warning",
            code: "missing_child_commit",
            message: `Child ${missingCommitChild.taskId} reported success without a commitSha.`,
            files: []
          }
        ]
      });
    }

    // Pre-merge compatibility check (Fase 3.1): a deterministic diagnosis that
    // travels into the repair prompt and onto the result, computed before we
    // spend repair executor time.
    const preMergeFindings = computePreMergeFindings({
      childResults,
      ...(params.childIntents !== undefined ? { childIntents: params.childIntents } : {})
    });
    const childCommitIssue = await this.validateChildCommits(params);
    if (childCommitIssue !== undefined) {
      omittedChildCommits.push({
        childTaskId: childCommitIssue.child.taskId,
        reason: "invalid_child_commit",
        status: childCommitIssue.child.status,
        ...(childCommitIssue.child.commitSha !== undefined ? { commitSha: childCommitIssue.child.commitSha } : {})
      });
      return this.finalize(params, "child_failed", {
        repairAttempted: false,
        failureCode: "invalid_child_commit",
        omittedChildCommits,
        preMergeFindings: [
          ...preMergeFindings,
          {
            severity: "warning",
            code: childCommitIssue.code,
            message: childCommitIssue.message,
            files: []
          }
        ]
      });
    }

    const maxRepairs = normalizeMaxRepairsPerIntegration(params.repair.maxRepairsPerIntegration);
    let repairsUsed = 0;
    let anyRepairSucceeded = false;
    let repairResult: AgentExecutionResult | undefined;

    for (const [childIndex, child] of childResults.entries()) {
      if (child.noOp === true) {
        // No-op leaf: its deliverable is already part of the integration base
        // (grounding produced it in full), so there is nothing to cherry-pick.
        continue;
      }
      const commitSha = child.commitSha;
      if (commitSha === undefined) {
        throw new Error(`Invariant violation: successful child ${child.taskId} has no commitSha after validation.`);
      }

      execLog("integrate", "cherry-pick start", {
        task: compositeTaskId,
        child: child.taskId,
        commit: commitSha
      });
      this.traceStore.append({
        type: "cherry_pick_attempted",
        actor: "system",
        taskId: compositeTaskId,
        payload: { childTaskId: child.taskId, commitSha }
      });

      const outcome = await this.git.cherryPick({
        cwd: worktree.path,
        commitSha
      });
      if (outcome.ok) {
        execLog("integrate", "cherry-pick ok", { task: compositeTaskId, child: child.taskId });
        appliedCommits.push({ childTaskId: child.taskId, commitSha, order: appliedCommits.length });
        continue;
      }

      // Conflict: repair this child if the integration still has budget.
      execWarn("integrate", "cherry-pick conflict", {
        task: compositeTaskId,
        child: child.taskId,
        files: outcome.conflictFiles,
        output: outcome.output
      });
      this.traceStore.append({
        type: "cherry_pick_conflict",
        actor: "system",
        taskId: compositeTaskId,
        payload: { childTaskId: child.taskId, files: outcome.conflictFiles, output: outcome.output }
      });

      if (repairsUsed >= maxRepairs) {
        execWarn("integrate", "integration failed: repair budget exhausted", {
          task: compositeTaskId,
          child: child.taskId,
          files: outcome.conflictFiles,
          repairsUsed,
          maxRepairs
        });
        // Reaching here means an earlier conflict was already repaired
        // successfully, so HEAD points at a real partial-integration commit
        // (prior clean cherry-picks + the repair). Abort the conflicting
        // cherry-pick to clean the worktree and preserve that commit — mirrors
        // validation_failed: an operator who accepts at the conflict gate must
        // hand the parent something to cherry-pick, otherwise the parent
        // integration crashes with "Missing: <child>".
        await this.git.cherryPickAbort(worktree.path);
        const partialCommitSha = await this.git.head(worktree.path);
        omittedChildCommits.push(...omittedFrom(childResults, childIndex, "cherry_pick_conflict"));
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: repairsUsed > 0,
          repairResult,
          integrationCommitSha: partialCommitSha,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          failureCode: "cherry_pick_conflict",
          preMergeFindings,
          appliedCommits,
          omittedChildCommits,
          repairAttempts
        });
      }
      repairsUsed += 1;

      execLog("integrate", "attempting agent repair of conflict", {
        task: compositeTaskId,
        child: child.taskId,
        model: params.repair.model,
        repairsUsed,
        maxRepairs
      });
      const repair = await this.attemptRepair(params, child, outcome, preMergeFindings, repairAttempts);
      repairResult = repair.result;
      if (!repair.ok) {
        execError("integrate", "integration failed: agent repair did not resolve conflict", {
          task: compositeTaskId,
          child: child.taskId,
          repairStatus: repair.result.status,
          exitCode: repair.result.executorExitCode,
          timedOut: repair.result.executorTimedOut,
          stderrTail: repair.result.stderrTail
        });
        const partialCommitSha = await this.git.head(worktree.path);
        omittedChildCommits.push(...omittedFrom(childResults, childIndex, "repair_failed"));
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          integrationCommitSha: partialCommitSha,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          failureCode: "repair_failed",
          preMergeFindings,
          appliedCommits,
          omittedChildCommits,
          repairAttempts
        });
      }
      if (repair.result.commitSha !== undefined) {
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha: repair.result.commitSha,
          order: appliedCommits.length
        });
      }
      execLog("integrate", "agent repair resolved conflict", {
        task: compositeTaskId,
        child: child.taskId
      });
      anyRepairSucceeded = true;
    }

    // Parent validation runs once over the fully-integrated branch.
    const validation = await this.runParentValidation(params);
    if (validation && !validation.passed) {
      execWarn("integrate", "integration failed: parent validation failed", {
        task: compositeTaskId,
        exitCode: validation.exitCode,
        output: validation.output
      });
      // The cherry-picks already committed the fully-merged tree onto the
      // integration branch; validation failing does not unwind those commits.
      // Preserve the commit so an operator who accepts the failure at the
      // conflict gate hands the parent composite something to cherry-pick
      // (otherwise the parent integration crashes with "Missing: <child>").
      const validationFailedCommitSha = await this.git.head(worktree.path);
      return this.finalize(params, "validation_failed", {
        repairAttempted: repairsUsed > 0,
        repairResult,
        integrationCommitSha: validationFailedCommitSha,
        failureCode: "validation_failed",
        appliedCommits,
        preMergeFindings,
        parentValidation: validation,
        validationWorktreePath: worktree.path,
        repairAttempts
      });
    }

    const integrationCommitSha = await this.git.head(worktree.path);
    const status: IntegrationStatus = anyRepairSucceeded ? "executor_repair_success" : "success";
    execLog("integrate", "integration complete", {
      task: compositeTaskId,
      status,
      integrationCommit: integrationCommitSha,
      repairAttempted: repairsUsed > 0,
      preMergeFindings: preMergeFindings.length
    });
    return this.finalize(params, status, {
      repairAttempted: repairsUsed > 0,
      repairResult,
      integrationCommitSha,
      appliedCommits,
      preMergeFindings,
      ...(validation !== undefined ? { parentValidation: validation, validationWorktreePath: worktree.path } : {}),
      repairAttempts
    });
  }

  private async validateChildCommits(
    params: IntegrationParams
  ): Promise<{ child: AgentExecutionResult; code: string; message: string } | undefined> {
    const seen = new Map<string, string>();
    for (const child of params.childResults) {
      if (child.noOp === true) {
        continue; // no-op leaf: nothing committed, nothing to validate or apply.
      }
      const commitSha = child.commitSha;
      if (commitSha === undefined || commitSha.trim().length === 0) {
        return {
          child,
          code: "invalid_child_commit",
          message: `Child ${child.taskId} reported success with an empty commitSha.`
        };
      }
      const priorTaskId = seen.get(commitSha);
      if (priorTaskId !== undefined) {
        return {
          child,
          code: "duplicate_child_commit",
          message: `Child ${child.taskId} reuses commitSha ${commitSha} already reported by ${priorTaskId}.`
        };
      }
      seen.set(commitSha, child.taskId);
      try {
        await this.git.revParse(params.worktree.path, commitSha);
      } catch (error) {
        return {
          child,
          code: "invalid_child_commit",
          message:
            `Child ${child.taskId} reported commitSha ${commitSha}, but it is not reachable from ` +
            `integration worktree ${params.worktree.path}: ${error instanceof Error ? error.message : String(error)}`
        };
      }
    }
    return undefined;
  }

  /**
   * Repair a cherry-pick conflict with up to MAX_REPAIR_PASSES executor passes.
   * After each pass the repaired files must clear scope AND syntactic
   * validation (conflict markers + TS parse diagnostics); syntax findings are
   * re-injected verbatim into the next pass's prompt as compiler feedback, so
   * the agent self-corrects instead of the run committing malformed code.
   */
  private async attemptRepair(
    params: IntegrationParams,
    child: AgentExecutionResult,
    conflict: { conflictFiles: string[]; output: string },
    preMergeFindings: PreMergeFinding[],
    repairAttempts: IntegrationRepairAttempt[]
  ): Promise<{ ok: boolean; result: AgentExecutionResult }> {
    const { worktree } = params;
    await this.git.cherryPickAbort(worktree.path);
    const selection = resolveRepairSelection(params.repair);
    const usageSource = usageSourceForSelection(selection);
    execLog("integrate", "repair executor start", {
      task: params.compositeTaskId,
      child: child.taskId,
      executor: selection.executorId,
      model: selection.model,
      files: conflict.conflictFiles,
      findings: preMergeFindings.length
    });

    const baseHead = await this.git.head(worktree.path);
    const instructionFilePath = join(
      tmpdir(),
      `mh-repair-${params.compositeTaskId}-${child.taskId}.txt`
    );
    const executor = this.executorFactory.create(selection);

    const MAX_REPAIR_PASSES = 2;
    let syntaxFeedback: string | undefined;

    for (let pass = 1; pass <= MAX_REPAIR_PASSES; pass++) {
      repairAttempts.push({
        childTaskId: child.taskId,
        pass,
        status: "started",
        files: conflict.conflictFiles
      });
      this.traceStore.append({
        type: "executor_repair_started",
        actor: "system",
        taskId: params.compositeTaskId,
        payload: {
          executorId: selection.executorId,
          model: selection.model,
          usageSource,
          childTaskId: child.taskId,
          files: conflict.conflictFiles,
          pass
        }
      });

      await this.writeInstructions(
        instructionFilePath,
        this.buildRepairPrompt(params, child, conflict, preMergeFindings, syntaxFeedback)
      );

      const executorOutcome = await executor.execute({
        cwd: worktree.path,
        instructionFilePath,
        model: selection.model,
        timeoutMs: params.repair.timeoutMs,
        bypassApprovals: params.repair.bypassApprovals ?? true,
        ...(params.repair.reasoningEffort !== undefined ? { reasoningEffort: params.repair.reasoningEffort } : {}),
        processOwnerId: worktree.runId,
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
        onOutput: (chunk) => {
          this.traceStore.append({
            type: "executor_output",
            actor: "agent",
            taskId: params.compositeTaskId,
            payload: { ...chunk, repairChildTaskId: child.taskId }
          });
        }
      });
      const outcomeWithUsage = { ...executorOutcome, usageSource };

      if (executorOutcome.timedOut || executorOutcome.exitCode !== 0) {
        repairAttempts.push({
          childTaskId: child.taskId,
          pass,
          status: "failed",
          files: conflict.conflictFiles
        });
        return {
          ok: false,
          result: this.buildRepairResult(child.taskId, "executor_error", baseHead, baseHead, outcomeWithUsage)
        };
      }

      // Same artifact filter as the recorder — the repair agent may have
      // installed dependencies to verify its fix.
      await this.git.addAllExcluding(worktree.path, DEFAULT_ARTIFACT_GLOBS);
      const changedFiles = await this.git.diffCachedNameOnly(worktree.path);
      const diff = await this.git.diffCached(worktree.path);

      if (changedFiles.length === 0) {
        // The repair executor ran but staged nothing, so the cherry-pick conflict
        // is unresolved. Committing an empty index throws in real git and would
        // crash the whole integration (mirrors the empty-diff guard in
        // ResultRecorder). Fail the repair cleanly so the conflict gate surfaces
        // it instead of letting the empty commit blow up the run.
        execWarn("integrate", "repair produced no changes — not committing an empty index", {
          task: params.compositeTaskId,
          child: child.taskId,
          pass
        });
        repairAttempts.push({
          childTaskId: child.taskId,
          pass,
          status: "failed",
          files: changedFiles
        });
        return {
          ok: false,
          result: this.buildRepairResult(child.taskId, "validation_failed", baseHead, baseHead, outcomeWithUsage, {
            diff,
            changedFiles
          })
        };
      }

      execLog("integrate", "repair produced diff", {
        task: params.compositeTaskId,
        child: child.taskId,
        changedFiles,
        pass
      });

      const scopeCheck = this.scopeChecker.check({
        changedFiles,
        executionScope: params.executionScope,
        forbiddenPaths: params.forbiddenPaths
      });
      if (!scopeCheck.passed) {
        execWarn("integrate", "repair scope violation", {
          task: params.compositeTaskId,
          child: child.taskId,
          violations: scopeCheck.violations
        });
        repairAttempts.push({
          childTaskId: child.taskId,
          pass,
          status: "failed",
          files: changedFiles
        });
        return {
          ok: false,
          result: this.buildRepairResult(
            child.taskId,
            "scope_violation",
            baseHead,
            baseHead,
            outcomeWithUsage,
            { diff, changedFiles, scopeCheck }
          )
        };
      }

      const syntax = await this.checkSyntax({ worktreePath: worktree.path, files: changedFiles });
      if (!syntax.passed) {
        syntaxFeedback = describeSyntaxFindings(syntax.findings);
        execWarn("integrate", "repair produced malformed code", {
          task: params.compositeTaskId,
          child: child.taskId,
          pass,
          findings: syntax.findings.length
        });
        this.traceStore.append({
          type: "repair_syntax_rejected",
          actor: "system",
          taskId: params.compositeTaskId,
          payload: { childTaskId: child.taskId, pass, findings: syntax.findings }
        });
        repairAttempts.push({
          childTaskId: child.taskId,
          pass,
          status: "syntax_rejected",
          files: changedFiles
        });
        if (pass < MAX_REPAIR_PASSES) {
          continue;
        }
        return {
          ok: false,
          result: this.buildRepairResult(
            child.taskId,
            "validation_failed",
            baseHead,
            baseHead,
            outcomeWithUsage,
            { diff, changedFiles, scopeCheck }
          )
        };
      }

      const commitSha = await this.git.commit({
        cwd: worktree.path,
        message: `mh-integrate: ${params.compositeTaskId} <- ${child.taskId}`
      });
      execLog("integrate", "repair committed", {
        task: params.compositeTaskId,
        child: child.taskId,
        commit: commitSha
      });
      repairAttempts.push({
        childTaskId: child.taskId,
        pass,
        status: "committed",
        files: changedFiles
      });

      return {
        ok: true,
        result: this.buildRepairResult(child.taskId, "success", baseHead, commitSha, outcomeWithUsage, {
          diff,
          changedFiles,
          scopeCheck,
          commitSha
        })
      };
    }

    throw new Error("attemptRepair: unreachable — repair pass loop exited without a result");
  }

  private async runParentValidation(
    params: IntegrationParams
  ): Promise<ValidationRunResult | undefined> {
    const commands = params.parentValidationCommands ?? [];
    if (commands.length === 0) {
      return undefined;
    }
    this.traceStore.append({
      type: "validation_started",
      actor: "system",
      taskId: params.compositeTaskId,
      payload: { scope: "parent", commandCount: commands.length }
    });
    execLog("integrate", "parent validation start", {
      task: params.compositeTaskId,
      commands: commands.length
    });
    await this.ensureParentValidationDependencies(params.worktree, params.compositeTaskId);
    const result = await this.validationRunner.run(commands, {
      worktreePath: params.worktree.path,
      repoRoot: this.repoRoot,
      supervision: { runId: params.worktree.runId }
    });
    const deferredReason = classifyDeferredValidation(result);
    if (deferredReason !== undefined) {
      execWarn("integrate", "parent validation deferred — verifying at run level", {
        task: params.compositeTaskId,
        exitCode: result.exitCode,
        output: result.output,
        reason: deferredReason
      });
      this.traceStore.append({
        type: "validation_deferred",
        actor: "system",
        taskId: params.compositeTaskId,
        payload: {
          scope: "parent",
          exitCode: result.exitCode,
          reason: deferredReason
        }
      });
      return { ...result, passed: true };
    }
    // A failing parent validation is logged by the caller as the integration
    // outcome ("integration failed: parent validation failed"); only the passing
    // case needs its own line here.
    if (result.passed) {
      execLog("integrate", "parent validation passed", {
        task: params.compositeTaskId,
        exitCode: result.exitCode
      });
    }
    return result;
  }

  /**
   * Parent validation executes in the composed integration worktree. Fresh
   * greenfield integrations can contain package.json without node_modules, so
   * install dependencies best-effort before validation and let validation own
   * the final pass/fail signal.
   */
  private async ensureParentValidationDependencies(
    worktree: { path: string; runId: string },
    compositeTaskId: string
  ): Promise<void> {
    const worktreePath = worktree.path;
    try {
      const result = await this.dependencyInstaller.ensure({
        cwd: worktreePath,
        supervision: { runId: worktree.runId }
      });
      execLog("integrate", "parent validation dependency check", {
        task: compositeTaskId,
        cwd: worktreePath,
        installed: result.installed,
        packageManager: result.packageManager,
        reason: result.reason
      });
      this.traceStore.append({
        type: "validation_started",
        actor: "system",
        taskId: compositeTaskId,
        payload: {
          scope: "parent",
          phase: "dependencies",
          installed: result.installed,
          packageManager: result.packageManager,
          reason: result.reason,
          exitCode: result.exitCode
        }
      });
    } catch (error) {
      execWarn("integrate", "parent validation dependency install failed (best-effort, ignored)", {
        task: compositeTaskId,
        cwd: worktreePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Contract-aware repair prompt. Unlike a syntactic merge
   * resolver, this gives the agent the WHY: the parent's goal, the canonical shared
   * interfaces the children must honour, and each conflicting child's intent. A
   * cherry-pick conflict here is a violation of the shared seam, resolved by
   * reference to the canonical contract rather than guessed from the diff text.
   */
  private buildRepairPrompt(
    params: IntegrationParams,
    child: AgentExecutionResult,
    conflict: { conflictFiles: string[]; output: string },
    preMergeFindings: PreMergeFinding[],
    syntaxFeedback?: string
  ): string {
    const lines: string[] = [
      "You are resolving a git cherry-pick conflict during automated integration of a composite task.",
      `The change from task "${child.taskId}" conflicts with the already-integrated parent branch.`
    ];

    if (syntaxFeedback !== undefined) {
      lines.push(
        "",
        "IMPORTANT — your previous resolution attempt produced syntactically invalid code.",
        "The TypeScript compiler reported these exact problems; fix every one of them this time:",
        syntaxFeedback
      );
    }

    if (params.parentGoal) {
      lines.push("", `Parent goal (what the integrated children must collectively achieve):`, params.parentGoal);
    }

    const seams = params.sharedInterfaces ?? [];
    if (seams.length > 0) {
      lines.push(
        "",
        "Canonical shared interfaces — the source of truth for the seams between these children.",
        "Your resolution MUST honour these signatures exactly:",
        ...seams.map((i) => `- ${i.id} (${i.kind}): ${i.signature}\n  ${i.description}`)
      );
    }

    const intent = params.childIntents?.find((entry) => entry.taskId === child.taskId);
    if (intent) {
      lines.push("", `This change implements task "${child.taskId}": ${intent.goal}`);
      if (intent.produces.length > 0) lines.push(`It produces: ${intent.produces.join(", ")}.`);
      if (intent.consumes.length > 0) lines.push(`It consumes: ${intent.consumes.join(", ")}.`);
    }

    // Already-integrated sibling changes that touch the conflicting files — the
    // concrete "other side" of the conflict, so the agent resolves against real
    // code rather than guessing.
    const conflictFileSet = new Set(conflict.conflictFiles);
    const relevantSiblings = params.childResults.filter(
      (other) =>
        other.taskId !== child.taskId &&
        (other.changedFiles ?? []).some((file) => conflictFileSet.has(file))
    );
    if (relevantSiblings.length > 0) {
      lines.push("", "Already-integrated sibling changes touching the conflicting files (context):");
      for (const sibling of relevantSiblings) {
        lines.push(`--- ${sibling.taskId} ---`, truncate(sibling.diff ?? "", 2000));
      }
    }

    if (preMergeFindings.length > 0) {
      lines.push("", "Pre-merge compatibility diagnosis:");
      for (const finding of preMergeFindings) {
        const fileSuffix = finding.files.length > 0 ? ` (${finding.files.join(", ")})` : "";
        lines.push(`- [${finding.severity}] ${finding.message}${fileSuffix}`);
      }
    }

    // Plan-time foresight (Pieza 2): surface predictions whose shared files overlap
    // the files now colliding, so the agent reconciles by the predicted cause.
    const hints = (params.predictedConflicts ?? []).filter((hint) =>
      hint.sharedFiles.some((file) => conflict.conflictFiles.includes(file))
    );
    if (hints.length > 0) {
      lines.push(
        "",
        "These collisions were predicted at planning time for the files now in conflict.",
        "Use the predicted cause to reconcile, not a guess from the diff text:",
        ...hints.map((hint) => {
          const symbols = hint.sharedSymbols.length > 0 ? ` [shared symbols: ${hint.sharedSymbols.join(", ")}]` : "";
          return `- ${hint.taskAId} ↔ ${hint.taskBId} (${hint.level}): ${hint.explanation}${symbols}`;
        })
      );
    }

    const validationCommands = params.parentValidationCommands ?? [];
    if (validationCommands.length > 0) {
      lines.push(
        "",
        "After resolving, the integrated branch must pass these parent validation commands:",
        ...validationCommands.map((command) => `- ${[command.command, ...command.args].join(" ").trim()}`)
      );
    }

    lines.push(
      "",
      "Conflicting files:",
      ...conflict.conflictFiles.map((file) => `- ${file}`),
      "",
      "Cherry-pick output:",
      conflict.output,
      "",
      "Resolve the conflict by editing the files so the result satisfies the parent goal and",
      "honours the canonical interfaces above. Do not commit — the orchestrator will commit your",
      "resolution."
    );
    return lines.join("\n");
  }

  private buildRepairResult(
    taskId: string,
    status: AgentExecutionResult["status"],
    baseHead: string,
    currentHead: string,
    executorOutcome: { exitCode: number; durationMs: number; timedOut: boolean; stdout?: string; stderr?: string; tokensIn?: number; tokensOut?: number; costUsd?: number; usageSource?: "reported" | "estimated" | "unavailable" },
    extra?: {
      diff?: string;
      changedFiles?: string[];
      scopeCheck?: AgentExecutionResult["scopeCheck"];
      commitSha?: string;
    }
  ): AgentExecutionResult {
    return AgentExecutionResultSchema.parse({
      taskId,
      status,
      baseHead,
      currentHead,
      agentCommittedUnexpectedly: false,
      diff: extra?.diff ?? "",
      changedFiles: extra?.changedFiles ?? [],
      commitSha: extra?.commitSha,
      scopeCheck: extra?.scopeCheck ?? { passed: true, violations: [] },
      executorExitCode: executorOutcome.exitCode,
      executorDurationMs: executorOutcome.durationMs,
      executorTimedOut: executorOutcome.timedOut,
      stderrTail: executorOutcome.stderr,
      stdoutTail: executorOutcome.stdout,
      tokensIn: executorOutcome.tokensIn,
      tokensOut: executorOutcome.tokensOut,
      costUsd: executorOutcome.costUsd,
      usageSource: executorOutcome.usageSource
    });
  }

  private finalize(
    params: IntegrationParams,
    status: IntegrationStatus,
    extra: {
      repairAttempted: boolean;
      repairResult?: AgentExecutionResult | undefined;
      integrationCommitSha?: string | undefined;
      conflictDetails?: { files: string[]; cherryPickOutput: string } | undefined;
      preMergeFindings?: PreMergeFinding[] | undefined;
      parentValidation?: ValidationRunResult | undefined;
      failureCode?: IntegrationFailureCode | undefined;
      appliedCommits?: AppliedChildCommit[] | undefined;
      omittedChildCommits?: OmittedChildCommit[] | undefined;
      validationWorktreePath?: string | undefined;
      repairAttempts?: IntegrationRepairAttempt[] | undefined;
    }
  ): IntegrationResult {
    const appliedCommits = extra.appliedCommits ?? [];
    const omittedChildCommits = extra.omittedChildCommits ?? [];
    const repairAttempts = extra.repairAttempts ?? [];
    this.traceStore.append({
      type: "integration_completed",
      actor: "system",
      taskId: params.compositeTaskId,
      payload: {
        status,
        ...(extra.failureCode !== undefined ? { failureCode: extra.failureCode } : {}),
        childTaskIds: params.childResults.map((child) => child.taskId),
        appliedCommits,
        omittedChildCommits,
        repairAttempts,
        ...(extra.parentValidation !== undefined
          ? {
              parentValidation: {
                passed: extra.parentValidation.passed,
                exitCode: extra.parentValidation.exitCode
              },
              validationWorktreePath: extra.validationWorktreePath
            }
          : {})
      }
    });

    return IntegrationResultSchema.parse({
      compositeTaskId: params.compositeTaskId,
      status,
      childResults: params.childResults,
      integrationCommitSha: extra.integrationCommitSha,
      conflictDetails: extra.conflictDetails,
      repairAttempted: extra.repairAttempted,
      repairResult: extra.repairResult,
      preMergeFindings: extra.preMergeFindings ?? [],
      parentValidation: extra.parentValidation,
      failureCode: extra.failureCode,
      appliedCommits,
      omittedChildCommits,
      validationWorktreePath: extra.validationWorktreePath,
      repairAttempts
    });
  }
}

function omittedFrom(
  childResults: readonly AgentExecutionResult[],
  fromIndex: number,
  reason: IntegrationFailureCode
): OmittedChildCommit[] {
  return childResults.slice(fromIndex).map((child) => ({
    childTaskId: child.taskId,
    reason,
    status: child.status,
    ...(child.commitSha !== undefined ? { commitSha: child.commitSha } : {})
  }));
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}

function requireExecutor(executor: AgentExecutor | undefined): AgentExecutor {
  if (executor === undefined) {
    throw new Error("IntegrationAgent requires an executor or executorFactory.");
  }
  return executor;
}

function resolveRepairSelection(repair: IntegrationRepairConfig): ExecutorSelection {
  return repair.selection ?? resolveLegacyModelSelection(repair.model);
}

function normalizeMaxRepairsPerIntegration(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_MAX_REPAIRS_PER_INTEGRATION;
  }
  return Math.max(0, Math.floor(value));
}
