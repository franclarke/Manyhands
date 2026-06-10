/**
 * Execution host — the single place where the web app drives the LangGraph
 * execution StateGraph.
 *
 * Owns: dependency wiring (RunExecutor-backed leaf/repair/integration deps,
 * scope-aware wave selection fed by the planning risk matrix), graph
 * compilation over the JsonFileCheckpointSaver, the stream loop, and the
 * interrupt → paused-run projection.
 *
 * Both the initial start (runExecutionPipeline) and the native HITL resume
 * (resumeExecutionPipeline → Command({ resume })) go through driveExecution,
 * so checkpoints are never hand-edited.
 */
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import {
  ChildProcessValidationRunner,
  DefaultAgentExecutorFactory,
  ExecutionConfigSchema,
  RunExecutor,
  SimpleGitRunner,
  type AgentExecutionResult,
  type IntegrationResult,
  type PredictedConflictHint
} from "@manyhands/execution-core";
import { selectScopeAwareWave } from "@manyhands/scheduler";
import {
  JsonFileCheckpointSaver,
  buildExecutionGraph,
  executionRecursionLimit,
  type LeafExecutionInput,
  type LeafValidationInterrupt,
  type MergeConflictInterrupt,
  type ResumeDecision
} from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore, type TraceStore } from "@manyhands/trace-store";
import type { TaskPairRiskMatrix } from "@manyhands/conflict-risk";
import { resolveRunsDirectory } from "./repository";
import { publishRunEvent } from "./event-bus";
import { publishRunModelEvent } from "./run-model-event-log";
import {
  INTEGRATION_SUCCESS,
  collectRunValidationCommands,
  executionResultsFromRun,
  mergeNodeExecutionResult,
  resolveExecutionGraph
} from "./execution-state";
import { getRunRepository } from "./store";
import type { ProvisionedRepo } from "./repo-provisioner";
import type { RunRecord } from "./schema";

// ─── Gate options (shared contract between host, routes and UI copy) ───────

export const LEAF_GATE_OPTIONS = [
  { label: "Reintentar reparación", action: "retry_repair" },
  { label: "Aceptar fallo y continuar", action: "accept_failing" },
  { label: "Abortar run", action: "abort_run" }
] as const;

export const CONFLICT_GATE_OPTIONS = [
  { label: "Aceptar conflicto y continuar", action: "accept_conflict" },
  { label: "Abortar run", action: "abort_run" }
] as const;

/** Map a human answer (gate option label or raw action id) to a ResumeDecision. */
export function decisionFromAnswer(
  gate: NonNullable<RunRecord["pendingDecision"]>["gate"],
  answer: string
): ResumeDecision | null {
  const options = gate === "leaf_validation_failed" ? LEAF_GATE_OPTIONS : CONFLICT_GATE_OPTIONS;
  const match = options.find((option) => option.label === answer || option.action === answer);
  return match !== undefined ? ({ action: match.action } as ResumeDecision) : null;
}

export function isResumeDecision(value: unknown): value is ResumeDecision {
  if (typeof value !== "object" || value === null) return false;
  const action = (value as { action?: unknown }).action;
  return (
    action === "retry_repair" ||
    action === "accept_failing" ||
    action === "accept_conflict" ||
    action === "abort_run"
  );
}

// ─── Host construction ─────────────────────────────────────────────────────

export interface ExecutionHostOptions {
  /**
   * Fresh trace sink per node operation (mirrors traces into the live UI and
   * lets each operation persist exactly its own events). Defaults to plain
   * in-memory stores.
   */
  traceStoreFactory?: () => TraceStore;
  /** Plan-time conflict foresight threaded into the Composer repair prompt. */
  predictedConflicts?: PredictedConflictHint[];
}

interface ExecutionHost {
  graph: ReturnType<typeof buildExecutionGraph>;
  threadConfig: { configurable: { thread_id: string }; recursionLimit: number };
  taskGraph: TaskGraph;
}

function riskMatrixFromRun(run: RunRecord): TaskPairRiskMatrix {
  const planning = run.planning as { riskMatrix?: TaskPairRiskMatrix } | undefined;
  return Array.isArray(planning?.riskMatrix) ? planning.riskMatrix : [];
}

