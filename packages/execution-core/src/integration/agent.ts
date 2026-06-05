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
    console.log(
      `[IntegrationAgent] Start composite=${compositeTaskId} children=${formatIdList(childTaskIds)} worktree=${worktree.path}`
    );

    this.traceStore.append({
      type: "integration_started",
      actor: "system",
      taskId: compositeTaskId,
      payload: { childTaskIds }
    });

    // Any non-successful child means we never start integration (ADR-0025).
    const failedChild = childResults.find((child) => child.status !== "success");
    if (failedChild) {
      console.warn(
        `[IntegrationAgent] Abort composite=${compositeTaskId}: child=${failedChild.taskId} status=${failedChild.status}`
      );
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
        console.warn(
          `[IntegrationAgent] Skip child without commit composite=${compositeTaskId} child=${child.taskId} status=${child.status}`
        );
        continue;
      }

      console.log(
        `[IntegrationAgent] Cherry-pick start composite=${compositeTaskId} child=${child.taskId} commit=${child.commitSha}`
      );
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
        console.log(`[IntegrationAgent] Cherry-pick ok composite=${compositeTaskId} child=${child.taskId}`);
        continue;
      }

      console.warn(
        `[IntegrationAgent] Cherry-pick conflict composite=${compositeTaskId} child=${child.taskId} files=${formatIdList(outcome.conflictFiles)} output=${tailForLog(outcome.output)}`
      );
      // Conflict: one repair attempt only.
      this.traceStore.append({
        type: "cherry_pick_conflict",
        actor: "system",
        taskId: compositeTaskId,
        payload: { childTaskId: child.taskId, files: outcome.conflictFiles, output: outcome.output }
      });

      if (repairAttempted) {
        console.error(
          `[IntegrationAgent] Repair already attempted; failing composite=${compositeTaskId} child=${child.taskId}`
        );
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          preMergeFindings
        });
      }
      repairAttempted = true;

      const repair = await this.attemptRepair(params, child, outcome, preMergeFindings);
      repairResult = repair.result;
      if (!repair.ok) {
        console.error(
          `[IntegrationAgent] Repair failed composite=${compositeTaskId} child=${child.taskId} status=${repair.result.status} exitCode=${repair.result.executorExitCode} stderr=${tailForLog(repair.result.stderrTail ?? "")}`
        );
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output },
          preMergeFindings
        });
      }
      console.log(
        `[IntegrationAgent] Repair ok composite=${compositeTaskId} child=${child.taskId} commit=${repair.result.commitSha ?? "(none)"}`
      );
      anyRepairSucceeded = true;
    }

    // Parent validation runs once over the fully-integrated branch.
    const validation = await this.runParentValidation(params);
    if (validation && !validation.passed) {
      console.warn(
        `[IntegrationAgent] Parent validation failed composite=${compositeTaskId} exitCode=${validation.exitCode} output=${tailForLog(validation.output)}`
      );
      return this.finalize(params, "validation_failed", {
        repairAttempted,
        repairResult,
        preMergeFindings,
        parentValidation: validation
      });
    }

    const integrationCommitSha = await this.git.head(worktree.path);
    const status: IntegrationStatus = anyRepairSucceeded ? "executor_repair_success" : "success";
    console.log(
      `[IntegrationAgent] Complete composite=${compositeTaskId} status=${status} integrationCommit=${integrationCommitSha} repairAttempted=${repairAttempted} preMergeFindings=${preMergeFindings.length}`
    );
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
    console.log(
      `[IntegrationAgent] Repair start composite=${params.compositeTaskId} child=${child.taskId} executor=${selection.executorId} model=${selection.model} files=${formatIdList(conflict.conflictFiles)} findings=${preMergeFindings.length}`
    );

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
      ...(params.signal !== undefined ? { signal: params.signal } : {})
    });
    const outcomeWithUsage = { ...executorOutcome, usageSource };

    if (executorOutcome.timedOut || executorOutcome.exitCode !== 0) {
      console.error(
        `[IntegrationAgent] Repair executor failed composite=${params.compositeTaskId} child=${child.taskId} exitCode=${executorOutcome.exitCode} timedOut=${executorOutcome.timedOut} stderr=${tailForLog(executorOutcome.stderr)}`
      );
      return {
        ok: false,
        result: this.buildRepairResult(child.taskId, "executor_error", baseHead, baseHead, outcomeWithUsage)
      };
    }

    await this.git.addAll(worktree.path);
    const changedFiles = await this.git.diffCachedNameOnly(worktree.path);
    const diff = await this.git.diffCached(worktree.path);
    console.log(
      `[IntegrationAgent] Repair diff composite=${params.compositeTaskId} child=${child.taskId} changedFiles=${formatIdList(changedFiles)}`
    );

    const scopeCheck = this.scopeChecker.check({
      changedFiles,
      executionScope: params.executionScope,
      forbiddenPaths: params.forbiddenPaths
    });
    if (!scopeCheck.passed) {
      console.warn(
        `[IntegrationAgent] Repair scope failed composite=${params.compositeTaskId} child=${child.taskId} violations=${formatIdList(scopeCheck.violations)}`
      );
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
    console.log(
      `[IntegrationAgent] Repair commit composite=${params.compositeTaskId} child=${child.taskId} commit=${commitSha}`
    );

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
    console.log(
      `[IntegrationAgent] Parent validation start composite=${params.compositeTaskId} commandCount=${commands.length}`
    );
    const result = await this.validationRunner.run(commands, {
      worktreePath: params.worktree.path,
      repoRoot: this.repoRoot
    });
    const level = result.passed ? "log" : "warn";
    console[level](
      `[IntegrationAgent] Parent validation complete composite=${params.compositeTaskId} passed=${result.passed} exitCode=${result.exitCode} output=${tailForLog(result.output)}`
    );
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

function formatIdList(values: readonly string[]): string {
  return values.length === 0 ? "(none)" : values.join(",");
}

function tailForLog(value: string | undefined): string {
  if (value === undefined || value.length === 0) {
    return "(empty)";
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 500 ? normalized.slice(-500) : normalized;
}
