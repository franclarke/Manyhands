import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionValidationCommand } from "@manyhands/contracts";
import {
  buildSchedulingSafetyContext,
  scheduleTasks,
  summarizeRiskMatrix,
  type SchedulingPolicy
} from "@manyhands/scheduler";
import type { TaskPairRiskMatrix } from "@manyhands/conflict-risk";
import type { RepositoryIndex } from "@manyhands/repository-index";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import type { TraceStore } from "@manyhands/trace-store";

import { FixedAgentExecutorFactory, type AgentExecutorFactory } from "../executor/factory";
import { AGENT_STATUS_PROTOCOL_INSTRUCTIONS } from "../executor/status-channel";
import type { AgentExecutor } from "../executor/types";
import { countDependents } from "../routing/complexity";
import { resolveRoutedSelection, type ExecutorRouter } from "../routing/policy";
import {
  CLAUDE_CODE_EXECUTOR_ID,
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
import type { IntegrationOperationJournal } from "../integration/operation-journal";
import { ResultRecorder } from "../result/recorder";
import { BatchScheduler } from "../scheduler/batch";
import { classifyDeferredValidation } from "../validation/deferred";
import {
  AgentExecutionResultSchema,
  type AgentExecutionResult,
  type ExecutionConfig,
  type GranularityVector,
  type IntegrationResult,
  type ValidationRunResult,
  type WorktreeRecord
} from "../types";
import { ChildProcessValidationRunner, type ValidationRunner } from "../validation/runner";
import { ChildProcessDependencyInstaller, type DependencyInstaller } from "../validation/dependencies";
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
  /**
   * Installs npm dependencies in the integration worktree before run-level
   * validation, so a greenfield project's composed tree can resolve its
   * toolchain (build/typecheck). Injectable for tests.
   */
  dependencyInstaller?: DependencyInstaller;
  /** Packs target-file context into leaf instructions. Injectable for tests. */
  contextPacker?: ContextPacker;
  /**
   * Complexity-based executor router. When set, node selection follows:
   * explicit node metadata → router decision → run-level default. Repairs
   * route with attempt ≥ 1 so the tier escalates to a stronger agent.
   */
  router?: ExecutorRouter;
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
  /** Full planning-time conflict matrix used by the scheduler. */
  riskMatrix?: TaskPairRiskMatrix;
  /** Optional structural repository index used to enrich fallback risk prediction. */
  repositoryIndex?: RepositoryIndex;
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
  defaultExecutionSelection?: ExecutorSelection;
  defaultRepairSelection?: ExecutorSelection;
  taskId: string;
  runId?: string;
  /** Durable B-015 attempt identity for executor/process correlation. */
  attemptId?: string;
  integrationOperation?: {
    journal: IntegrationOperationJournal;
    runId: string;
    operationId?: string;
    fencingToken?: number;
  };
  childResults?: AgentExecutionResult[];
  cleanupWorktrees?: boolean;
  /** Plan-time conflict foresight, threaded into the Composer's repair prompt. */
  predictedConflicts?: PredictedConflictHint[];
  /** Run-level cancellation, threaded into the executor subprocess. */
  signal?: AbortSignal;
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

export function resolveExecutorSelection(
  node: TaskNode,
  defaultSelection: ExecutorSelection,
  options: { locked?: boolean } = {}
): ExecutorSelection {
  const metadata = node.metadata as { executorSelection?: unknown; executorOverride?: unknown } | undefined;
  const explicit =
    normalizeExecutorSelection(metadata?.executorSelection) ??
    normalizeExecutorSelection(metadata?.executorOverride);
  if (explicit !== undefined) {
    if (options.locked === true && !sameSelection(explicit, defaultSelection)) {
      throw new Error(
        `Node "${node.id}" requests executor/model "${explicit.executorId}/${explicit.model}", ` +
          `but this run is fixed to "${defaultSelection.executorId}/${defaultSelection.model}".`
      );
    }
    return explicit;
  }
  return defaultSelection;
}

export function resolveExecutorModel(node: TaskNode, defaultModel: string): ExecutorSelection {
  return resolveExecutorSelection(node, { executorId: CLAUDE_CODE_EXECUTOR_ID, model: defaultModel });
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
  private readonly dependencyInstaller: DependencyInstaller;
  private readonly batchScheduler: BatchScheduler;
  private readonly contextPacker: ContextPacker;
  private readonly router: ExecutorRouter | undefined;
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
    this.dependencyInstaller = deps.dependencyInstaller ?? new ChildProcessDependencyInstaller();
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
    this.router = deps.router;
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
      const policy = params.policy ?? "risk_aware";
      const schedulingSafety = buildSchedulingSafetyContext({
        graph,
        policy,
        ...(params.riskMatrix !== undefined ? { riskMatrix: params.riskMatrix } : {}),
        ...(params.repositoryIndex !== undefined ? { repositoryIndex: params.repositoryIndex } : {})
      });
      const plan = scheduleTasks({
        graph,
        contracts: schedulingSafety.contracts,
        riskMatrix: schedulingSafety.riskMatrix,
        ...(params.repositoryIndex !== undefined ? { repositoryIndex: params.repositoryIndex } : {}),
        maxParallel: config.maxParallel,
        policy
      });
      execLog("run", "scheduled", {
        runId,
        policy: plan.policy,
        batches: plan.batches.length,
        tasks: formatTaskList(plan.batches.flatMap((batch) => batch.taskIds)),
        blocked: plan.blocked.length,
        warnings: schedulingSafety.warnings.length
      });
      this.traceStore.append({
        type: "batch_scheduled",
        actor: "system",
        payload: {
          version: 1,
          source: "run-executor",
          policy: plan.policy,
          readyTaskCount: leafCount,
          readyTaskIds: Object.values(graph.nodes)
            .filter((node) => node.kind === "leaf" || node.kind === "integrator")
            .map((node) => node.id),
          selectedTaskIds: plan.batches.flatMap((batch) => batch.taskIds),
          blockedTaskIds: plan.blocked.map((task) => task.taskId),
          blockedReasons: plan.blocked.map((task) => ({
            taskId: task.taskId,
            reason: task.reason,
            relatedTaskIds: [],
            requiresHumanReview: task.requiresHumanReview
          })),
          riskSummary: summarizeRiskMatrix(schedulingSafety.riskMatrix),
          fallbacks: schedulingSafety.warnings
            .filter((warning) => warning.code !== "parallel_naive_explicit")
            .map((warning) => ({
              code: warning.code,
              taskIds: warning.taskIds,
              message: warning.message
            })),
          batchCount: plan.batches.length,
          blockedByRiskCount: plan.blocked.filter((task) => task.reason.includes("risk")).length,
          batches: plan.batches.map((batch, index) => ({
            batchIndex: index,
            batchId: batch.id,
            selectedTaskIds: batch.taskIds,
            rationale: batch.rationale
          })),
          warnings: schedulingSafety.warnings.map((warning) => ({
            code: warning.code,
            taskIds: warning.taskIds,
            message: warning.message
          }))
        }
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
      // B-009 (CF-09): `integrator` is an ATOMIC executable task — the same
      // semantics `run()` and the frontier already use. Only composite/root
      // nodes take the integration path below.
      if (node.kind === "leaf" || node.kind === "integrator") {
        const result = await this.executeLeaf({
          graph,
          node,
          runId,
          config,
          defaultSelection: params.defaultExecutionSelection ?? resolveLegacyModelSelection(params.model),
          worktrees,
          ...(params.attemptId !== undefined ? { attemptId: params.attemptId } : {}),
          ...(params.signal !== undefined ? { signal: params.signal } : {})
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
      const repairSelection = resolveExecutorSelection(
        node,
        params.defaultRepairSelection ??
          params.defaultExecutionSelection ??
          resolveLegacyModelSelection(params.model)
      );
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
        ...(params.attemptId !== undefined ? { attemptId: params.attemptId } : {}),
        ...(params.integrationOperation !== undefined ? { integrationOperation: params.integrationOperation } : {}),
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
        repair: {
          selection: repairSelection,
          timeoutMs: config.integrationTimeoutMs,
          // Thread the run's configured effort into the conflict repair, exactly
          // as the full-graph integrateBottomUp path does. Without this, Codex
          // repairs ran at the CLI's default (high) effort and timed out on
          // real UI merge conflicts (E2E 2026-07-06).
          ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {})
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
    defaultRepairSelection?: ExecutorSelection;
    taskId: string;
    runId?: string;
    attemptId?: string;
    validationOutput: string;
    /** Run-level cancellation, threaded into the repair subprocess. */
    signal?: AbortSignal;
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

    const repairDependents = countDependents(graph, node.id);
    const defaultSelection = params.defaultRepairSelection ?? resolveLegacyModelSelection(params.model);
    const selection = resolveRoutedSelection({
      node,
      dependents: repairDependents,
      defaultSelection,
      ...(config.routing === "fixed" ? { lockedSelection: defaultSelection } : {}),
      router: config.routing === "fixed" ? undefined : this.router,
      attempt: 1
    });
    this.traceRoutingDecision(node, repairDependents, selection, 1);
    const usageSource = usageSourceForSelection(selection);
    const executor = this.executorFactory.create(selection);
    const worktree = this.worktreeManager.recordFor({
      taskId: node.id,
      runId,
      kind: "leaf",
      baseCommit: graph.baseCommit
    });

    // The worktree already holds the orchestrator's commit from the failed
    // attempt, so HEAD has legitimately advanced past baseCommit. Capture it
    // BEFORE the repair agent runs so the recorder only flags a commit the agent
    // itself makes — never the orchestrator's own prior commit.
    const expectedHead = await this.worktreeManager.headOf(worktree);

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
      ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
      processOwnerId: runId,
      ...(params.attemptId !== undefined ? { attemptId: params.attemptId } : {}),
      ...(params.signal !== undefined ? { signal: params.signal } : {}),
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
      expectedHead,
      unexpectedCommitPolicy: config.unexpectedCommitPolicy,
      commitMessage: `mh-repair: ${node.id}`,
      ...(contract?.executionScope ? { executionScope: contract.executionScope } : {}),
      ...(contract?.forbiddenPaths ? { forbiddenPaths: contract.forbiddenPaths } : {}),
      ...(contract?.expectedOutput ? { expectedOutput: contract.expectedOutput } : {}),
      scopePolicy: config.scopePolicy,
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
    attemptId?: string;
    signal?: AbortSignal;
  }): Promise<AgentExecutionResult> {
    const { node, runId } = args;
    const dependents = countDependents(args.graph, node.id);
    const executorSelection = resolveRoutedSelection({
      node,
      dependents,
      defaultSelection: args.defaultSelection,
      ...(args.config.routing === "fixed" ? { lockedSelection: args.defaultSelection } : {}),
      router: args.config.routing === "fixed" ? undefined : this.router
    });
    this.traceRoutingDecision(node, dependents, executorSelection, 0);
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
    attemptId?: string;
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
      ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
      processOwnerId: runId,
      ...(args.attemptId !== undefined ? { attemptId: args.attemptId } : {}),
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
      ...(contract?.expectedOutput ? { expectedOutput: contract.expectedOutput } : {}),
      scopePolicy: config.scopePolicy,
      usageSource
    });
    return this.runLeafValidation({ node, worktree, result: recorded, runId });
  }

  /**
   * Record why the router picked this executor (tier, score, signals) so the
   * decision is auditable in the run trace. No-op without a router or when an
   * explicit per-node override won.
   */
  private traceRoutingDecision(
    node: TaskNode,
    dependents: number,
    selection: ExecutorSelection,
    attempt: number
  ): void {
    if (this.router === undefined) {
      return;
    }
    const decision = this.router.describe({ node, dependents, attempt });
    if (
      decision.selection.executorId !== selection.executorId ||
      decision.selection.model !== selection.model
    ) {
      // An explicit metadata override beat the router; nothing to explain.
      return;
    }
    this.traceStore.append({
      type: "executor_routed",
      actor: "system",
      taskId: node.id,
      payload: {
        executorId: selection.executorId,
        model: selection.model,
        tier: decision.tier,
        score: decision.complexity.score,
        signals: decision.complexity.signals,
        degraded: decision.degraded,
        attempt
      }
    });
  }

  private async runLeafValidation(args: {
    node: TaskNode;
    worktree: WorktreeRecord;
    result: AgentExecutionResult;
    runId: string;
  }): Promise<AgentExecutionResult> {
    const commands = args.node.contract?.leafValidationCommands ?? [];
    const abstractNoOp = args.result.status === "empty_diff" && commands.length > 0;
    if ((args.result.status !== "success" && !abstractNoOp) || commands.length === 0) {
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
      repoRoot: this.repoRoot,
      supervision: { runId: args.runId }
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
      if (abstractNoOp) {
        return AgentExecutionResultSchema.parse({
          ...args.result,
          status: "success",
          disposition: "already_satisfied",
          noOp: true,
          validationResult,
          baselineEvidence: { expectedPaths: [], verifiedPaths: [], validation: validationResult }
        });
      }
      return { ...args.result, validationResult };
    }

    // A leaf runs in an isolated worktree branched from the base, so a check
    // whose binary is missing (exit 127) — e.g. `npx tsc --noEmit` before the
    // project's deps exist in the composed tree — is an infra gap at the leaf
    // altitude, not broken code. Defer it: keep the leaf successful and let
    // run-level validation (post-compose, with deps installed) be the real gate.
    // Without this, greenfield runs wedge at the leaf gate on unsatisfiable checks.
    const deferredReason = classifyDeferredValidation(validationResult);
    if (deferredReason !== undefined) {
      execWarn("leaf", "leaf validation deferred — verifying at run level", {
        task: args.node.id,
        runId: args.runId,
        exitCode: validationResult.exitCode,
        output: validationResult.output,
        reason: deferredReason
      });
      this.traceStore.append({
        type: "validation_deferred",
        actor: "system",
        taskId: args.node.id,
        payload: {
          scope: "leaf",
          exitCode: validationResult.exitCode,
          reason: deferredReason
        }
      });
      return { ...args.result, validationResult };
    }

    execWarn("leaf", "leaf validation failed", {
      task: args.node.id,
      runId: args.runId,
      exitCode: validationResult.exitCode,
      output: validationResult.output
    });
    return { ...args.result, status: "validation_failed", disposition: "failed", validationResult };
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
      const repairSelection = resolveExecutorSelection(composite, args.defaultSelection, {
        locked: config.routing === "fixed"
      });
      // Contract-aware composition: hand the Composer the parent goal,
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
          timeoutMs: config.integrationTimeoutMs,
          ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {})
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

  /**
   * Install the composed tree's dependencies before run-level validation. A
   * greenfield project's integration worktree carries a freshly-composed
   * package.json but no node_modules, so build/typecheck would fail for missing
   * deps. Idempotent and best-effort: a failed install is traced, never thrown —
   * the subsequent validation surfaces the real cause.
   */
  private async ensureRunValidationDependencies(worktreePath: string, runId: string): Promise<void> {
    try {
      const result = await this.dependencyInstaller.ensure({ cwd: worktreePath, supervision: { runId } });
      execLog("validate", "run-level dependency check", {
        runId,
        cwd: worktreePath,
        installed: result.installed,
        packageManager: result.packageManager,
        reason: result.reason
      });
      this.traceStore.append({
        type: "validation_started",
        actor: "system",
        payload: {
          scope: "run",
          phase: "dependencies",
          installed: result.installed,
          packageManager: result.packageManager,
          reason: result.reason,
          exitCode: result.exitCode
        }
      });
    } catch (error) {
      execWarn("validate", "run-level dependency install failed (best-effort, ignored)", {
        runId,
        cwd: worktreePath,
        message: error instanceof Error ? error.message : String(error)
      });
    }
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
    await this.ensureRunValidationDependencies(worktreePath, runId);
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

/** Repair prompt: original objective, boundaries, acceptance criteria, and exact failure. */
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

  appendContractExecutionGuidance(lines, node.contract);

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

  appendContractExecutionGuidance(lines, contract);

  if (contextSection && contextSection.length > 0) {
    lines.push("", contextSection);
  }

  lines.push("", AGENT_STATUS_PROTOCOL_INSTRUCTIONS);
  lines.push("", "Do not commit — the orchestrator will commit your changes.");
  return lines.join("\n");
}

function appendContractExecutionGuidance(
  lines: string[],
  contract: TaskNode["contract"] | undefined
): void {
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

function sameSelection(left: ExecutorSelection, right: ExecutorSelection): boolean {
  return left.executorId === right.executorId && left.model === right.model;
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