/**
 * Build the compiled execution graph for a run. Deps are reconstructed from
 * the persisted RunRecord (graph, provisioned repo, config) — never from
 * in-memory closures — so a resume after a process restart wires identically.
 */
export function buildExecutionHost(
  run: RunRecord,
  provisioned: ProvisionedRepo,
  options: ExecutionHostOptions = {}
): ExecutionHost {
  const runId = run.runId;
  const taskGraph: TaskGraph = {
    ...resolveExecutionGraph(run),
    repo: provisioned.repoRoot,
    baseBranch: provisioned.baseBranch,
    baseCommit: provisioned.baseCommit
  };
  const riskMatrix = riskMatrixFromRun(run);
  const traceStoreFactory = options.traceStoreFactory ?? (() => new InMemoryTraceStore());

  const makeRunExecutor = (sink: TraceStore) =>
    new RunExecutor({
      git: new SimpleGitRunner(),
      executorFactory: new DefaultAgentExecutorFactory(),
      traceStore: sink,
      repoRoot: provisioned.repoRoot
    });

  const executionConfigFor = (current: RunRecord) => ExecutionConfigSchema.parse(current.executionConfig ?? {});

  const persistNodeResult = async (
    graph: TaskGraph,
    nodeResult:
      | { kind: "leaf"; result: AgentExecutionResult; worktrees: never[] }
      | Awaited<ReturnType<RunExecutor["runNode"]>>,
    traces: TraceStore
  ): Promise<void> => {
    await getRunRepository().update(runId, (current) => ({
      ...current,
      execution: mergeNodeExecutionResult({
        runId,
        graph,
        existing: executionResultsFromRun(current),
        nodeResult: nodeResult as Awaited<ReturnType<RunExecutor["runNode"]>>
      }),
      executionTraces: [...(current.executionTraces ?? []), ...traces.list()],
      heartbeatAt: new Date().toISOString()
    }));
  };

  const executeLeaf = async (params: LeafExecutionInput): Promise<{ result: AgentExecutionResult }> => {
    const current = await getRunRepository().get(runId);
    const traceStore = traceStoreFactory();
    const runExecutor = makeRunExecutor(traceStore);

    const nodeResult = await runExecutor.runNode({
      graph: taskGraph,
      config: executionConfigFor(current),
      model: current.model,
      runId,
      taskId: params.taskId
    });
    if (nodeResult.kind !== "leaf") {
      throw new Error(`Expected leaf result for node ${params.taskId}, got ${nodeResult.kind}`);
    }

    const result = nodeResult.result;
    publishRunEvent(runId, {
      kind: "agent.run.completed",
      taskId: params.taskId,
      success: result.status === "success",
      at: new Date().toISOString()
    });
    publishRunEvent(runId, {
      kind: "validation.completed",
      taskId: params.taskId,
      passed: result.status === "success",
      at: new Date().toISOString()
    });
    await persistNodeResult(taskGraph, nodeResult, traceStore);
    return { result };
  };

  const repairLeaf = async (
    params: LeafExecutionInput & { validationOutput: string }
  ): Promise<{ result: AgentExecutionResult } | null> => {
    const current = await getRunRepository().get(runId);
    const traceStore = traceStoreFactory();
    const runExecutor = makeRunExecutor(traceStore);

    const { result, worktree } = await runExecutor.repairLeaf({
      graph: taskGraph,
      config: executionConfigFor(current),
      model: current.model,
      runId,
      taskId: params.taskId,
      validationOutput: params.validationOutput
    });

    publishRunEvent(runId, {
      kind: "agent.run.completed",
      taskId: params.taskId,
      success: result.status === "success",
      at: new Date().toISOString()
    });
    publishRunEvent(runId, {
      kind: "validation.completed",
      taskId: params.taskId,
      passed: result.status === "success",
      at: new Date().toISOString()
    });
    await persistNodeResult(taskGraph, { kind: "leaf", result, worktrees: [worktree] }, traceStore);
    return { result };
  };

  const integrateComposite = async (params: {
    compositeTaskId: string;
    runId: string;
    graph: TaskGraph;
    repoPath: string;
    childResults: AgentExecutionResult[];
  }): Promise<IntegrationResult> => {
    const current = await getRunRepository().get(runId);
    const traceStore = traceStoreFactory();
    const runExecutor = makeRunExecutor(traceStore);

    const nodeResult = await runExecutor.runNode({
      graph: taskGraph,
      config: executionConfigFor(current),
      model: current.model,
      runId,
      taskId: params.compositeTaskId,
      childResults: params.childResults,
      ...(options.predictedConflicts !== undefined ? { predictedConflicts: options.predictedConflicts } : {})
    });
    if (nodeResult.kind !== "integration") {
      throw new Error(`Expected integration result for composite ${params.compositeTaskId}`);
    }

    const result = nodeResult.result;
    publishRunEvent(runId, {
      kind: "agent.run.completed",
      taskId: params.compositeTaskId,
      success: INTEGRATION_SUCCESS.has(result.status),
      at: new Date().toISOString()
    });
    await persistNodeResult(taskGraph, nodeResult, traceStore);
    return result;
  };

  const validateRun = async (): Promise<{ passed: boolean; output?: string }> => {
    const current = await getRunRepository().get(runId);
    const { leafResults, integrationResults } = executionResultsFromRun(current);
    const resultsOk =
      leafResults.length > 0 &&
      leafResults.every((result) => result.status === "success") &&
      integrationResults.every((result) => INTEGRATION_SUCCESS.has(result.status));
    if (!resultsOk) {
      return { passed: false, output: "One or more tasks did not finish successfully." };
    }

    // Run-level validation commands execute over the fully-integrated root
    // worktree; final apply happens in the pipeline epilogue.
    const commands = collectRunValidationCommands(taskGraph);
    if (commands.length === 0) {
      return { passed: true };
    }
    const traceStore = traceStoreFactory();
    traceStore.append({
      type: "validation_started",
      actor: "system",
      payload: { scope: "run", commandCount: commands.length }
    });
    const worktreePath = join(provisioned.repoRoot, ".manyhands", "worktrees", runId, taskGraph.rootId);
    const validation = await new ChildProcessValidationRunner().run(commands, {
      worktreePath,
      repoRoot: provisioned.repoRoot
    });
    traceStore.append({
      type: "validation_completed",
      actor: "system",
      payload: { scope: "run", passed: validation.passed, exitCode: validation.exitCode }
    });
    await getRunRepository().update(runId, (record) => ({
      ...record,
      execution:
        record.execution !== undefined
          ? { ...(record.execution as object), validationResult: validation }
          : record.execution,
      executionTraces: [...(record.executionTraces ?? []), ...traceStore.list()]
    }));
    return { passed: validation.passed, output: validation.output };
  };

  const checkpointer = new JsonFileCheckpointSaver(join(resolveRunsDirectory(), "checkpoints"));

  const graph = buildExecutionGraph({
    leafDeps: { executeLeaf, repairLeaf, maxRepairAttempts: 1 },
    integrateDeps: { integrateComposite },
    validationDeps: { validateRun },
    frontierDeps: {
      selectWave: ({ graph: waveGraph, candidates }) =>
        selectScopeAwareWave({
          graph: waveGraph,
          candidates,
          riskMatrix,
          ...(run.executionConfig?.maxParallel !== undefined
            ? { maxParallel: run.executionConfig.maxParallel }
            : {})
        })
    },
    checkpointer
  });

  return {
    graph,
    threadConfig: {
      configurable: { thread_id: runId },
      recursionLimit: executionRecursionLimit({ taskGraph })
    },
    taskGraph
  };
}

