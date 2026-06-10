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
import { ScopeChecker } from "../scope/checker";
import type { SandboxMode } from "../types";
import {
  AgentExecutionResultSchema,
  IntegrationResultSchema,
  type AgentExecutionResult,
  type IntegrationResult,
  type IntegrationStatus,
  type PreMergeFinding,
  type ValidationRunResult,
  type WorktreeRecord
} from "../types";
import { computePreMergeFindings } from "./pre-merge";
import type { ValidationRunner } from "../validation/runner";
import { ChildProcessValidationRunner } from "../validation/runner";

export interface IntegrationAgentDeps {
  git: GitRunner;
  executor?: AgentExecutor;
  executorFactory?: AgentExecutorFactory;
  traceStore: TraceStore;
  repoRoot: string;
  validationRunner?: ValidationRunner;
  scopeChecker?: ScopeChecker;
  /** Writes the repair instructions file. Injectable for tests. */
  writeInstructions?: (path: string, content: string) => Promise<void>;
  now?: () => string;
}

export interface IntegrationRepairConfig {
  selection?: ExecutorSelection;
  model?: string;
  sandboxMode: SandboxMode;
  timeoutMs: number;
  bypassApprovals?: boolean;
}

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
  // ── Contract-aware composition (thesis Artifact 2) ──
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
 * single agent repair attempt per conflict (D8 / ADR-0025). git diff stays the
 * source of truth (D5) and the orchestrator — never the agent — commits (D6).
 */
export class IntegrationAgent {
  private readonly git: GitRunner;
  private readonly executorFactory: AgentExecutorFactory;
  private readonly traceStore: TraceStore;
  private readonly repoRoot: string;
  private readonly validationRunner: ValidationRunner;
  private readonly scopeChecker: ScopeChecker;
  private readonly writeInstructions: (path: string, content: string) => Promise<void>;

  constructor(deps: IntegrationAgentDeps) {
    this.git = deps.git;
    this.executorFactory =
      deps.executorFactory ?? new FixedAgentExecutorFactory(requireExecutor(deps.executor));
    this.traceStore = deps.traceStore;
    this.repoRoot = deps.repoRoot;
    this.validationRunner = deps.validationRunner ?? new ChildProcessValidationRunner();
    this.scopeChecker = deps.scopeChecker ?? new ScopeChecker();
    this.writeInstructions = deps.writeInstructions ?? ((path, content) => writeFile(path, content, "utf8"));
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

    // Any non-successful child means we never start integration (ADR-0025).
    const failedChild = childResults.find((child) => child.status !== "success");
    if (failedChild) {
      execWarn("integrate", "skipping integration: a child task failed", {
        task: compositeTaskId,
        failedChild: failedChild.taskId,
        childStatus: failedChild.status
      });
      return this.finalize(params, "child_failed", { repairAttempted: false });
    }

    // Pre-merge compatibility check (Fase 3.1): a deterministic diagnosis that
    // travels into the repair prompt and onto the result, computed before we
    // spend the single repair attempt.
    const preMergeFindings = computePreMergeFindings({
      childResults,
      ...(params.childIntents !== undefined ? { childIntents: params.childIntents } : {})
    });

    let repairAttempted = false;
    let anyRepairSucceeded = false;
    let repairResult: AgentExecutionResult | undefined;

    for (const child of childResults) {
      if (!child.commitSha) {
        execWarn("integrate", "skipping child without commit", {
          task: compositeTaskId,
          child: child.taskId,
          childStatus: child.status
        });
        continue;
      }

      execLog("integrate", "cherry-pick start", {
        task: compositeTaskId,
        child: child.taskId,
        commit: child.commitSha
      });
      this.traceStore.append({
        type: "cherry_pick_attempted",
        actor: "system",
        taskId: compositeTaskId,
        payload: { childTaskId: child.taskId, commitSha: child.commitSha }
      });

      const outcome = await this.git.cherryPick({
        cwd: worktree.path,
        commitSha: child.commitSha
      });
      if (outcome.ok) {
        execLog("integrate", "cherry-pick ok", { task: compositeTaskId, child: child.taskId });
        continue;
      }

      // Conflict: one repair attempt only.
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

      if (repairAttempted) {
        execWarn("integrate", "integration failed: second conflict (only one repair allowed)", {
          task: compositeTaskId,
          child: child.taskId,
          files: outcome.conflictFiles
        });
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          preMergeFindings
        });
      }
      repairAttempted = true;

