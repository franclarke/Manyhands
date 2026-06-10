import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionValidationCommand } from "@manyhands/contracts";
import { scheduleTasks, type SchedulingPolicy } from "@manyhands/scheduler";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import type { TraceStore } from "@manyhands/trace-store";

import { FixedAgentExecutorFactory, type AgentExecutorFactory } from "../executor/factory";
import { AGENT_STATUS_PROTOCOL_INSTRUCTIONS } from "../executor/status-channel";
import type { AgentExecutor } from "../executor/types";
import {
  GEMINI_EXECUTOR_ID,
  normalizeExecutorSelection,
  resolveLegacyModelSelection,
  usageSourceForSelection,
  type ExecutorSelection
} from "../executor/registry";
import type { GitRunner } from "../git/runner";
import { FileSystemContextPacker, type ContextPacker } from "../context/packer";
import { execError, execLog, execWarn } from "../logging/log";
import { RunExecutionError } from "../errors";
import { computeGranularityVector } from "../granularity/vector";
import { assertExecutableGraph } from "./graph-guards";
import { IntegrationAgent, type PredictedConflictHint } from "../integration/agent";
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
  executor?: AgentExecutor;
  executorFactory?: AgentExecutorFactory;
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
  defaultExecutionSelection?: ExecutorSelection;
  defaultRepairSelection?: ExecutorSelection;
  runId?: string;
  policy?: SchedulingPolicy;
  /** Run-level cancellation: aborts in-flight executors and stops scheduling. */
  signal?: AbortSignal;
  /** Awaited at each batch boundary (pause hold); resolves to continue. */
  onBatchBoundary?: () => Promise<void>;
  /** Conflicts predicted at planning time; threaded into the conflict-aware composer. */
  predictedConflicts?: PredictedConflictHint[];
}

export interface RunNodeExecutionParams {
  graph: TaskGraph;
  config: ExecutionConfig;
  model: string;
  taskId: string;
  runId?: string;
  childResults?: AgentExecutionResult[];
  cleanupWorktrees?: boolean;
  /** Plan-time conflict foresight, threaded into the Composer's repair prompt. */
  predictedConflicts?: PredictedConflictHint[];
}

export type RunNodeExecutionResult =
  | { kind: "leaf"; result: AgentExecutionResult; worktrees: WorktreeRecord[] }
  | { kind: "integration"; result: IntegrationResult; worktrees: WorktreeRecord[] };

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

export function resolveExecutorSelection(node: TaskNode, defaultSelection: ExecutorSelection): ExecutorSelection {
  const metadata = node.metadata as { executorSelection?: unknown; executorOverride?: unknown } | undefined;
  return (
    normalizeExecutorSelection(metadata?.executorSelection) ??
    normalizeExecutorSelection(metadata?.executorOverride) ??
    defaultSelection
  );
}

