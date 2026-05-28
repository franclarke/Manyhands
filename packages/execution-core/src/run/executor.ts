import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExecutionValidationCommand } from "@manyhands/contracts";
import { scheduleTasks, type SchedulingPolicy } from "@manyhands/scheduler";
import { nowIso } from "@manyhands/shared";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import type { TraceStore } from "@manyhands/trace-store";

import type { CodexExecutor } from "../codex/types";
import type { GitRunner } from "../git/runner";
import { computeGranularityVector } from "../granularity/vector";
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
  codex: CodexExecutor;
  traceStore: TraceStore;
  repoRoot: string;
  worktreeManager?: WorktreeManager;
  resultRecorder?: ResultRecorder;
  integrationAgent?: IntegrationAgent;
  validationRunner?: ValidationRunner;
  batchScheduler?: BatchScheduler;
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

const INTEGRATION_SUCCESS = new Set(["success", "codex_repair_success"]);

/**
 * Top-level orchestrator (D4-D10). Schedules leaves into batches, runs each in
 * an isolated worktree via Codex, records the git-diff result (D5) and commits
 * on the orchestrator's behalf (D6), integrates children bottom-up via
 * cherry-pick (D8), runs run-level validation, and emits run_completed plus the
 * experiment's GranularityVector. Leaf worktrees are kept until after
 * integration so their commits stay reachable for cherry-pick, then cleaned.
 */
export class RunExecutor {
  private readonly git: GitRunner;
  private readonly codex: CodexExecutor;
  private readonly traceStore: TraceStore;
  private readonly repoRoot: string;
  private readonly worktreeManager: WorktreeManager;
  private readonly resultRecorder: ResultRecorder;
  private readonly integrationAgent: IntegrationAgent;
  private readonly validationRunner: ValidationRunner;
  private readonly batchScheduler: BatchScheduler;
  private readonly writeInstructions: (path: string, content: string) => Promise<void>;
  private readonly clock: () => number;

  constructor(deps: RunExecutorDeps) {
    this.git = deps.git;
    this.codex = deps.codex;
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
        codex: deps.codex,
        traceStore: deps.traceStore,
        repoRoot: deps.repoRoot,
        validationRunner: this.validationRunner
      });
    this.batchScheduler =
      deps.batchScheduler ?? new BatchScheduler({ traceStore: deps.traceStore });
    this.writeInstructions = deps.writeInstructions ?? ((path, content) => writeFile(path, content, "utf8"));
    this.clock = deps.clock ?? (() => Date.now());
  }

  async run(params: RunExecutionParams): Promise<RunExecutionResult> {
    const { graph, config } = params;
    const runId = params.runId ?? graph.planId;
    const startMs = this.clock();

    const plan = scheduleTasks({
      graph,
      contracts: {},
      riskMatrix: [],
      maxParallel: config.maxParallel,
      policy: params.policy ?? "parallel_naive"
    });

    const worktrees: WorktreeRecord[] = [];
    const leafResultMap = await this.batchScheduler.runBatches({
      batches: plan.batches.map((batch) => ({ id: batch.id, taskIds: batch.taskIds })),
      runTask: async (taskId) => {
        const node = graph.nodes[taskId];
        if (!node) {
          throw new Error(`Scheduled task ${taskId} is not in the graph`);
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

    const validationResult = await this.runRunValidation(graph, worktrees[0]?.path ?? this.repoRoot);

    await this.cleanupWorktrees(worktrees);

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

    const instructionFilePath = join(tmpdir(), `mh-${runId}-${node.id}.txt`);
    await this.writeInstructions(instructionFilePath, buildLeafInstructions(node));

    this.traceStore.append({ type: "codex_started", actor: "system", taskId: node.id, payload: {} });
    const codexOutcome = await this.codex.execute({
      cwd: worktree.path,
      instructionFilePath,
      model,
      timeoutMs: config.leafTimeoutMs,
      sandboxMode: config.sandboxMode,
      bypassApprovals: true
    });
    this.traceStore.append({
      type: "codex_completed",
      actor: "system",
      taskId: node.id,
      payload: { exitCode: codexOutcome.exitCode, timedOut: codexOutcome.timedOut }
    });

    const contract = node.contract;
    return this.resultRecorder.record({
      worktree,
      codexOutcome,
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
      const result = await this.integrationAgent.integrate({
        compositeTaskId: composite.id,
        worktree,
        childResults,
        repair: { model, sandboxMode: config.sandboxMode, timeoutMs: config.integrationTimeoutMs },
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
      }
    }

    return integrationResults;
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
      await this.worktreeManager.clean(worktree);
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

function buildLeafInstructions(node: TaskNode): string {
  const lines = [node.prompt ?? node.goal];
  if (node.acceptanceCriteria && node.acceptanceCriteria.length > 0) {
    lines.push("", "Acceptance criteria:", ...node.acceptanceCriteria.map((c) => `- ${c}`));
  }
  lines.push("", "Do not commit — the orchestrator will commit your changes.");
  return lines.join("\n");
}

function collectRunValidationCommands(graph: TaskGraph): ExecutionValidationCommand[] {
  const root = graph.nodes[graph.rootId];
  return root?.contract?.runValidationCommands ?? [];
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
    codexExitCode: 0,
    codexDurationMs: 0,
    codexTimedOut: false
  };
}
