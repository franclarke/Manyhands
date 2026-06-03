import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionValidationCommand } from "@manyhands/contracts";
import { scheduleTasks, type SchedulingPolicy } from "@manyhands/scheduler";
import { nowIso } from "@manyhands/shared";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import type { TraceStore } from "@manyhands/trace-store";

import type { AgentExecutor } from "../executor/types";
import type { GitRunner } from "../git/runner";
import { FileSystemContextPacker, type ContextPacker } from "../context/packer";
import { RunExecutionError } from "../errors";
import { computeGranularityVector } from "../granularity/vector";
import { assertExecutableGraph } from "./graph-guards";
import { IntegrationAgent } from "../integration/agent";
import { ResultRecorder } from "../result/recorder";
import { BatchScheduler } from "../scheduler/batch";
import {
  type AgentExecutionResult,
  type ExecutionConfig,
  type GranularityVector,
  type IntegrationResult,
  type ValidationRunResult,
  type WorktreeRecord
} from "../types";
import { ChildProcessValidationRunner, type ValidationRunner } from "../validation/runner";
import { WorktreeManager } from "../worktree/manager";

export interface RunExecutorDeps {
  git: GitRunner;
  executor: AgentExecutor;
  traceStore: TraceStore;
  repoRoot: string;
  worktreeManager?: WorktreeManager;
  resultRecorder?: ResultRecorder;
  integrationAgent?: IntegrationAgent;
  validationRunner?: ValidationRunner;
  batchScheduler?: BatchScheduler;
  /** Packs target-file context into leaf instructions. Injectable for tests. */
  contextPacker?: ContextPacker;
  /** Writes the leaf/repair instructions file. Injectable for tests. */
  writeInstructions?: (path: string, content: string) => Promise<void>;
  clock?: () => number;
  now?: () => string;
}

export interface RunExecutionParams {
  graph: TaskGraph;
  config: ExecutionConfig;
  model: string;
  runId?: string;
  policy?: SchedulingPolicy;
}

export interface RunExecutionResult {
  runId: string;
  status: "completed" | "failed";
  leafResults: AgentExecutionResult[];
  integrationResults: IntegrationResult[];
  granularityVector: GranularityVector;
  validationResult?: ValidationRunResult;
  totalDurationMs: number;
}

const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);
const GEMINI_EXECUTOR_ID = "gemini-cli";

export interface ResolvedExecutorModel {
  executorId: typeof GEMINI_EXECUTOR_ID;
  model: string;
}

export function resolveExecutorModel(node: TaskNode, defaultModel: string): ResolvedExecutorModel {
  const override = node.metadata?.executorOverride;
  if (isGeminiExecutorOverride(override)) {
    return { executorId: GEMINI_EXECUTOR_ID, model: override.model };
  }
  return { executorId: GEMINI_EXECUTOR_ID, model: defaultModel };
}

/**
 * Top-level orchestrator (D5-D10). Schedules leaves into batches, runs each in
 * an isolated worktree via the agent executor (Gemini CLI), records the git-diff
 * result (D5) and commits
 * on the orchestrator's behalf (D6), integrates children bottom-up via
 * cherry-pick (D8), runs run-level validation, and emits run_completed plus the
 * experiment's GranularityVector. Leaf worktrees are kept until after
 * integration so their commits stay reachable for cherry-pick, then cleaned.
 */
export class RunExecutor {
  private readonly git: GitRunner;
  private readonly executor: AgentExecutor;
  private readonly traceStore: TraceStore;
  private readonly repoRoot: string;
  private readonly worktreeManager: WorktreeManager;
  private readonly resultRecorder: ResultRecorder;
  private readonly integrationAgent: IntegrationAgent;
  private readonly validationRunner: ValidationRunner;
  private readonly batchScheduler: BatchScheduler;
  private readonly contextPacker: ContextPacker;
  private readonly writeInstructions: (path: string, content: string) => Promise<void>;
  private readonly clock: () => number;

  constructor(deps: RunExecutorDeps) {
    this.git = deps.git;
    this.executor = deps.executor;
    this.traceStore = deps.traceStore;
    this.repoRoot = deps.repoRoot;
    this.worktreeManager =
      deps.worktreeManager ?? new WorktreeManager({ git: deps.git, repoRoot: deps.repoRoot });
    this.resultRecorder =
      deps.resultRecorder ?? new ResultRecorder({ git: deps.git, traceStore: deps.traceStore });
    this.validationRunner = deps.validationRunner ?? new ChildProcessValidationRunner();
    this.integrationAgent =
      deps.integrationAgent ??
      new IntegrationAgent({
        git: deps.git,
        executor: deps.executor,
        traceStore: deps.traceStore,
        repoRoot: deps.repoRoot,
        validationRunner: this.validationRunner
      });
    this.batchScheduler =
      deps.batchScheduler ?? new BatchScheduler({ traceStore: deps.traceStore });
    this.contextPacker = deps.contextPacker ?? new FileSystemContextPacker();
    this.writeInstructions = deps.writeInstructions ?? ((path, content) => writeFile(path, content, "utf8"));
    this.clock = deps.clock ?? (() => Date.now());
  }