// ─── Drive / pause / resume ────────────────────────────────────────────────

/** True when the run's execution thread already has a persisted checkpoint. */
export async function hasExecutionCheckpoint(runId: string): Promise<boolean> {
  const checkpointer = new JsonFileCheckpointSaver(join(resolveRunsDirectory(), "checkpoints"));
  return (await checkpointer.getTuple({ configurable: { thread_id: runId } })) !== undefined;
}

/**
 * Drop the run's execution thread so the next start re-enters the graph from
 * scratch, seeded with whatever results survive in the RunRecord (used after
 * seam amendments invalidate part of the execution).
 */
export async function resetExecutionThread(runId: string): Promise<void> {
  const checkpointer = new JsonFileCheckpointSaver(join(resolveRunsDirectory(), "checkpoints"));
  await checkpointer.deleteThread(runId);
}

export type ExecutionDriveOutcome =
  | { kind: "paused"; gate: NonNullable<RunRecord["pendingDecision"]> }
  | { kind: "finished"; status: "completed" | "failed"; errorMessage?: string };

/**
 * Stream the graph until it finishes or suspends on a gate interrupt. On
 * interrupt, projects the gate into the RunRecord (pendingDecision + the
 * human-readable pendingQuestion the DecisionChannel renders) and pauses.
 */