export function resolveExecutorModel(node: TaskNode, defaultModel: string): ExecutorSelection {
  return resolveExecutorSelection(node, { executorId: GEMINI_EXECUTOR_ID, model: defaultModel });
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
  private readonly executorFactory: AgentExecutorFactory;
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
    this.executorFactory =
      deps.executorFactory ?? new FixedAgentExecutorFactory(requireExecutor(deps.executor));
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
        executorFactory: this.executorFactory,
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

    const leafCount = Object.values(graph.nodes).filter((node) => node.kind === "leaf").length;
    const compositeCount = Object.values(graph.nodes).filter(
      (node) => node.kind !== "leaf" && node.childrenIds.length > 0
    ).length;
    execLog("run", "run started", {
      runId,
      graph: graph.id,
      root: graph.rootId,
      nodes: Object.keys(graph.nodes).length,
      leaves: leafCount,
      composites: compositeCount,
      maxParallel: config.maxParallel,
      baseCommit: graph.baseCommit,
      repoRoot: this.repoRoot
    });

    // I7: reject a malformed graph before creating any worktree.
    try {
      assertExecutableGraph(graph);
    } catch (error) {
      execError("run", "graph rejected before execution (not executable)", {
        runId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

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
      execLog("run", "scheduled", {
        runId,
        batches: plan.batches.length,
        tasks: formatTaskList(plan.batches.flatMap((batch) => batch.taskIds)),
        blocked: plan.blocked.length
      });

      const leafResultMap = await this.batchScheduler.runBatches({
        batches: plan.batches.map((batch) => ({ id: batch.id, taskIds: batch.taskIds })),
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
        ...(params.onBatchBoundary !== undefined ? { onBatchBoundary: params.onBatchBoundary } : {}),
        runTask: async (taskId) => {
          const node = graph.nodes[taskId];
          if (!node) {
            throw new RunExecutionError(
              `Scheduled task "${taskId}" is not in the graph.`,
              "schedule",
              runId
            );
          }
          return this.executeLeaf({
            graph,
            node,
            runId,
            config,
            defaultSelection: params.defaultExecutionSelection ?? resolveLegacyModelSelection(params.model),
            worktrees,
            ...(params.signal !== undefined ? { signal: params.signal } : {})
          });
        }
      });

      const leafResults = plan.batches
        .flatMap((batch) => batch.taskIds)
        .map((taskId) => leafResultMap.get(taskId))
        .filter((result): result is AgentExecutionResult => result !== undefined);
      execLog("run", "leaf phase complete", {
        runId,
        results: `${leafResults.length}/${plan.batches.flatMap((batch) => batch.taskIds).length}`,
        statuses: formatResultStatuses(leafResults)
      });

      // Cancellation: if the run was aborted during leaf execution, skip
      // integration + validation and return the partial result. The web runner's
      // cooperative guard already marks the run `interrupted`.
      if (params.signal?.aborted === true) {
        const abortedDurationMs = this.clock() - startMs;
        this.traceStore.append({
          type: "run_completed",
          actor: "system",
          payload: { runId, status: "failed", leafCount: leafResults.length, integrationCount: 0, durationMs: abortedDurationMs }
        });
        return {
          runId,
          status: "failed",
          leafResults,
          integrationResults: [],
          granularityVector: computeGranularityVector({ graph, leafResults, integrationResults: [], totalDurationMs: abortedDurationMs }),
          totalDurationMs: abortedDurationMs
        };
      }

      const integrationResults = await this.integrateBottomUp({
        graph,
        runId,
        config,
        defaultSelection: params.defaultRepairSelection ?? params.defaultExecutionSelection ?? resolveLegacyModelSelection(params.model),
        leafResults,
        worktrees,
        predictedConflicts: params.predictedConflicts ?? [],
        ...(params.signal !== undefined ? { signal: params.signal } : {})
      });
      execLog("run", "integration phase complete", {
        runId,
        results: integrationResults.length,
        statuses: formatIntegrationStatuses(integrationResults)
      });

      const validationResult = await this.runRunValidation(
        graph,
        this.resolveRunValidationCwd(graph, worktrees),
        runId
      );

      const totalDurationMs = this.clock() - startMs;
      const status = this.deriveStatus(leafResults, integrationResults, validationResult);

      const failedLeaves = leafResults.filter((result) => result.status !== "success");
      const failedIntegrations = integrationResults.filter(
        (result) => !INTEGRATION_SUCCESS.has(result.status)
      );
      const logRunDone = status === "completed" ? execLog : execWarn;
      logRunDone("run", `run ${status}`, {
        runId,
        status,
        durationMs: totalDurationMs,
        leaves: `${leafResults.length - failedLeaves.length}/${leafResults.length} ok`,
        integrations: `${integrationResults.length - failedIntegrations.length}/${integrationResults.length} ok`,
        validation: validationResult ? (validationResult.passed ? "passed" : "failed") : "none",
        ...(failedLeaves.length > 0
          ? { failedLeaves: failedLeaves.map((leaf) => `${leaf.taskId}:${leaf.status}`) }
          : {}),
        ...(failedIntegrations.length > 0
          ? { failedIntegrations: failedIntegrations.map((entry) => `${entry.compositeTaskId}:${entry.status}`) }
          : {})
      });

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

  async runNode(params: RunNodeExecutionParams): Promise<RunNodeExecutionResult> {
    const { graph, config, taskId } = params;
    const runId = params.runId ?? graph.planId;

    assertExecutableGraph(graph);

    const node = graph.nodes[taskId];
    if (!node) {
      throw new RunExecutionError(`Task "${taskId}" is not in the graph.`, "schedule", runId);
    }

    const worktrees: WorktreeRecord[] = [];
    try {
      if (node.kind === "leaf") {
        const result = await this.executeLeaf({
          graph,
          node,
          runId,
          config,
          defaultSelection: resolveLegacyModelSelection(params.model),
          worktrees
        });
        return { kind: "leaf", result, worktrees };
      }

      if (node.childrenIds.length === 0) {
        throw new RunExecutionError(
          `Composite task "${taskId}" has no children to integrate.`,
          "integration",
          runId
        );
      }

      const providedChildren = new Map((params.childResults ?? []).map((result) => [result.taskId, result]));
      const childResults = node.childrenIds
        .map((childId) => providedChildren.get(childId))
        .filter((result): result is AgentExecutionResult => result !== undefined);

      if (childResults.length !== node.childrenIds.length) {
        const missing = node.childrenIds.filter((childId) => !providedChildren.has(childId));
        throw new RunExecutionError(
          `Composite task "${taskId}" cannot integrate until all children have results. Missing: ${missing.join(", ")}.`,
          "integration",
          runId
        );
      }

      const worktree = await this.worktreeManager.create({
        taskId: node.id,
        runId,
        kind: "integration",
        baseCommit: graph.baseCommit
      });
      worktrees.push(worktree);
      this.traceStore.append({
        type: "worktree_created",
        actor: "system",
        taskId: node.id,
        payload: { path: worktree.path, branch: worktree.branch }
      });

      const contract = node.contract;
      const repairSelection = resolveExecutorSelection(node, resolveLegacyModelSelection(params.model));
      const sharedInterfaces = contract?.producedInterfaces;
      const childIntents = node.childrenIds
        .map((childId) => graph.nodes[childId])
        .filter((child): child is TaskNode => child !== undefined)
        .map((child) => ({
          taskId: child.id,
          goal: child.goal,
          consumes: child.contract?.consumedInterfaces?.map((i) => i.id) ?? [],
          produces: child.contract?.producedInterfaces?.map((i) => i.id) ?? []
        }));

      const result = await this.integrationAgent.integrate({
        compositeTaskId: node.id,
        worktree,
        childResults,
        repair: {
          selection: repairSelection,
          timeoutMs: config.integrationTimeoutMs
        },
        parentGoal: node.goal,
        childIntents,
        ...(sharedInterfaces ? { sharedInterfaces } : {}),
        ...(contract?.parentValidationCommands
          ? { parentValidationCommands: contract.parentValidationCommands }
          : {}),
        ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
        ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {}),
        ...(params.predictedConflicts !== undefined ? { predictedConflicts: params.predictedConflicts } : {})
      });

      return { kind: "integration", result, worktrees };
    } finally {
      if (params.cleanupWorktrees === true) {
        await this.cleanupWorktrees(worktrees);
      }
    }
  }

  /**
   * Repair a previously-executed leaf in its existing worktree: feeds the
   * validation failure back to the agent executor, records the new diff (D5),
   * commits on the orchestrator's behalf (D6) and re-runs leaf validation.
   * This is the auto-repair seam the execution graph's leaf deps call — the
   * web layer never assembles worktrees/recorders by hand.
   */
  async repairLeaf(params: {
    graph: TaskGraph;
    config: ExecutionConfig;
    model: string;
    taskId: string;
    runId?: string;
    validationOutput: string;
  }): Promise<{ result: AgentExecutionResult; worktree: WorktreeRecord }> {
    const { graph, config, taskId } = params;
    const runId = params.runId ?? graph.planId;
    const node = graph.nodes[taskId];
    if (!node) {
      throw new RunExecutionError(`Task "${taskId}" is not in the graph.`, "leaf", runId);
    }
    if (node.kind !== "leaf" && node.kind !== "integrator") {
      throw new RunExecutionError(`Task "${taskId}" is not executable (kind=${node.kind}).`, "leaf", runId);
    }

    const selection = resolveExecutorSelection(node, resolveLegacyModelSelection(params.model));
    const usageSource = usageSourceForSelection(selection);
    const executor = this.executorFactory.create(selection);
    const worktree = this.worktreeManager.recordFor({
      taskId: node.id,
      runId,
      kind: "leaf",
      baseCommit: graph.baseCommit
    });

    const instructionFilePath = join(tmpdir(), `mh-repair-${runId}-${node.id}.txt`);
    await this.writeInstructions(
      instructionFilePath,
      buildLeafRepairInstructions(node, params.validationOutput)
    );

    this.traceStore.append({
      type: "executor_repair_started",
      actor: "system",
      taskId: node.id,
      payload: { executorId: selection.executorId, model: selection.model, usageSource }
    });

    const executorOutcome = await executor.execute({
      cwd: worktree.path,
      instructionFilePath,
      model: selection.model,
      timeoutMs: config.leafTimeoutMs,
      bypassApprovals: true,
      onOutput: (chunk) => {
        this.traceStore.append({ type: "executor_output", actor: "agent", taskId: node.id, payload: chunk });
      },
      onAgentStatus: (status) => {
        this.traceStore.append({ type: "agent_status", actor: "agent", taskId: node.id, payload: { ...status } });
      }
    });

    this.traceStore.append({
      type: "executor_completed",
      actor: "system",
      taskId: node.id,
      payload: {
        executorId: selection.executorId,
        model: selection.model,
        usageSource,
        exitCode: executorOutcome.exitCode,
        timedOut: executorOutcome.timedOut
      }
    });

    const contract = node.contract;
    const recorded = await this.resultRecorder.record({
      worktree,
      executorOutcome,
      unexpectedCommitPolicy: config.unexpectedCommitPolicy,
      commitMessage: `mh-repair: ${node.id}`,
      ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
      ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {}),
      usageSource
    });

    const result = await this.runLeafValidation({ node, worktree, result: recorded, runId });
    return { result, worktree };
  }

  private async executeLeaf(args: {
    graph: TaskGraph;
    node: TaskNode;
    runId: string;
    config: ExecutionConfig;
    defaultSelection: ExecutorSelection;
    worktrees: WorktreeRecord[];
    signal?: AbortSignal;
  }): Promise<AgentExecutionResult> {
    const { node, runId } = args;
    const executorSelection = resolveExecutorSelection(node, args.defaultSelection);
    const usageSource = usageSourceForSelection(executorSelection);
    const executor = this.executorFactory.create(executorSelection);

    execLog("leaf", "dispatching leaf", {
      task: node.id,
      runId,
      model: executorSelection.model,
      depth: node.depth
    });

    this.traceStore.append({ type: "agent_started", actor: "system", taskId: node.id, payload: {} });

    let worktree: WorktreeRecord;
    try {
      worktree = await this.worktreeManager.create({
        taskId: node.id,
        runId,
        kind: "leaf",
        baseCommit: args.graph.baseCommit
      });
    } catch (error) {
      // A worktree-creation failure throws and aborts the whole batch/run via the
      // scheduler — log which leaf and why before it propagates.
      execError("leaf", "leaf aborted: worktree creation failed", {
        task: node.id,
        runId,
        baseCommit: args.graph.baseCommit,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
    args.worktrees.push(worktree);
    this.traceStore.append({
      type: "worktree_created",
      actor: "system",
      taskId: node.id,
      payload: { path: worktree.path, branch: worktree.branch }
    });

    try {
      return await this.executeLeafInWorktree({ ...args, worktree, executor, executorSelection, usageSource });
    } catch (error) {
      // Context packing, instruction writing, the executor seam and result
      // recording should all be total — a throw here is unexpected. Log it
      // against the task before it aborts the run.
      execError("leaf", "leaf aborted: unexpected error during execution", {
        task: node.id,
        runId,
        message: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private async executeLeafInWorktree(args: {
    graph: TaskGraph;
    node: TaskNode;
    runId: string;
    config: ExecutionConfig;
    defaultSelection: ExecutorSelection;
    worktrees: WorktreeRecord[];
    worktree: WorktreeRecord;
    executor: AgentExecutor;
    executorSelection: ExecutorSelection;
    usageSource: ReturnType<typeof usageSourceForSelection>;
    signal?: AbortSignal;
  }): Promise<AgentExecutionResult> {
    const { node, runId, config, worktree, executor, executorSelection, usageSource } = args;

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
      payload: {
        executorId: executorSelection.executorId,
        model: executorSelection.model,
        usageSource
      }
    });
    const executorOutcome = await executor.execute({
      cwd: worktree.path,
      instructionFilePath,
      model: executorSelection.model,
      timeoutMs: config.leafTimeoutMs,
      bypassApprovals: true,
      ...(args.signal !== undefined ? { signal: args.signal } : {}),
      onOutput: (chunk) => {
        this.traceStore.append({
          type: "executor_output",
          actor: "agent",
          taskId: node.id,
          payload: chunk
        });
      },
      // Send-to-user channel: structured MH_STATUS progress reports become
      // first-class trace events the UI streams live.
      onAgentStatus: (status) => {
        this.traceStore.append({
          type: "agent_status",
          actor: "agent",
          taskId: node.id,
          payload: { ...status }
        });
      }
    });
    this.traceStore.append({
      type: "executor_completed",
      actor: "system",
      taskId: node.id,
      payload: {
        executorId: executorSelection.executorId,
        model: executorSelection.model,
        usageSource,
        exitCode: executorOutcome.exitCode,
        timedOut: executorOutcome.timedOut
      }
    });

    const contract = node.contract;
    const recorded = await this.resultRecorder.record({
      worktree,
      executorOutcome,
      unexpectedCommitPolicy: config.unexpectedCommitPolicy,
      commitMessage: `mh: ${node.id}`,
      ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
      ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {}),
      usageSource
    });
    return this.runLeafValidation({ node, worktree, result: recorded, runId });
  }

  private async runLeafValidation(args: {
    node: TaskNode;
    worktree: WorktreeRecord;
    result: AgentExecutionResult;
    runId: string;
  }): Promise<AgentExecutionResult> {
    const commands = args.node.contract?.leafValidationCommands ?? [];
    if (args.result.status !== "success" || commands.length === 0) {
      return args.result;
    }

    this.traceStore.append({
      type: "validation_started",
      actor: "system",
      taskId: args.node.id,
      payload: { scope: "leaf", commandCount: commands.length }
    });
    const validationResult = await this.validationRunner.run(commands, {
      worktreePath: args.worktree.path,
      repoRoot: this.repoRoot
    });
    this.traceStore.append({
      type: "validation_completed",
      actor: "system",
      taskId: args.node.id,
      payload: {
        scope: "leaf",
        passed: validationResult.passed,
        exitCode: validationResult.exitCode,
        commandCount: commands.length
      }
    });

    if (validationResult.passed) {
      return { ...args.result, validationResult };
    }

    execWarn("leaf", "leaf validation failed", {
      task: args.node.id,
      runId: args.runId,
      exitCode: validationResult.exitCode,
      output: validationResult.output
    });
    return { ...args.result, status: "validation_failed", validationResult };
  }

  private async integrateBottomUp(args: {
    graph: TaskGraph;
    runId: string;
    config: ExecutionConfig;
    defaultSelection: ExecutorSelection;
    leafResults: AgentExecutionResult[];
    worktrees: WorktreeRecord[];
    predictedConflicts: PredictedConflictHint[];
    signal?: AbortSignal;
  }): Promise<IntegrationResult[]> {
    const { graph, runId, config } = args;
    const resultByTask = new Map<string, AgentExecutionResult>(
      args.leafResults.map((result) => [result.taskId, result])
    );

    const composites = Object.values(graph.nodes)
      .filter((node) => node.kind !== "leaf" && node.childrenIds.length > 0)
      .sort((a, b) => b.depth - a.depth);
    if (composites.length > 0) {
      execLog("integrate", "integrating composites bottom-up", {
        runId,
        composites: composites.length,
        tasks: formatTaskList(composites.map((node) => node.id))
      });
    }

    const integrationResults: IntegrationResult[] = [];

    for (const composite of composites) {
      const childResults = composite.childrenIds
        .map((childId) => resultByTask.get(childId))
        .filter((result): result is AgentExecutionResult => result !== undefined);
      const missingChildIds = composite.childrenIds.filter((childId) => !resultByTask.has(childId));

      if (missingChildIds.length > 0) {
        execWarn("integrate", "missing child results — marking composite child_failed", {
          task: composite.id,
          present: formatResultStatuses(childResults),
          missing: formatTaskList(missingChildIds)
        });
        const result: IntegrationResult = {
          compositeTaskId: composite.id,
          status: "child_failed",
          childResults: [
            ...childResults,
            ...missingChildIds.map((childId) =>
              syntheticMissingChildResult(childId, graph.baseCommit, composite.id)
            )
          ],
          repairAttempted: false,
          preMergeFindings: []
        };
        this.traceStore.append({
          type: "integration_started",
          actor: "system",
          taskId: composite.id,
          payload: { childTaskIds: childResults.map((child) => child.taskId), missingChildIds }
        });
        this.traceStore.append({
          type: "integration_completed",
          actor: "system",
          taskId: composite.id,
          payload: { status: result.status, missingChildIds }
        });
        integrationResults.push(result);
        resultByTask.set(composite.id, syntheticFailedCompositeResult(composite.id, graph.baseCommit));
        continue;
      }

      execLog("integrate", "integrating composite", {
        task: composite.id,
        depth: composite.depth,
        children: `${childResults.length}/${composite.childrenIds.length} resolved`,
        childIds: formatTaskList(composite.childrenIds)
      });

      let worktree: WorktreeRecord;
      try {
        worktree = await this.worktreeManager.create({
          taskId: composite.id,
          runId,
          kind: "integration",
          baseCommit: graph.baseCommit
        });
      } catch (error) {
        execError("integrate", "composite aborted: integration worktree creation failed", {
          task: composite.id,
          runId,
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
      args.worktrees.push(worktree);
      this.traceStore.append({
        type: "worktree_created",
        actor: "system",
        taskId: composite.id,
        payload: { path: worktree.path, branch: worktree.branch }
      });

      const contract = composite.contract;
      const repairSelection = resolveExecutorSelection(composite, args.defaultSelection);
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
        repair: {
          selection: repairSelection,
          timeoutMs: config.integrationTimeoutMs
        },
        parentGoal: composite.goal,
        childIntents,
        ...(args.predictedConflicts.length > 0 ? { predictedConflicts: args.predictedConflicts } : {}),
        ...(sharedInterfaces ? { sharedInterfaces } : {}),
        ...(contract?.parentValidationCommands
          ? { parentValidationCommands: contract.parentValidationCommands }
          : {}),
        ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
        ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {}),
        ...(args.signal !== undefined ? { signal: args.signal } : {})
      });
      integrationResults.push(result);

      if (INTEGRATION_SUCCESS.has(result.status)) {
        execLog("integrate", "composite integrated", {
          task: composite.id,
          status: result.status,
          commitSha: result.integrationCommitSha,
          repaired: result.repairAttempted,
          children: formatTaskList(result.childResults.map((child) => child.taskId))
        });
      } else {
        execWarn("integrate", "composite integration failed", {
          task: composite.id,
          status: result.status,
          repaired: result.repairAttempted,
          children: formatTaskList(result.childResults.map((child) => child.taskId)),
          ...(result.conflictDetails ? { conflictFiles: result.conflictDetails.files } : {})
        });
      }

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
    worktreePath: string,
    runId: string
  ): Promise<ValidationRunResult | undefined> {
    const commands = collectRunValidationCommands(graph);
    if (commands.length === 0) {
      return undefined;
    }
    execLog("validate", "running run-level validation", {
      runId,
      commands: commands.length,
      cwd: worktreePath
    });
    this.traceStore.append({
      type: "validation_started",
      actor: "system",
      payload: { scope: "run", commandCount: commands.length }
    });
    const result = await this.validationRunner.run(commands, { worktreePath, repoRoot: this.repoRoot });
    if (result.passed) {
      execLog("validate", "run-level validation passed", { runId, commands: commands.length });
    } else {
      execWarn("validate", "run-level validation failed", {
        runId,
        commands: commands.length,
        exitCode: result.exitCode,
        output: result.output
      });
    }
    return result;
  }

  private async cleanupWorktrees(worktrees: WorktreeRecord[]): Promise<void> {
    for (const worktree of worktrees) {
      try {
        await this.worktreeManager.clean(worktree);
      } catch (error) {
        // I8: a cleanup failure must never mask the run result. Record it on the
        // trace and keep cleaning the rest (best-effort).
        execWarn("cleanup", "worktree cleanup failed (best-effort, ignored)", {
          task: worktree.taskId,
          path: worktree.path,
          message: error instanceof Error ? error.message : String(error)
        });
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

/** Repair prompt: original objective + acceptance criteria + the exact failure. */
function buildLeafRepairInstructions(node: TaskNode, validationOutput: string): string {
  const lines = [
    `Your previous implementation of the task "${node.title}" failed validation.`,
    "",
    "ORIGINAL TASK OBJECTIVE:",
    node.contract?.objective ?? node.prompt ?? node.goal,
    ""
  ];

  const acceptance = node.acceptanceCriteria ?? [];
  if (acceptance.length > 0) {
    lines.push("Acceptance criteria:", ...acceptance.map((criterion) => `- ${criterion}`), "");
  }

  lines.push(
    "VALIDATION FAILURE OUTPUT:",
    "```",
    validationOutput,
    "```",
    "",
    "Fix the implementation. Do not revert previous correct work; build upon it to address the",
    "failures listed above.",
    "",
    "Do not commit — the orchestrator will commit your changes."
  );

  return lines.join("\n");
}

export function buildLeafInstructions(node: TaskNode, contextSection?: string): string {
  const contract = node.contract;
  const lines = [contract?.objective ?? node.prompt ?? node.goal];

  const acceptance = node.acceptanceCriteria ?? [];
  if (acceptance.length > 0) {
    lines.push("", "Acceptance criteria:", ...acceptance.map((c) => `- ${c}`));
  }

  // Communicate scope as guidance, not a hard cage. The allow-list is a hint for
  // where this task's work belongs; touching another file when the task genuinely
  // needs it is fine (the orchestrator only hard-blocks forbidden paths). This
  // keeps a greenfield scaffold from self-limiting into an empty diff.
  if (contract?.executionScope) {
    const allowed = [
      ...contract.executionScope.implementationPaths,
      ...contract.executionScope.testPaths,
      ...contract.executionScope.configPaths
    ];
    if (allowed.length > 0) {
      lines.push(
        "",
        "Your work belongs primarily in files matching (stay here unless the task truly needs more):",
        ...allowed.map((p) => `- ${p}`)
      );
    }
  }
  if (contract?.forbiddenPaths && contract.forbiddenPaths.length > 0) {
    lines.push("", "You must NOT modify (hard rule):", ...contract.forbiddenPaths.map((p) => `- ${p}`));
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

  lines.push("", AGENT_STATUS_PROTOCOL_INSTRUCTIONS);
  lines.push("", "Do not commit — the orchestrator will commit your changes.");
  return lines.join("\n");
}

function collectRunValidationCommands(graph: TaskGraph): ExecutionValidationCommand[] {
  const root = graph.nodes[graph.rootId];
  return root?.contract?.runValidationCommands ?? [];
}

function requireExecutor(executor: AgentExecutor | undefined): AgentExecutor {
  if (executor === undefined) {
    throw new Error("RunExecutor requires an executor or executorFactory.");
  }
  return executor;
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
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
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
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 1,
    executorDurationMs: 0,
    executorTimedOut: false,
    stderrTail: "Composite integration failed before producing an integration commit."
  };
}

function syntheticMissingChildResult(
  taskId: string,
  baseHead: string,
  compositeTaskId: string
): AgentExecutionResult {
  return {
    taskId,
    status: "internal_error",
    baseHead,
    currentHead: baseHead,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 1,
    executorDurationMs: 0,
    executorTimedOut: false,
    stderrTail: `Task "${taskId}" did not produce a result before integrating "${compositeTaskId}".`
  };
}

function formatTaskList(taskIds: readonly string[]): string {
  if (taskIds.length === 0) {
    return "(none)";
  }
  const rendered = taskIds.join(",");
  return rendered.length > 500 ? `${rendered.slice(0, 500)}...` : rendered;
}

function formatResultStatuses(results: readonly AgentExecutionResult[]): string {
  if (results.length === 0) {
    return "(none)";
  }
  return formatTaskList(results.map((result) => `${result.taskId}:${result.status}`));
}

function formatIntegrationStatuses(results: readonly IntegrationResult[]): string {
  if (results.length === 0) {
    return "(none)";
  }
  return formatTaskList(results.map((result) => `${result.compositeTaskId}:${result.status}`));
}
