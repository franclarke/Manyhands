import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionScope, ExecutionValidationCommand, InterfaceContract } from "@manyhands/contracts";
import type { TraceStore } from "@manyhands/trace-store";

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
  type ValidationRunResult,
  type WorktreeRecord
} from "../types";
import type { ValidationRunner } from "../validation/runner";
import { ChildProcessValidationRunner } from "../validation/runner";

export interface IntegrationAgentDeps {
  git: GitRunner;
  executor: AgentExecutor;
  traceStore: TraceStore;
  repoRoot: string;
  validationRunner?: ValidationRunner;
  scopeChecker?: ScopeChecker;
  /** Writes the repair instructions file. Injectable for tests. */
  writeInstructions?: (path: string, content: string) => Promise<void>;
  now?: () => string;
}

export interface IntegrationRepairConfig {
  model: string;
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
}

/**
 * Integrates completed children into the parent branch via cherry-pick, with a
 * single agent repair attempt per conflict (D8 / ADR-0025). git diff stays the
 * source of truth (D5) and the orchestrator — never the agent — commits (D6).
 */
export class IntegrationAgent {
  private readonly git: GitRunner;
  private readonly executor: AgentExecutor;
  private readonly traceStore: TraceStore;
  private readonly repoRoot: string;
  private readonly validationRunner: ValidationRunner;
  private readonly scopeChecker: ScopeChecker;
  private readonly writeInstructions: (path: string, content: string) => Promise<void>;

  constructor(deps: IntegrationAgentDeps) {
    this.git = deps.git;
    this.executor = deps.executor;
    this.traceStore = deps.traceStore;
    this.repoRoot = deps.repoRoot;
    this.validationRunner = deps.validationRunner ?? new ChildProcessValidationRunner();
    this.scopeChecker = deps.scopeChecker ?? new ScopeChecker();
    this.writeInstructions = deps.writeInstructions ?? ((path, content) => writeFile(path, content, "utf8"));
  }

  async integrate(params: IntegrationParams): Promise<IntegrationResult> {
    const { compositeTaskId, worktree, childResults } = params;
    const childTaskIds = childResults.map((child) => child.taskId);

    this.traceStore.append({
      type: "integration_started",
      actor: "system",
      taskId: compositeTaskId,
      payload: { childTaskIds }
    });

    // Any non-successful child means we never start integration (ADR-0025).
    const failedChild = childResults.find((child) => child.status !== "success");
    if (failedChild) {
      return this.finalize(params, "child_failed", { repairAttempted: false });
    }

    let repairAttempted = false;
    let anyRepairSucceeded = false;
    let repairResult: AgentExecutionResult | undefined;

    for (const child of childResults) {
      if (!child.commitSha) {
        continue;
      }

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
        continue;
      }

      // Conflict: one repair attempt only.
      this.traceStore.append({
        type: "cherry_pick_conflict",
        actor: "system",
        taskId: compositeTaskId,
        payload: { childTaskId: child.taskId, files: outcome.conflictFiles, output: outcome.output }
      });

      if (repairAttempted) {
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output }
        });
      }
      repairAttempted = true;

      const repair = await this.attemptRepair(params, child, outcome);
      repairResult = repair.result;
      if (!repair.ok) {
        return this.finalize(params, "executor_repair_failed", {
          repairAttempted: true,
          repairResult,
          conflictDetails: { files: outcome.conflictFiles, cherryPickOutput: outcome.output }
        });
      }
      anyRepairSucceeded = true;
    }

    // Parent validation runs once over the fully-integrated branch.
    const validation = await this.runParentValidation(params);
    if (validation && !validation.passed) {
      return this.finalize(params, "validation_failed", { repairAttempted, repairResult });
    }

    const integrationCommitSha = await this.git.head(worktree.path);
    const status: IntegrationStatus = anyRepairSucceeded ? "executor_repair_success" : "success";
    return this.finalize(params, status, {
      repairAttempted,
      repairResult,
      integrationCommitSha
    });
  }

  private async attemptRepair(
    params: IntegrationParams,
    child: AgentExecutionResult,
    conflict: { conflictFiles: string[]; output: string }
  ): Promise<{ ok: boolean; result: AgentExecutionResult }> {
    const { worktree } = params;
    await this.git.cherryPickAbort(worktree.path);

    this.traceStore.append({
      type: "executor_repair_started",
      actor: "system",
      taskId: params.compositeTaskId,
      payload: { childTaskId: child.taskId, files: conflict.conflictFiles }
    });

    const baseHead = await this.git.head(worktree.path);
    const instructionFilePath = join(
      tmpdir(),
      `mh-repair-${params.compositeTaskId}-${child.taskId}.txt`
    );
    await this.writeInstructions(
      instructionFilePath,
      this.buildRepairPrompt(params, child, conflict)
    );

    const executorOutcome = await this.executor.execute({
      cwd: worktree.path,
      instructionFilePath,
      model: params.repair.model,
      timeoutMs: params.repair.timeoutMs,
      sandboxMode: params.repair.sandboxMode,
      bypassApprovals: params.repair.bypassApprovals ?? true
    });

    if (executorOutcome.timedOut || executorOutcome.exitCode !== 0) {
      return {
        ok: false,
        result: this.buildRepairResult(child.taskId, "executor_error", baseHead, baseHead, executorOutcome)
      };
    }

    await this.git.addAll(worktree.path);
    const changedFiles = await this.git.diffCachedNameOnly(worktree.path);
    const diff = await this.git.diffCached(worktree.path);

    const scopeCheck = this.scopeChecker.check({
      changedFiles,
      executionScope: params.executionScope,
      forbiddenPaths: params.forbiddenPaths
    });
    if (!scopeCheck.passed) {
      return {
        ok: false,
        result: this.buildRepairResult(
          child.taskId,
          "scope_violation",
          baseHead,
          baseHead,
          executorOutcome,
          { diff, changedFiles, scopeCheck }
        )
      };
    }

    const commitSha = await this.git.commit({
      cwd: worktree.path,
      message: `mh-integrate: ${params.compositeTaskId} <- ${child.taskId}`
    });

    return {
      ok: true,
      result: this.buildRepairResult(child.taskId, "success", baseHead, commitSha, executorOutcome, {
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
    return this.validationRunner.run(commands, {
      worktreePath: params.worktree.path,
      repoRoot: this.repoRoot
    });
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
    conflict: { conflictFiles: string[]; output: string }
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
    executorOutcome: { exitCode: number; durationMs: number; timedOut: boolean; stdout?: string; stderr?: string; tokensIn?: number; tokensOut?: number; costUsd?: number },
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
      costUsd: executorOutcome.costUsd
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
      repairResult: extra.repairResult
    });
  }
}