      execLog("integrate", "attempting agent repair of conflict", {
        task: compositeTaskId,
        child: child.taskId,
        model: params.repair.model
      });
      const repair = await this.attemptRepair(params, child, outcome, preMergeFindings);
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
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          preMergeFindings
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
      return this.finalize(params, "validation_failed", {
        repairAttempted,
        repairResult,
        preMergeFindings,
        parentValidation: validation
      });
    }

    const integrationCommitSha = await this.git.head(worktree.path);
    const status: IntegrationStatus = anyRepairSucceeded ? "executor_repair_success" : "success";
    execLog("integrate", "integration complete", {
      task: compositeTaskId,
      status,
      integrationCommit: integrationCommitSha,
      repairAttempted,
      preMergeFindings: preMergeFindings.length
    });
    return this.finalize(params, status, {
      repairAttempted,
      repairResult,
      integrationCommitSha,
      preMergeFindings,
      ...(validation !== undefined ? { parentValidation: validation } : {})
    });
  }

  private async attemptRepair(
    params: IntegrationParams,
    child: AgentExecutionResult,
    conflict: { conflictFiles: string[]; output: string },
    preMergeFindings: PreMergeFinding[]
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

    this.traceStore.append({
      type: "executor_repair_started",
      actor: "system",
      taskId: params.compositeTaskId,
      payload: {
        executorId: selection.executorId,
        model: selection.model,
        usageSource,
        childTaskId: child.taskId,
        files: conflict.conflictFiles
      }
    });

    const baseHead = await this.git.head(worktree.path);
    const instructionFilePath = join(
      tmpdir(),
      `mh-repair-${params.compositeTaskId}-${child.taskId}.txt`
    );
    await this.writeInstructions(
      instructionFilePath,
      this.buildRepairPrompt(params, child, conflict, preMergeFindings)
    );

    const executor = this.executorFactory.create(selection);
    const executorOutcome = await executor.execute({
      cwd: worktree.path,
      instructionFilePath,
      model: selection.model,
      timeoutMs: params.repair.timeoutMs,
      sandboxMode: params.repair.sandboxMode,
      bypassApprovals: params.repair.bypassApprovals ?? true,
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
      return {
        ok: false,
        result: this.buildRepairResult(child.taskId, "executor_error", baseHead, baseHead, outcomeWithUsage)
      };
    }

    await this.git.addAll(worktree.path);
    const changedFiles = await this.git.diffCachedNameOnly(worktree.path);
    const diff = await this.git.diffCached(worktree.path);
    execLog("integrate", "repair produced diff", {
      task: params.compositeTaskId,
      child: child.taskId,
      changedFiles
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

    const commitSha = await this.git.commit({
      cwd: worktree.path,
      message: `mh-integrate: ${params.compositeTaskId} <- ${child.taskId}`
    });
    execLog("integrate", "repair committed", {
      task: params.compositeTaskId,
      child: child.taskId,
      commit: commitSha
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
    const result = await this.validationRunner.run(commands, {
      worktreePath: params.worktree.path,
      repoRoot: this.repoRoot
    });
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
   * Contract-aware repair prompt (thesis Artifact 2). Unlike a syntactic merge
   * resolver, this gives the agent the WHY: the parent's goal, the canonical shared
   * interfaces the children must honour, and each conflicting child's intent. A
   * cherry-pick conflict here is a violation of the shared seam, resolved by
   * reference to the canonical contract rather than guessed from the diff text.
   */
  private buildRepairPrompt(
    params: IntegrationParams,
    child: AgentExecutionResult,
    conflict: { conflictFiles: string[]; output: string },
    preMergeFindings: PreMergeFinding[]
  ): string {
    const lines: string[] = [
      "You are resolving a git cherry-pick conflict during automated integration of a composite task.",
      `The change from task "${child.taskId}" conflicts with the already-integrated parent branch.`
    ];

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
    }
  ): IntegrationResult {
    this.traceStore.append({
      type: "integration_completed",
      actor: "system",
      taskId: params.compositeTaskId,
      payload: { status }
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
      parentValidation: extra.parentValidation
    });
  }
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