export async function driveExecution(
  host: ExecutionHost,
  input: Record<string, unknown> | Command | null
): Promise<ExecutionDriveOutcome> {
  // The runtime accepts state input, a resume Command, or null (continue);
  // the generated generics are narrower than the runtime contract.
  const stream = await host.graph.stream(input as never, { ...host.threadConfig, streamMode: "updates" });
  for await (const _chunk of stream) {
    void _chunk;
    // Updates are persisted by the deps themselves; the stream is consumed to
    // drive the graph to its next suspension point.
  }

  const state = await host.graph.getState(host.threadConfig);
  const interrupt = state.tasks.flatMap((task) => task.interrupts)[0]?.value as
    | LeafValidationInterrupt
    | MergeConflictInterrupt
    | undefined;

  if (interrupt !== undefined) {
    return { kind: "paused", gate: gateFromInterrupt(interrupt) };
  }

  const values = state.values as { status?: string; errorMessage?: string | null } | undefined;
  if (values?.status === "completed") {
    return { kind: "finished", status: "completed" };
  }
  return {
    kind: "finished",
    status: "failed",
    errorMessage: values?.errorMessage ?? "Execution failed during run-level validation."
  };
}

function gateFromInterrupt(
  interrupt: LeafValidationInterrupt | MergeConflictInterrupt
): NonNullable<RunRecord["pendingDecision"]> {
  if (interrupt.type === "leaf_validation_failed") {
    return {
      gate: "leaf_validation_failed",
      taskId: interrupt.taskId,
      validationOutput: interrupt.validationOutput
    };
  }
  return {
    gate: "merge_conflict",
    taskId: interrupt.compositeTaskId,
    ...(interrupt.conflictDetails !== undefined ? { conflictFiles: interrupt.conflictDetails.files } : {}),
    integrationStatus: interrupt.status
  };
}

/** Persist a gate pause: status, typed decision, and the projected question. */
export async function persistExecutionPause(
  runId: string,
  gate: NonNullable<RunRecord["pendingDecision"]>
): Promise<void> {
  const isLeafGate = gate.gate === "leaf_validation_failed";
  const options = (isLeafGate ? LEAF_GATE_OPTIONS : CONFLICT_GATE_OPTIONS).map((option) => option.label);
  const question = isLeafGate
    ? `La validación de la tarea "${gate.taskId}" falló tras la auto-reparación. ¿Cómo querés continuar?`
    : `La integración de "${gate.taskId}" falló con conflictos que el Composer no pudo resolver. ¿Cómo querés continuar?`;

  await getRunRepository().update(runId, (current) => ({
    ...current,
    status: "paused",
    pausedDuring: "running",
    pendingDecision: gate,
    pendingQuestion: { nodeId: gate.taskId, question, options }
  }));

  const now = new Date().toISOString();
  publishRunEvent(runId, { kind: "status.changed", status: "paused", at: now });
  publishRunModelEvent(runId, {
    actor: "system",
    at: now,
    type: "decision.raised",
    payload: {
      decisionId: `clarify:${gate.taskId}`,
      kind: "clarify",
      blocking: true,
      context: { nodeIds: [gate.taskId], question, options }
    }
  });
}

/** Clear the gate projection when a resume decision is accepted. */
export async function clearExecutionPause(runId: string, target: "running"): Promise<RunRecord> {
  const repo = getRunRepository();
  const updated = await repo.update(runId, (current) => {
    const next = { ...current, status: target } as RunRecord;
    delete next.pausedDuring;
    delete next.pendingDecision;
    delete next.pendingQuestion;
    return next;
  });
  publishRunEvent(runId, { kind: "status.changed", status: target, at: new Date().toISOString() });
  return updated;
}

/** Build the Command that resumes a suspended execution graph natively. */
export function resumeCommand(decision: ResumeDecision): Command {
  return new Command({ resume: decision });
}