  async run(params: RunExecutionParams): Promise<RunExecutionResult> {
    const { graph, config } = params;
    const runId = params.runId ?? graph.planId;

    // I7: reject a malformed graph before creating any worktree.
    assertExecutableGraph(graph);

    const startMs = this.clock();

    // Worktrees are declared before the try so the finally can always clean
    // them — even if a leaf/integration/validation step throws (I1).
    const worktrees: WorktreeRecord[] = [];
    try {
      const plan = scheduleTasks({
        graph,
        contracts: {},
        riskMatrix: [],
        maxParallel: config.maxParallel,
        policy: params.policy ?? "parallel_naive"
      });

      const leafResultMap = await this.batchScheduler.runBatches({
        batches: plan.batches.map((batch) => ({ id: batch.id, taskIds: batch.taskIds })),
        runTask: async (taskId) => {
          const node = graph.nodes[taskId];
          if (!node) {
            throw new RunExecutionError(
              `Scheduled task "${taskId}" is not in the graph.`,
              "schedule",
              runId
            );
          }
          return this.executeLeaf({ graph, node, runId, config, model: params.model, worktrees });
        }
      });

      const leafResults = plan.batches
        .flatMap((batch) => batch.taskIds)
        .map((taskId) => leafResultMap.get(taskId))
        .filter((result): result is AgentExecutionResult => result !== undefined);

      const integrationResults = await this.integrateBottomUp({
        graph,
        runId,
        config,
        model: params.model,
        leafResults,
        worktrees
      });

      const validationResult = await this.runRunValidation(
        graph,
        this.resolveRunValidationCwd(graph, worktrees)
      );

      const totalDurationMs = this.clock() - startMs;
      const status = this.deriveStatus(leafResults, integrationResults, validationResult);

      this.traceStore.append({
        type: "run_completed",
        actor: "system",
        payload: {
          runId,
          status,
          leafCount: leafResults.length,
          integrationCount: integrationResults.length,
          durationMs: totalDurationMs
        }
      });

      const granularityVector = computeGranularityVector({
        graph,
        leafResults,
        integrationResults,
        totalDurationMs
      });

      return {
        runId,
        status,
        leafResults,
        integrationResults,
        granularityVector,
        ...(validationResult ? { validationResult } : {}),
        totalDurationMs
      };
    } finally {
      await this.cleanupWorktrees(worktrees);
    }
  }

