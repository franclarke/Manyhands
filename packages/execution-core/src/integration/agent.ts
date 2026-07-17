import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionScope, ExecutionValidationCommand, InterfaceContract } from "@manyhands/contracts";
import type { TraceStore } from "@manyhands/trace-store";

import { FixedAgentExecutorFactory, type AgentExecutorFactory } from "../executor/factory";
import {
  resolveLegacyModelSelection,
  usageSourceForSelection,
  type EffortLevel,
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
import type { IntegrationOperation, IntegrationOperationJournal } from "./operation-journal";
import {
  IntegrationManifestExecutor,
  type IntegrationManifest,
  type IntegrationManifestExecutorDeps,
  type IntegrationRequestManifest
} from "./manifest";

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
  reasoningEffort?: EffortLevel;
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
  /** Durable B-015 attempt identity for integration repair processes. */
  attemptId?: string;
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
  /** Durable operation evidence used to reconcile a restart before any Git mutation. */
  integrationOperation?: {
    journal: IntegrationOperationJournal;
    runId: string;
    operationId?: string;
    fencingToken?: number;
  };
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
  private currentOperationJournal: IntegrationOperationJournal | undefined;

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
    let operation = await this.openOperation(params);
    const completedRecovery = await this.recoverCompletedOperation(params, operation);
    if (completedRecovery !== undefined) return completedRecovery;
    if (operation?.schemaVersion === 1) {
      return this.failIntegrationRecovery(
        params,
        operation,
        `Legacy integration journal ${operation.integrationOperationId} is already past the safe prepared state. ` +
          "Start a new integration attempt.",
        [],
        [],
        [],
        false
      );
    }

    // Claim the current CAS revision before emitting traces or touching Git.
    // A concurrent/stale writer therefore fails at the journal boundary rather
    // than producing duplicate facts or racing the first cherry-pick.
    operation = await this.updateOperation(operation, {});

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

      let existingHead = await this.git.head(worktree.path);
      const recordedChild = operation?.children.find((entry) => entry.taskId === child.taskId);
      const activeCherryPick = await this.git.cherryPickHead(worktree.path);
      const sourceIsAncestor = await this.git.isAncestor({
        cwd: worktree.path,
        ancestor: commitSha,
        descendant: existingHead
      });

      // Schema-v1 wrote resultSha without provenance and is the format that
      // produced the historical false-success journals. Only direct source
      // ancestry is trustworthy; an "applied" v1 entry without it is rejected
      // rather than silently re-applied or promoted to success.
      if (
        operation?.schemaVersion === 1 &&
        recordedChild !== undefined &&
        (recordedChild.state === "applied" || recordedChild.state === "repaired") &&
        !sourceIsAncestor
      ) {
        return this.failIntegrationRecovery(
          params,
          operation,
          `Legacy integration journal claims child ${child.taskId} (${commitSha}) was applied, ` +
            `but that source commit is not an ancestor of ${existingHead}. Start a new integration attempt.`,
          appliedCommits,
          preMergeFindings,
          repairAttempts,
          repairsUsed > 0
        );
      }

      // Normal resume: the journal names the commit physically created on the
      // parent lineage. A cherry-picked source SHA is generally *not* an
      // ancestor, so the result SHA is the durable evidence that matters.
      if (
        operation?.schemaVersion === 2 &&
        recordedChild?.resultSha !== undefined &&
        await this.recordedApplicationIsValid(
          worktree.path,
          commitSha,
          existingHead,
          recordedChild
        )
      ) {
        operation = await this.updateOperation(operation, {
          state: "child_applied",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, recordedChild.state, {
            resultSha: recordedChild.resultSha,
            ...(recordedChild.startedFromSha !== undefined
              ? { startedFromSha: recordedChild.startedFromSha }
              : {}),
            ...(recordedChild.application !== undefined
              ? { application: recordedChild.application }
              : {})
          })
        });
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha,
          resultSha: recordedChild.resultSha,
          ...(recordedChild.startedFromSha !== undefined ? { preSha: recordedChild.startedFromSha } : {}),
          ...(recordedChild.application !== undefined ? { application: recordedChild.application } : {}),
          order: appliedCommits.length
        });
        continue;
      }

      // Crash window: Git committed the cherry-pick/repair, but the journal
      // still says "started". The new HEAD must be one direct commit above the
      // pre-mutation HEAD and there must be no active cherry-pick to adopt it.
      if (
        activeCherryPick === undefined &&
        operation?.schemaVersion === 2 &&
        recordedChild?.startedFromSha !== undefined &&
        existingHead !== recordedChild.startedFromSha &&
        await this.hasFirstParent(worktree.path, existingHead, recordedChild.startedFromSha)
      ) {
        const application = recordedChild.state === "conflict" ? "repaired" as const : "cherry_picked" as const;
        if (!await this.hasExpectedSourceProvenance(worktree.path, existingHead, commitSha, application)) {
          return this.failIntegrationRecovery(
            params,
            operation,
            `Integration recovery found unexplained commit ${existingHead} above ${recordedChild.startedFromSha} ` +
              `while applying child ${child.taskId} (${commitSha}).`,
            appliedCommits,
            preMergeFindings,
            repairAttempts,
            repairsUsed > 0
          );
        }
        operation = await this.updateOperation(operation, {
          state: "child_applied",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, application === "repaired" ? "repaired" : "applied", {
            startedFromSha: recordedChild.startedFromSha,
            resultSha: existingHead,
            application
          })
        });
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha,
          resultSha: existingHead,
          preSha: recordedChild.startedFromSha,
          application,
          order: appliedCommits.length
        });
        continue;
      }

      // A source commit may legitimately already be reachable (for example a
      // directly adopted commit). This is distinct from a cherry-picked copy.
      if (sourceIsAncestor) {
        operation = await this.updateOperation(operation, {
          state: "child_applied",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, "applied", {
            resultSha: commitSha,
            application: "already_ancestor"
          })
        });
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha,
          resultSha: commitSha,
          application: "already_ancestor",
          order: appliedCommits.length
        });
        continue;
      }

      if (activeCherryPick !== undefined) {
        const unmerged = await this.git.unmergedFiles(worktree.path);
        operation = await this.updateOperation(operation, {
          state: "conflict_detected",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, "conflict"),
          error: { code: "interrupted_cherry_pick", message: `Restart found CHERRY_PICK_HEAD ${activeCherryPick} with ${unmerged.join(", ") || "no"} unmerged paths.` }
        });
        await this.git.cherryPickAbort(worktree.path);
        existingHead = await this.git.head(worktree.path);
      }
      if (
        activeCherryPick === undefined &&
        operation?.schemaVersion === 2 &&
        recordedChild?.startedFromSha === existingHead &&
        (await this.git.statusPorcelain(worktree.path)).length > 0
      ) {
        return this.failIntegrationRecovery(
          params,
          operation,
          `Integration recovery found ambiguous uncommitted changes for child ${child.taskId} in ${worktree.path}.`,
          appliedCommits,
          preMergeFindings,
          repairAttempts,
          repairsUsed > 0
        );
      }
      operation = await this.updateOperation(operation, {
        state: "cherry_pick_started",
        currentChildId: child.taskId,
        children: markOperationChild(operation, child.taskId, "started", { startedFromSha: existingHead })
      });
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
        commitSha,
        ...(child.cherryPickMainline !== undefined ? { mainline: child.cherryPickMainline } : {})
      });
      if (outcome.ok) {
        const resultSha = await this.git.head(worktree.path);
        operation = await this.updateOperation(operation, {
          state: "child_applied",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, "applied", {
            startedFromSha: existingHead,
            resultSha,
            application: "cherry_picked"
          })
        });
        execLog("integrate", "cherry-pick ok", { task: compositeTaskId, child: child.taskId });
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha,
          resultSha,
          preSha: existingHead,
          application: "cherry_picked",
          order: appliedCommits.length
        });
        continue;
      }

      const outcomeKind = outcome.kind ?? (outcome.conflictFiles.length > 0 ? "conflict" : "error");
      if (outcomeKind === "empty") {
        if (await this.git.cherryPickHead(worktree.path) !== undefined) {
          await this.git.cherryPickAbort(worktree.path);
        }
        const redundantHead = await this.git.head(worktree.path);
        if (redundantHead !== existingHead) {
          const message =
            `Empty cherry-pick for child ${child.taskId} unexpectedly moved HEAD from ` +
            `${existingHead} to ${redundantHead}.`;
          if (operation !== undefined) {
            return this.failIntegrationRecovery(
              params,
              operation,
              message,
              appliedCommits,
              preMergeFindings,
              repairAttempts,
              repairsUsed > 0
            );
          }
          return this.finalize(params, "internal_error", {
            repairAttempted: repairsUsed > 0,
            failureCode: "internal_error",
            appliedCommits,
            preMergeFindings: [
              ...preMergeFindings,
              { severity: "warning", code: "cherry_pick_error", message, files: [] }
            ],
            repairAttempts
          });
        }
        operation = await this.updateOperation(operation, {
          state: "child_applied",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, "applied", {
            startedFromSha: existingHead,
            resultSha: existingHead,
            application: "already_satisfied"
          })
        });
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha,
          resultSha: existingHead,
          preSha: existingHead,
          application: "already_satisfied",
          order: appliedCommits.length
        });
        continue;
      }
      if (outcomeKind === "error") {
        const message = `Git could not cherry-pick child ${child.taskId} (${commitSha}): ${outcome.output}`;
        operation = await this.updateOperation(operation, {
          state: "failed",
          currentChildId: child.taskId,
          error: { code: "cherry_pick_error", message }
        });
        return this.finalize(params, "internal_error", {
          repairAttempted: repairsUsed > 0,
          repairResult,
          failureCode: "internal_error",
          appliedCommits,
          preMergeFindings: [
            ...preMergeFindings,
            { severity: "warning", code: "cherry_pick_error", message, files: [] }
          ],
          repairAttempts
        });
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
      operation = await this.updateOperation(operation, {
        state: "conflict_detected",
        currentChildId: child.taskId,
        children: markOperationChild(operation, child.taskId, "conflict"),
        error: { code: "cherry_pick_conflict", message: outcome.output }
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
        let partialCommitSha: string | undefined;
        try {
          partialCommitSha = await this.createPartialHandoff(params, appliedCommits);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          operation = await this.updateOperation(operation, {
            state: "failed",
            error: { code: "applied_commit_not_ancestor", message }
          });
          return this.finalize(params, "internal_error", {
            repairAttempted: repairsUsed > 0,
            repairResult,
            failureCode: "internal_error",
            appliedCommits,
            preMergeFindings,
            repairAttempts
          });
        }
        omittedChildCommits.push(...omittedFrom(childResults, childIndex, "cherry_pick_conflict"));
        const failed = this.finalize(params, "executor_repair_failed", {
          repairAttempted: repairsUsed > 0,
          repairResult,
          ...(partialCommitSha !== undefined ? { integrationCommitSha: partialCommitSha } : {}),
          ...(partialCommitSha !== undefined && partialCommitSha !== worktree.baseCommit
            ? { cherryPickMainline: 1 as const }
            : {}),
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          failureCode: "cherry_pick_conflict",
          preMergeFindings,
          appliedCommits,
          omittedChildCommits,
          repairAttempts
        });
        operation = await this.updateOperation(operation, {
          state: partialCommitSha !== undefined ? "gated" : "failed",
          ...(partialCommitSha !== undefined ? { finalSha: partialCommitSha } : {}),
          ...(partialCommitSha !== undefined && partialCommitSha !== worktree.baseCommit
            ? { cherryPickMainline: 1 as const }
            : {}),
          disposition: "executor_repair_failed",
          error: { code: "cherry_pick_conflict", message: outcome.output },
          result: failed
        });
        return failed;
      }
      repairsUsed += 1;

      execLog("integrate", "attempting agent repair of conflict", {
        task: compositeTaskId,
        child: child.taskId,
        model: params.repair.model,
        repairsUsed,
        maxRepairs
      });
      operation = await this.updateOperation(operation, { state: "repair_started" });
      const repairChild = await this.withPhysicalChildDiff(child, worktree.path);
      const repair = await this.attemptRepair(params, repairChild, outcome, preMergeFindings, repairAttempts);
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
        let partialCommitSha: string | undefined;
        try {
          partialCommitSha = await this.createPartialHandoff(params, appliedCommits);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          operation = await this.updateOperation(operation, {
            state: "failed",
            error: { code: "applied_commit_not_ancestor", message }
          });
          return this.finalize(params, "internal_error", {
            repairAttempted: true,
            repairResult,
            failureCode: "internal_error",
            appliedCommits,
            preMergeFindings,
            repairAttempts
          });
        }
        omittedChildCommits.push(...omittedFrom(childResults, childIndex, "repair_failed"));
        const failed = this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          ...(partialCommitSha !== undefined ? { integrationCommitSha: partialCommitSha } : {}),
          ...(partialCommitSha !== undefined && partialCommitSha !== worktree.baseCommit
            ? { cherryPickMainline: 1 as const }
            : {}),
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          failureCode: "repair_failed",
          preMergeFindings,
          appliedCommits,
          omittedChildCommits,
          repairAttempts
        });
        operation = await this.updateOperation(operation, {
          state: partialCommitSha !== undefined ? "gated" : "failed",
          ...(partialCommitSha !== undefined ? { finalSha: partialCommitSha } : {}),
          ...(partialCommitSha !== undefined && partialCommitSha !== worktree.baseCommit
            ? { cherryPickMainline: 1 as const }
            : {}),
          disposition: "executor_repair_failed",
          error: { code: "repair_failed", message: outcome.output },
          result: failed
        });
        return failed;
      }
      if (repair.result.commitSha !== undefined) {
        operation = await this.updateOperation(operation, {
          state: "repair_finished",
          currentChildId: child.taskId,
          children: markOperationChild(operation, child.taskId, "repaired", {
            startedFromSha: existingHead,
            resultSha: repair.result.commitSha,
            application: "repaired"
          })
        });
        appliedCommits.push({
          childTaskId: child.taskId,
          commitSha,
          resultSha: repair.result.commitSha,
          preSha: existingHead,
          application: "repaired",
          order: appliedCommits.length
        });
      }
      execLog("integrate", "agent repair resolved conflict", {
        task: compositeTaskId,
        child: child.taskId
      });
      anyRepairSucceeded = true;
    }

    // Create a merge-shaped handoff before validation. Its first-parent diff is
    // the complete composite snapshot (safe for the parent to cherry-pick with
    // mainline 1), while its second parent retains every applied commit as
    // physical ancestry.
    let integrationCommitSha: string;
    try {
      integrationCommitSha = await this.createAndVerifyHandoff(params, appliedCommits);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      execError("integrate", "integration physical-evidence check failed", {
        task: compositeTaskId,
        error: message
      });
      operation = await this.updateOperation(operation, {
        state: "failed",
        error: { code: "applied_commit_not_ancestor", message }
      });
      return this.finalize(params, "internal_error", {
        repairAttempted: repairsUsed > 0,
        repairResult,
        failureCode: "internal_error",
        appliedCommits,
        preMergeFindings: [
          ...preMergeFindings,
          {
            severity: "warning",
            code: "applied_commit_not_ancestor",
            message,
            files: []
          }
        ],
        repairAttempts
      });
    }

    operation = await this.updateOperation(operation, {
      state: "integration_commit_recorded",
      finalSha: integrationCommitSha,
      ...(integrationCommitSha !== worktree.baseCommit ? { cherryPickMainline: 1 as const } : {})
    });

    // Parent validation runs once over the fully-integrated handoff tree.
    if ((params.parentValidationCommands ?? []).length > 0) {
      operation = await this.updateOperation(operation, { state: "validation_started" });
    }
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
      const failed = this.finalize(params, "validation_failed", {
        repairAttempted: repairsUsed > 0,
        repairResult,
        integrationCommitSha,
        ...(integrationCommitSha !== worktree.baseCommit ? { cherryPickMainline: 1 as const } : {}),
        failureCode: "validation_failed",
        appliedCommits,
        preMergeFindings,
        parentValidation: validation,
        validationWorktreePath: worktree.path,
        repairAttempts
      });
      operation = await this.updateOperation(operation, {
        state: "gated",
        finalSha: integrationCommitSha,
        ...(integrationCommitSha !== worktree.baseCommit ? { cherryPickMainline: 1 as const } : {}),
        disposition: "validation_failed",
        error: { code: "validation_failed", message: validation.output },
        result: failed
      });
      return failed;
    }
    if (validation !== undefined) {
      operation = await this.updateOperation(operation, { state: "validation_finished" });
    }

    const status: IntegrationStatus = anyRepairSucceeded ? "executor_repair_success" : "success";
    execLog("integrate", "integration complete", {
      task: compositeTaskId,
      status,
      integrationCommit: integrationCommitSha,
      repairAttempted: repairsUsed > 0,
      preMergeFindings: preMergeFindings.length
    });
    const finalized = this.finalize(params, status, {
      repairAttempted: repairsUsed > 0,
      repairResult,
      integrationCommitSha,
      ...(integrationCommitSha !== worktree.baseCommit ? { cherryPickMainline: 1 as const } : {}),
      appliedCommits,
      preMergeFindings,
      ...(validation !== undefined ? { parentValidation: validation, validationWorktreePath: worktree.path } : {}),
      repairAttempts
    });
    operation = await this.updateOperation(operation, {
      state: "completed",
      finalSha: integrationCommitSha,
      ...(integrationCommitSha !== worktree.baseCommit ? { cherryPickMainline: 1 as const } : {}),
      disposition: status,
      result: finalized
    });
    return finalized;
  }

  async integrateManifest(
    input: { request: IntegrationRequestManifest; worktreePath: string },
    dependencies: Omit<IntegrationManifestExecutorDeps, "git">
  ): Promise<IntegrationManifest> {
    return new IntegrationManifestExecutor({ git: this.git, ...dependencies }).integrate(input);
  }

  private async openOperation(params: IntegrationParams): Promise<IntegrationOperation | undefined> {
    const context = params.integrationOperation;
    if (context === undefined) return undefined;
    this.currentOperationJournal = context.journal;
    return context.journal.open({
      runId: context.runId,
      parentNodeId: params.compositeTaskId,
      ...(params.attemptId !== undefined ? { attemptId: params.attemptId } : {}),
      ...(context.operationId !== undefined ? { operationId: context.operationId } : {}),
      ...(context.fencingToken !== undefined ? { fencingToken: context.fencingToken } : {}),
      worktreePath: params.worktree.path,
      baseSha: params.worktree.baseCommit,
      children: params.childResults.filter((child) => child.noOp !== true && child.commitSha !== undefined).map((child) => ({ taskId: child.taskId, commitSha: child.commitSha!, state: "pending" }))
    });
  }

  private async hasFirstParent(cwd: string, commitSha: string, expectedParent: string): Promise<boolean> {
    try {
      return await this.git.revParse(cwd, `${commitSha}^1`) === expectedParent;
    } catch {
      return false;
    }
  }

  private async recordedApplicationIsValid(
    cwd: string,
    sourceCommitSha: string,
    currentHead: string,
    recorded: IntegrationOperation["children"][number]
  ): Promise<boolean> {
    if (recorded.resultSha === undefined || recorded.application === undefined) return false;
    if (!await this.git.isAncestor({ cwd, ancestor: recorded.resultSha, descendant: currentHead })) {
      return false;
    }
    if (recorded.application === "already_ancestor") {
      return recorded.resultSha === sourceCommitSha;
    }
    if (recorded.application === "already_satisfied") {
      return recorded.startedFromSha !== undefined && recorded.resultSha === recorded.startedFromSha;
    }
    if (
      recorded.startedFromSha === undefined ||
      recorded.resultSha === recorded.startedFromSha
    ) {
      return false;
    }
    return await this.hasFirstParent(cwd, recorded.resultSha, recorded.startedFromSha) &&
      await this.hasExpectedSourceProvenance(cwd, recorded.resultSha, sourceCommitSha, recorded.application);
  }

  private async hasExpectedSourceProvenance(
    cwd: string,
    resultSha: string,
    sourceCommitSha: string,
    application: "cherry_picked" | "repaired"
  ): Promise<boolean> {
    try {
      const message = await this.git.commitMessage(cwd, resultSha);
      return application === "repaired"
        ? message.split(/\r?\n/u).some((line) => line.trim() === `ManyHands-Source-Commit: ${sourceCommitSha}`)
        : message.includes(`(cherry picked from commit ${sourceCommitSha})`);
    } catch {
      return false;
    }
  }

  private async failIntegrationRecovery(
    params: IntegrationParams,
    operation: IntegrationOperation,
    message: string,
    appliedCommits: AppliedChildCommit[],
    preMergeFindings: PreMergeFinding[],
    repairAttempts: IntegrationRepairAttempt[],
    repairAttempted: boolean
  ): Promise<IntegrationResult> {
    const observedHead = await this.git.head(params.worktree.path);
    const result = this.finalize(params, "internal_error", {
      repairAttempted,
      failureCode: "internal_error",
      appliedCommits,
      preMergeFindings: [
        ...preMergeFindings,
        {
          severity: "warning",
          code: "integration_recovery_invalid",
          message,
          files: []
        }
      ],
      repairAttempts
    });
    await this.updateOperation(operation, {
      state: "failed",
      ...(operation.finalSha === undefined ? { finalSha: observedHead } : {}),
      disposition: "internal_error",
      error: {
        code: "integration_recovery_invalid",
        message: `${message} Observed managed worktree HEAD: ${observedHead}.`
      },
      result
    });
    execError("integrate", "integration recovery evidence rejected", {
      task: params.compositeTaskId,
      error: message
    });
    return result;
  }

  private async recoverCompletedOperation(
    params: IntegrationParams,
    operation: IntegrationOperation | undefined
  ): Promise<IntegrationResult | undefined> {
    if (
      operation === undefined ||
      (operation.state !== "completed" && operation.state !== "gated" && operation.state !== "failed")
    ) return undefined;

    const invalid = async (message: string): Promise<IntegrationResult> =>
      this.failIntegrationRecovery(params, operation, message, [], [], [], false);

    if (operation.schemaVersion !== 2) {
      return invalid(
        `Terminal legacy integration journal ${operation.integrationOperationId} has no trusted provenance. ` +
          "Start a new integration attempt."
      );
    }
    if (operation.result === undefined || operation.disposition === undefined) {
      return invalid(`Terminal integration journal ${operation.integrationOperationId} is missing its result receipt.`);
    }
    try {
      const result = IntegrationResultSchema.parse(operation.result);
      if (
        result.compositeTaskId !== params.compositeTaskId ||
        result.status !== operation.disposition ||
        result.integrationCommitSha !== operation.finalSha ||
        result.cherryPickMainline !== operation.cherryPickMainline
      ) {
        return invalid(`Terminal integration receipt does not match journal identity, disposition or final SHA.`);
      }
      const expectedChildren = params.childResults.map((child) => ({
        taskId: child.taskId,
        status: child.status,
        commitSha: child.commitSha,
        noOp: child.noOp
      }));
      const receiptChildren = result.childResults.map((child) => ({
        taskId: child.taskId,
        status: child.status,
        commitSha: child.commitSha,
        noOp: child.noOp
      }));
      if (JSON.stringify(expectedChildren) !== JSON.stringify(receiptChildren)) {
        return invalid(`Terminal integration receipt child identity does not match the requested child results.`);
      }

      if (result.integrationCommitSha !== undefined) {
        const currentHead = await this.git.head(params.worktree.path);
        if (currentHead !== result.integrationCommitSha) {
          return invalid(
            `Terminal integration journal expects HEAD ${result.integrationCommitSha}, but managed worktree ` +
              `${params.worktree.path} is at ${currentHead}.`
          );
        }

        const appliedCommits: AppliedChildCommit[] = [];
        for (const recorded of operation.children) {
          if (recorded.resultSha === undefined) continue;
          const child = params.childResults.find((candidate) => candidate.taskId === recorded.taskId);
          if (
            child?.commitSha === undefined ||
            !await this.recordedApplicationIsValid(
              params.worktree.path,
              child.commitSha,
              result.integrationCommitSha,
              recorded
            )
          ) {
            return invalid(`Terminal integration journal has invalid evidence for child ${recorded.taskId}.`);
          }
          appliedCommits.push({
            childTaskId: recorded.taskId,
            commitSha: child.commitSha,
            resultSha: recorded.resultSha,
            ...(recorded.startedFromSha !== undefined ? { preSha: recorded.startedFromSha } : {}),
            ...(recorded.application !== undefined ? { application: recorded.application } : {}),
            order: appliedCommits.length
          });
        }
        await this.assertAppliedCommitsReachable(
          params.worktree.path,
          result.integrationCommitSha,
          appliedCommits
        );
        if (JSON.stringify(result.appliedCommits ?? []) !== JSON.stringify(appliedCommits)) {
          return invalid(`Terminal integration receipt applied-commit evidence differs from the journal.`);
        }
      }

      execLog("integrate", "integration recovered from terminal operation", {
        task: params.compositeTaskId,
        status: result.status,
        integrationCommit: result.integrationCommitSha
      });
      return result;
    } catch (error) {
      return invalid(error instanceof Error ? error.message : String(error));
    }
  }

  private async createAndVerifyHandoff(
    params: IntegrationParams,
    appliedCommits: readonly AppliedChildCommit[]
  ): Promise<string> {
    const lineageHead = await this.git.head(params.worktree.path);
    await this.assertAppliedCommitsReachable(params.worktree.path, lineageHead, appliedCommits);

    const handoffSha = await this.git.createIntegrationHandoff({
      cwd: params.worktree.path,
      baseCommit: params.worktree.baseCommit,
      message: `mh-integrate: handoff ${params.compositeTaskId}`,
      appliedCommitShas: appliedCommits
        .filter((applied) => applied.application !== "already_ancestor" && applied.application !== "already_satisfied")
        .map((applied) => applied.resultSha ?? applied.commitSha)
    });
    const physicalHead = await this.git.head(params.worktree.path);
    if (physicalHead !== handoffSha) {
      throw new Error(
        `Integration handoff ${handoffSha} was created for ${params.compositeTaskId}, ` +
        `but the integration worktree HEAD is ${physicalHead}.`
      );
    }
    await this.assertAppliedCommitsReachable(params.worktree.path, handoffSha, appliedCommits);
    return handoffSha;
  }

  private async createPartialHandoff(
    params: IntegrationParams,
    appliedCommits: readonly AppliedChildCommit[]
  ): Promise<string | undefined> {
    if (appliedCommits.length === 0) return undefined;
    return this.createAndVerifyHandoff(params, appliedCommits);
  }

  /**
   * Synthetic composite results intentionally avoid duplicating large patches
   * in scheduler state. If their handoff conflicts, recover the exact
   * first-parent patch from Git so semantic repair still receives the child's
   * real diff as required by D8.
   */
  private async withPhysicalChildDiff(
    child: AgentExecutionResult,
    cwd: string
  ): Promise<AgentExecutionResult> {
    if (child.diff.length > 0 && child.changedFiles.length > 0) return child;
    if (child.commitSha === undefined) return child;
    try {
      const firstParent = await this.git.revParse(cwd, `${child.commitSha}^1`);
      const [diff, changedFiles] = await Promise.all([
        this.git.diffRange({ cwd, from: firstParent, to: child.commitSha }),
        this.git.diffRangeNameOnly({ cwd, from: firstParent, to: child.commitSha })
      ]);
      return { ...child, diff, changedFiles };
    } catch {
      return child;
    }
  }

  private async assertAppliedCommitsReachable(
    cwd: string,
    finalSha: string,
    appliedCommits: readonly AppliedChildCommit[]
  ): Promise<void> {
    for (const applied of appliedCommits) {
      const physicalSha = applied.resultSha ?? applied.commitSha;
      if (!await this.git.isAncestor({ cwd, ancestor: physicalSha, descendant: finalSha })) {
        throw new Error(
          `Applied child ${applied.childTaskId} has physical commit ${physicalSha}, ` +
          `which is not an ancestor of integration result ${finalSha}.`
        );
      }
    }
  }

  private async updateOperation(operation: IntegrationOperation | undefined, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation | undefined> {
    if (operation === undefined) return undefined;
    if (operation.state === "completed" && patch.state !== "failed") return operation;
    return await this.operationJournal(operation)?.update(operation, patch) ?? operation;
  }

  private operationJournal(_operation: IntegrationOperation): IntegrationOperationJournal | undefined {
    return this.currentOperationJournal;
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
        const canonicalCommit = await this.git.revParse(params.worktree.path, `${commitSha}^{commit}`);
        if (canonicalCommit !== commitSha) {
          return {
            child,
            code: "invalid_child_commit",
            message: `Child ${child.taskId} reported ${commitSha}, but its canonical commit SHA is ${canonicalCommit}.`
          };
        }
        let secondParent: string | undefined;
        try {
          secondParent = await this.git.revParse(params.worktree.path, `${commitSha}^2`);
        } catch {
          // Ordinary leaf/orchestrator commits have one parent.
        }
        if (secondParent !== undefined && child.cherryPickMainline !== 1) {
          return {
            child,
            code: "invalid_child_commit",
            message:
              `Child ${child.taskId} reported merge commit ${commitSha} without the explicit ` +
              "orchestrator handoff mainline."
          };
        }
        if (secondParent === undefined && child.cherryPickMainline !== undefined) {
          return {
            child,
            code: "invalid_child_commit",
            message: `Child ${child.taskId} requested a cherry-pick mainline for non-merge commit ${commitSha}.`
          };
        }
        if (
          secondParent !== undefined &&
          await this.git.revParse(params.worktree.path, `${commitSha}^1`) !== params.worktree.baseCommit
        ) {
          return {
            child,
            code: "invalid_child_commit",
            message:
              `Composite handoff ${commitSha} has first parent other than integration base ` +
              `${params.worktree.baseCommit}.`
          };
        }
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
    if (await this.git.cherryPickHead(worktree.path) !== undefined) {
      await this.git.cherryPickAbort(worktree.path);
    }
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
        ...(params.attemptId !== undefined ? { attemptId: params.attemptId } : {}),
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
      const executorHead = await this.git.head(worktree.path);

      if (executorHead !== baseHead) {
        const [committedDiff, committedFiles] = await Promise.all([
          this.git.diffRange({ cwd: worktree.path, from: baseHead, to: executorHead }),
          this.git.diffRangeNameOnly({ cwd: worktree.path, from: baseHead, to: executorHead })
        ]);
        const scopeCheck = this.scopeChecker.check({
          changedFiles: committedFiles,
          executionScope: params.executionScope,
          forbiddenPaths: params.forbiddenPaths
        });
        await this.git.restoreManagedWorktree(worktree.path, baseHead);
        execError("integrate", "repair agent committed unexpectedly", {
          task: params.compositeTaskId,
          child: child.taskId,
          baseHead,
          executorHead,
          changedFiles: committedFiles
        });
        repairAttempts.push({
          childTaskId: child.taskId,
          pass,
          status: "failed",
          files: committedFiles
        });
        return {
          ok: false,
          result: this.buildRepairResult(
            child.taskId,
            "agent_committed_unexpectedly",
            baseHead,
            executorHead,
            outcomeWithUsage,
            {
              diff: committedDiff,
              changedFiles: committedFiles,
              scopeCheck,
              agentCommittedUnexpectedly: true
            }
          )
        };
      }

      if (executorOutcome.timedOut || executorOutcome.exitCode !== 0) {
        repairAttempts.push({
          childTaskId: child.taskId,
          pass,
          status: "failed",
          files: conflict.conflictFiles
        });
        await this.git.restoreManagedWorktree(worktree.path, baseHead);
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
        await this.git.restoreManagedWorktree(worktree.path, baseHead);
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
        await this.git.restoreManagedWorktree(worktree.path, baseHead);
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
        await this.git.restoreManagedWorktree(worktree.path, baseHead);
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
        message:
          `mh-integrate: ${params.compositeTaskId} <- ${child.taskId}\n\n` +
          `ManyHands-Source-Commit: ${child.commitSha ?? "unknown"}`
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

    lines.push(
      "",
      "Incoming child patch (Git source of truth):",
      ...(child.changedFiles.length > 0
        ? [`Changed files: ${child.changedFiles.join(", ")}`]
        : ["Changed files: unavailable"]),
      truncate(child.diff, 5000)
    );

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
      agentCommittedUnexpectedly?: boolean;
    }
  ): AgentExecutionResult {
    return AgentExecutionResultSchema.parse({
      taskId,
      status,
      baseHead,
      currentHead,
      agentCommittedUnexpectedly: extra?.agentCommittedUnexpectedly ?? false,
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
      cherryPickMainline?: 1 | undefined;
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
      cherryPickMainline: extra.cherryPickMainline,
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

function markOperationChild(
  operation: IntegrationOperation | undefined,
  taskId: string,
  state: IntegrationOperation["children"][number]["state"],
  evidence: {
    resultSha?: string;
    startedFromSha?: string;
    application?: NonNullable<IntegrationOperation["children"][number]["application"]>;
  } = {}
): IntegrationOperation["children"] {
  return (operation?.children ?? []).map((child) =>
    child.taskId === taskId ? { ...child, state, ...evidence } : child
  );
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