  private async executeLeaf(args: {
    graph: TaskGraph;
    node: TaskNode;
    runId: string;
    config: ExecutionConfig;
    model: string;
    worktrees: WorktreeRecord[];
  }): Promise<AgentExecutionResult> {
    const { node, runId, config, model } = args;
    const executorModel = resolveExecutorModel(node, model);

    this.traceStore.append({ type: "agent_started", actor: "system", taskId: node.id, payload: {} });

    const worktree = await this.worktreeManager.create({
      taskId: node.id,
      runId,
      kind: "leaf",
      baseCommit: args.graph.baseCommit
    });
    args.worktrees.push(worktree);
    this.traceStore.append({
      type: "worktree_created",
      actor: "system",
      taskId: node.id,
      payload: { path: worktree.path, branch: worktree.branch }
    });

    const context = await this.contextPacker.pack({
      worktreePath: worktree.path,
      files: node.contract?.expectedOutput.changedFiles ?? []
    });
    this.traceStore.append({
      type: "context_packed",
      actor: "system",
      taskId: node.id,
      payload: { includedFiles: context.includedFiles, totalBytes: context.totalBytes }
    });

    const instructionFilePath = join(tmpdir(), `mh-${runId}-${node.id}.txt`);
    await this.writeInstructions(instructionFilePath, buildLeafInstructions(node, context.section));

    this.traceStore.append({
      type: "executor_started",
      actor: "system",
      taskId: node.id,
      payload: { executorId: executorModel.executorId, model: executorModel.model }
    });
    const executorOutcome = await this.executor.execute({
      cwd: worktree.path,
      instructionFilePath,
      model: executorModel.model,
      timeoutMs: config.leafTimeoutMs,
      sandboxMode: config.sandboxMode,
      bypassApprovals: true
    });
    this.traceStore.append({
      type: "executor_completed",
      actor: "system",
      taskId: node.id,
      payload: {
        executorId: executorModel.executorId,
        model: executorModel.model,
        exitCode: executorOutcome.exitCode,
        timedOut: executorOutcome.timedOut
      }
    });

    const contract = node.contract;
    return this.resultRecorder.record({
      worktree,
      executorOutcome,
      unexpectedCommitPolicy: config.unexpectedCommitPolicy,
      commitMessage: `mh: ${node.id}`,
      ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
      ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {})
    });
  }

  private async integrateBottomUp(args: {
    graph: TaskGraph;
    runId: string;
    config: ExecutionConfig;
    model: string;
    leafResults: AgentExecutionResult[];
    worktrees: WorktreeRecord[];
  }): Promise<IntegrationResult[]> {
    const { graph, runId, config, model } = args;
    const resultByTask = new Map<string, AgentExecutionResult>(
      args.leafResults.map((result) => [result.taskId, result])
    );

    const composites = Object.values(graph.nodes)
      .filter((node) => node.kind !== "leaf" && node.childrenIds.length > 0)
      .sort((a, b) => b.depth - a.depth);

    const integrationResults: IntegrationResult[] = [];

    for (const composite of composites) {
      const childResults = composite.childrenIds
        .map((childId) => resultByTask.get(childId))
        .filter((result): result is AgentExecutionResult => result !== undefined);

      const worktree = await this.worktreeManager.create({
        taskId: composite.id,
        runId,
        kind: "integration",
        baseCommit: graph.baseCommit
      });
      args.worktrees.push(worktree);
      this.traceStore.append({
        type: "worktree_created",
        actor: "system",
        taskId: composite.id,
        payload: { path: worktree.path, branch: worktree.branch }
      });

      const contract = composite.contract;
      const repairModel = resolveExecutorModel(composite, model);
      // Contract-aware composition (Artifact 2): hand the Composer the parent goal,
      // the canonical seams defined at this composite, and each child's intent so
      // conflict repair resolves by reference to the contract, not the diff text.
      const sharedInterfaces = contract?.producedInterfaces;
      const childIntents = composite.childrenIds
        .map((childId) => graph.nodes[childId])
        .filter((child): child is TaskNode => child !== undefined)
        .map((child) => ({
          taskId: child.id,
          goal: child.goal,
          consumes: child.contract?.consumedInterfaces?.map((i) => i.id) ?? [],
          produces: child.contract?.producedInterfaces?.map((i) => i.id) ?? []
        }));
      const result = await this.integrationAgent.integrate({
        compositeTaskId: composite.id,
        worktree,
        childResults,
        repair: { model: repairModel.model, sandboxMode: config.sandboxMode, timeoutMs: config.integrationTimeoutMs },
        parentGoal: composite.goal,
        childIntents,
        ...(sharedInterfaces ? { sharedInterfaces } : {}),
        ...(contract?.parentValidationCommands
          ? { parentValidationCommands: contract.parentValidationCommands }
          : {}),
        ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
        ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {})
      });
      integrationResults.push(result);

      // A successfully integrated composite becomes a child for its own parent.
      if (INTEGRATION_SUCCESS.has(result.status) && result.integrationCommitSha) {
        resultByTask.set(
          composite.id,
          syntheticCompositeResult(composite.id, graph.baseCommit, result.integrationCommitSha)
        );
      } else {
        // Preserve failed composite state for ancestors. Without a synthetic
        // failed result, a parent with only failed composite children sees an
        // empty childResults array and may incorrectly proceed to validation.
        resultByTask.set(
          composite.id,
          syntheticFailedCompositeResult(composite.id, graph.baseCommit)
        );
      }
    }

    return integrationResults;
  }

  /**
   * Run-level validation must execute against the fully-integrated tree — the
   * root composite's integration worktree (I6), not an arbitrary leaf. Falls
   * back to the first leaf's worktree (single-leaf runs with no composite) or
   * the repo root. Note: in Etapa 2A nothing is merged back to repoRoot, so the
   * repoRoot fallback only sees the base tree.
   */
  private resolveRunValidationCwd(graph: TaskGraph, worktrees: WorktreeRecord[]): string {
    const rootIntegration = worktrees.find(
      (worktree) => worktree.kind === "integration" && worktree.taskId === graph.rootId
    );
    return rootIntegration?.path ?? worktrees[0]?.path ?? this.repoRoot;
  }

  private async runRunValidation(
    graph: TaskGraph,
    worktreePath: string
  ): Promise<ValidationRunResult | undefined> {
    const commands = collectRunValidationCommands(graph);
    if (commands.length === 0) {
      return undefined;
    }
    this.traceStore.append({
      type: "validation_started",
      actor: "system",
      payload: { scope: "run", commandCount: commands.length }
    });
    return this.validationRunner.run(commands, { worktreePath, repoRoot: this.repoRoot });
  }

  private async cleanupWorktrees(worktrees: WorktreeRecord[]): Promise<void> {
    for (const worktree of worktrees) {
      try {
        await this.worktreeManager.clean(worktree);
      } catch (error) {
        // I8: a cleanup failure must never mask the run result. Record it on the
        // trace and keep cleaning the rest (best-effort).
        this.traceStore.append({
          type: "worktree_clean_failed",
          actor: "system",
          taskId: worktree.taskId,
          payload: {
            path: worktree.path,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
    }
  }

  private deriveStatus(
    leafResults: AgentExecutionResult[],
    integrationResults: IntegrationResult[],
    validationResult: ValidationRunResult | undefined
  ): "completed" | "failed" {
    const leavesOk = leafResults.every((result) => result.status === "success");
    const integrationsOk = integrationResults.every((result) =>
      INTEGRATION_SUCCESS.has(result.status)
    );
    const validationOk = validationResult ? validationResult.passed : true;
    return leavesOk && integrationsOk && validationOk ? "completed" : "failed";
  }
}

function buildLeafInstructions(node: TaskNode, contextSection?: string): string {
  const contract = node.contract;
  const lines = [contract?.objective ?? node.prompt ?? node.goal];

  const acceptance = node.acceptanceCriteria ?? [];
  if (acceptance.length > 0) {
    lines.push("", "Acceptance criteria:", ...acceptance.map((c) => `- ${c}`));
  }

  // Communicate the exact scope the orchestrator will enforce after the run, so
  // the agent knows what it may and must not touch (mirrors the ScopeChecker).
  if (contract?.executionScope) {
    const allowed = [
      ...contract.executionScope.implementationPaths,
      ...contract.executionScope.testPaths,
      ...contract.executionScope.configPaths
    ];
    if (allowed.length > 0) {
      lines.push("", "You may only modify files matching:", ...allowed.map((p) => `- ${p}`));
    }
  }
  if (contract?.forbiddenPaths && contract.forbiddenPaths.length > 0) {
    lines.push("", "You must NOT modify:", ...contract.forbiddenPaths.map((p) => `- ${p}`));
  }
  // Seams: the exact interfaces this leaf must build against (produced by
  // sibling/ancestor tasks) and the ones it must expose. This is what lets
  // parallel leaves compose without colliding — they share a fixed contract
  // instead of each inventing its own. See the decomposer/composer redesign.
  const consumed = contract?.consumedInterfaces ?? [];
  if (consumed.length > 0) {
    lines.push(
      "",
      "Other tasks are producing these interfaces. Build EXACTLY against these signatures;",
      "do not invent your own version:",
      ...consumed.map((i) => `- ${i.id} (${i.kind}): ${i.signature}\n  ${i.description}`)
    );
  }
  const produced = contract?.producedInterfaces ?? [];
  if (produced.length > 0) {
    lines.push(
      "",
      "Your work MUST expose these interfaces exactly as specified, because other tasks depend on them:",
      ...produced.map((i) => `- ${i.id} (${i.kind}): ${i.signature}\n  ${i.description}`)
    );
  }

  if (contract?.definitionOfDone) {
    lines.push("", `Definition of done: ${contract.definitionOfDone}`);
  }

  if (contextSection && contextSection.length > 0) {
    lines.push("", contextSection);
  }

  lines.push("", "Do not commit — the orchestrator will commit your changes.");
  return lines.join("\n");
}

function collectRunValidationCommands(graph: TaskGraph): ExecutionValidationCommand[] {
  const root = graph.nodes[graph.rootId];
  return root?.contract?.runValidationCommands ?? [];
}

function isGeminiExecutorOverride(value: unknown): value is { executorId: typeof GEMINI_EXECUTOR_ID; model: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { executorId?: unknown; model?: unknown };
  return (
    candidate.executorId === GEMINI_EXECUTOR_ID &&
    typeof candidate.model === "string" &&
    candidate.model.trim().length > 0
  );
}

function syntheticCompositeResult(
  taskId: string,
  baseHead: string,
  commitSha: string
): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead,
    currentHead: commitSha,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    commitSha,
    scopeCheck: { passed: true, violations: [] },
    executorExitCode: 0,
    executorDurationMs: 0,
    executorTimedOut: false
  };
}

function syntheticFailedCompositeResult(
  taskId: string,
  baseHead: string
): AgentExecutionResult {
  return {
    taskId,
    status: "internal_error",
    baseHead,
    currentHead: baseHead,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    scopeCheck: { passed: true, violations: [] },
    executorExitCode: 1,
    executorDurationMs: 0,
    executorTimedOut: false,
    stderrTail: "Composite integration failed before producing an integration commit."
  };
}
