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
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import {
  ChildProcessValidationRunner,
  ComplexityRoutingPolicy,
  DefaultAgentExecutorFactory,
  JsonIntegrationOperationJournal,
  RunExecutor,
  SimpleGitRunner,
  worktreePathFor,
  probeExecutorAvailability,
  type AgentExecutionResult,
  type EffortLevel,
  type ExecutorId,
  type ExecutorRouter,
  type IntegrationResult,
  type PredictedConflictHint,
  assertExecutableGraph
} from "@manyhands/execution-core";
import {
  JsonFileCheckpointSaver,
  buildExecutionGraph,
  executionRecursionLimit,
  type BudgetExceededInterrupt,
  type LeafExecutionInput,
  type LeafValidationInterrupt,
  type MergeConflictInterrupt,
  type ResumeDecision
} from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore, type TraceStore } from "@manyhands/trace-store";
import type { StaticConflictSignal, TaskPairRiskMatrix } from "@manyhands/conflict-risk";
import { resolveRunsDirectory } from "./repository";
import { publishRunEvent } from "./event-bus";
import {
  appendStatusAndRunEventsOrRollback,
  requireCapturedRunRecord
} from "./audited-mutation";
import { appendRunEventRequired, type RunModelEventInput } from "./run-model-event-log";
import { RunLifecycleError } from "./errors";
import { executionSelection, repairSelection } from "./executor-selection";
import {
  INTEGRATION_SUCCESS,
  collectRunValidationCommands,
  executionResultsFromRun,
  mergeNodeExecutionResult,
  resolveExecutionGraph
} from "./execution-state";
import { getRunRepository } from "./store";
import { getRunAbort } from "./run-abort-registry";
import { claimRunMutation } from "./mutation-guard";
import { DEFAULT_STALE_MS } from "./interrupted";
import { updateRunForOperation } from "./run-operation-lease";
import { waitWhilePlainPaused } from "./pause-control";
import { persistRetryDispatch, selectAndPersistSchedulingWave } from "./scheduling-audit-events";
import { effectiveExecutionConfig } from "./effective-execution-config";
import type { ProvisionedRepo } from "./repo-provisioner";
import type { RunOperationLease, RunRecord } from "./schema";
import {
  JsonTaskAttemptJournal,
  type TaskAttempt,
  type TaskAttemptKind,
  type TaskAttemptState
} from "./task-attempt-journal";
import type { RunEventType } from "@/lib/run-model/types";

// ─── Gate options (shared contract between host, routes and UI copy) ───────

export const LEAF_GATE_OPTIONS = [
  { label: "Reintentar reparación", action: "retry_repair" },
  { label: "Re-planificar subárbol", action: "replan_subtree" },
  { label: "Aceptar fallo y continuar", action: "accept_failing" },
  { label: "Abortar run", action: "abort_run" }
] as const;

/**
 * True when the human picked the selective re-decomposition option at a leaf
 * gate. Replanning is NOT a graph resume — it rebuilds the plan subtree and
 * resets the execution thread — so callers branch on this BEFORE building a
 * ResumeDecision.
 */
export function isReplanRequest(
  payload: { action?: unknown; answer?: unknown } | null,
  gate: NonNullable<RunRecord["pendingDecision"]>["gate"]
): boolean {
  if (gate !== "leaf_validation_failed") return false;
  if (payload === null) return false;
  if (payload.action === "replan_subtree") return true;
  const replanLabel = LEAF_GATE_OPTIONS.find((option) => option.action === "replan_subtree")?.label;
  return typeof payload.answer === "string" && payload.answer === replanLabel;
}

export const CONFLICT_GATE_OPTIONS = [
  { label: "Reintentar integración", action: "retry_integration" },
  { label: "Aceptar conflicto y continuar", action: "accept_conflict" },
  { label: "Abortar run", action: "abort_run" }
] as const;

export const BUDGET_GATE_OPTIONS = [
  { label: "Extender presupuesto y continuar", action: "extend_budget" },
  { label: "Cerrar parcial (integrar lo completo)", action: "finish_partial" },
  { label: "Abortar run", action: "abort_run" }
] as const;

/** The selectable options for a given execution gate (shared with routes/UI copy). */
export function gateOptionsFor(
  gate: NonNullable<RunRecord["pendingDecision"]>["gate"]
): ReadonlyArray<{ label: string; action: string }> {
  return gate === "leaf_validation_failed"
    ? LEAF_GATE_OPTIONS
    : gate === "budget_exceeded"
      ? BUDGET_GATE_OPTIONS
      : CONFLICT_GATE_OPTIONS;
}

/** Map a human answer (gate option label or raw action id) to a ResumeDecision. */
export function decisionFromAnswer(
  gate: NonNullable<RunRecord["pendingDecision"]>["gate"],
  answer: string
): ResumeDecision | null {
  const options = gateOptionsFor(gate);
  const match = options.find((option) => option.label === answer || option.action === answer);
  if (match === undefined || match.action === "replan_subtree") {
    // replan_subtree is handled out-of-band (see isReplanRequest), never as a
    // graph resume value.
    return null;
  }
  return { action: match.action } as ResumeDecision;
}

export function isResumeDecision(value: unknown): value is ResumeDecision {
  if (typeof value !== "object" || value === null) return false;
  const action = (value as { action?: unknown }).action;
  return (
    action === "retry_repair" ||
    action === "accept_failing" ||
    action === "accept_conflict" ||
    action === "retry_integration" ||
    action === "extend_budget" ||
    action === "finish_partial" ||
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
  /** Durable writer identity for every persistence callback owned by this host. */
  operationLease?: RunOperationLease;
}

export interface ExecutionHost {
  graph: ReturnType<typeof buildExecutionGraph>;
  threadConfig: { configurable: { thread_id: string }; recursionLimit: number };
  taskGraph: TaskGraph;
}

function riskMatrixFromRun(run: RunRecord): TaskPairRiskMatrix {
  const planning = run.planning as { riskMatrix?: TaskPairRiskMatrix } | undefined;
  return Array.isArray(planning?.riskMatrix) ? planning.riskMatrix : [];
}

function staticConflictSignalsFromRun(run: RunRecord): StaticConflictSignal[] | undefined {
  const planning = run.planning as { staticConflictSignals?: StaticConflictSignal[] } | undefined;
  if (!Array.isArray(planning?.staticConflictSignals) || planning.staticConflictSignals.length === 0) {
    return undefined;
  }
  return planning.staticConflictSignals;
}

/** Process-wide cache: which executor CLIs are installed (probed lazily once). */
let availableExecutors: Promise<Set<ExecutorId>> | undefined;

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
  assertExecutableGraph(taskGraph);
  const riskMatrix = riskMatrixFromRun(run);
  const staticConflictSignals = staticConflictSignalsFromRun(run);
  const traceStoreFactory = options.traceStoreFactory ?? (() => new InMemoryTraceStore());
  const attemptJournal = new JsonTaskAttemptJournal({ directory: join(resolveRunsDirectory(), "attempts") });
  const integrationJournal = new JsonIntegrationOperationJournal(join(resolveRunsDirectory(), "integrations"));

  const attemptEventType: Record<TaskAttemptState, RunEventType | undefined> = {
    prepared: "task.attempt.prepared",
    invocation_reserved: "task.attempt.invocation_reserved",
    executor_running: "task.attempt.executor_started",
    executor_finished: "task.attempt.executor_finished",
    diff_captured: "task.attempt.diff_captured",
    scope_evaluated: "task.attempt.scope_evaluated",
    validation_finished: "task.attempt.validation_finished",
    commit_created: "task.attempt.commit_created",
    result_persisted: "task.attempt.result_persisted",
    adopted: "task.attempt.adopted",
    discarded: "task.attempt.discarded",
    recovery_required: "task.attempt.recovery_required",
    cancelled: "task.attempt.cancelled",
    failed: undefined
  };

  const emitAttemptEvent = async (attempt: TaskAttempt, reason?: string): Promise<void> => {
    const type = attemptEventType[attempt.state];
    if (type === undefined) return;
    await appendRunEventRequired(runId, {
      actor: "system",
      type,
      payload: {
        attemptId: attempt.attemptId,
        nodeId: attempt.nodeId,
        operationId: attempt.operationId,
        fencingToken: attempt.fencingToken,
        state: attempt.state,
        kind: attempt.kind,
        ...(attempt.waveId !== undefined ? { waveId: attempt.waveId } : {}),
        ...(attempt.commitSha !== undefined ? { commitSha: attempt.commitSha } : {}),
        ...(reason !== undefined ? { reason } : {}),
        ...(attempt.error !== undefined ? { errorCode: attempt.error.code } : {})
      }
    });
  };

  const beginAttempt = async (
    current: RunRecord,
    nodeId: string,
    kind: TaskAttemptKind,
    baseCommit: string,
    executor: { executorId: string; model: string },
    worktreePath?: string,
    waveId?: string
  ): Promise<{ attempt: TaskAttempt; reuse?: AgentExecutionResult; alreadyCompleted?: boolean }> => {
    if (options.operationLease === undefined) {
      throw new RunLifecycleError(`Cannot journal task ${nodeId} without an operation lease.`);
    }
    const prior = (await attemptJournal.list(runId))
      .filter((entry) => entry.nodeId === nodeId && entry.kind === kind)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const latest = prior[0];
    const existing = executionResultsFromRun(current);
    const existingResult = existing.leafResults.find((entry) => entry.taskId === nodeId);
    if (latest?.state === "result_persisted" || latest?.state === "adopted") {
      if (existingResult !== undefined) return { attempt: latest, reuse: existingResult };
      if (kind === "integrator") return { attempt: latest, alreadyCompleted: true };
      throw new RunLifecycleError(`Task ${nodeId} has a persisted attempt without a node result; recovery required.`);
    }
    if (latest !== undefined && !["failed", "cancelled", "discarded"].includes(latest.state)) {
      const recovery = latest.operationId === options.operationLease.operationId
        ? await attemptJournal.transition(latest.attemptId, {
            expectedVersion: latest.version,
            lease: options.operationLease,
            state: "recovery_required",
            error: { code: "restart_ambiguous_attempt", message: `Attempt ended in ${latest.state}.` }
          })
        : await attemptJournal.claimRecovery(latest.attemptId, {
            expectedVersion: latest.version,
            lease: options.operationLease,
            reason: `Attempt ended in ${latest.state}; external invocation must be reconciled.`
          });
      if (recovery.state !== "recovery_required") throw new RunLifecycleError(`Task ${nodeId} recovery is required.`);
      await emitAttemptEvent(recovery, "executor invocation is ambiguous; no automatic retry");
      throw new RunLifecycleError(`Task ${nodeId} has an ambiguous prior attempt; recovery is required.`);
    }
    const attempt = await attemptJournal.reserve({
      runId,
      nodeId,
      operationId: options.operationLease.operationId,
      fencingToken: options.operationLease.fencingToken,
      kind,
      baseCommit,
      ...(waveId !== undefined ? { waveId } : {}),
      ...(worktreePath !== undefined ? { worktreePath } : {}),
      ...(current.targetContext?.fingerprint !== undefined ? { targetFingerprint: current.targetContext.fingerprint } : {}),
      contractHash: digest(current.planning ?? current.decomposition ?? nodeId),
      promptHash: digest(current.userPrompt),
      executorConfigHash: digest(effectiveExecutionConfig(current.executionConfig)),
      executor,
      idempotencyKey: `${runId}:${nodeId}:${kind}:${baseCommit}:${prior.length}`
    });
    await emitAttemptEvent(attempt);
    return { attempt };
  };

  const transitionAttempt = async (
    attempt: TaskAttempt,
    state: TaskAttemptState,
    patch: Parameters<JsonTaskAttemptJournal["transition"]>[1] extends infer T
      ? T extends object ? Omit<T, "expectedVersion" | "lease" | "state"> : never
      : never
  ): Promise<TaskAttempt> => {
    if (options.operationLease === undefined) throw new RunLifecycleError("Attempt lease missing.");
    const next = await attemptJournal.transition(attempt.attemptId, {
      ...patch,
      expectedVersion: attempt.version,
      lease: options.operationLease,
      state
    });
    await emitAttemptEvent(next);
    return next;
  };

  const terminalizeThrownAttempt = async (
    attempt: TaskAttempt,
    signal: AbortSignal | undefined,
    error: unknown
  ): Promise<void> => {
    const state: TaskAttemptState = signal?.aborted === true ? "cancelled" : "failed";
    await transitionAttempt(attempt, state, {
      error: {
        code: state === "cancelled" ? "cancelled" : "execution_failed",
        message: error instanceof Error ? error.message : String(error)
      }
    }).catch(() => undefined);
  };

  const makeRunExecutor = (sink: TraceStore, router?: ExecutorRouter) =>
    new RunExecutor({
      git: new SimpleGitRunner(),
      executorFactory: new DefaultAgentExecutorFactory(),
      traceStore: sink,
      repoRoot: provisioned.repoRoot,
      ...(router !== undefined ? { router } : {})
    });

  const executionConfigFor = (current: RunRecord) => effectiveExecutionConfig(current.executionConfig);
  // U2A-2: each stage runs at its OWN resolved effort, not a single run-level
  // knob. Override the per-call config's reasoningEffort with the stage's effort
  // (or clear it when the stage's model exposes none).
  const configForStage = (
    base: ReturnType<typeof executionConfigFor>,
    selection: { effort?: EffortLevel }
  ): ReturnType<typeof executionConfigFor> => {
    if (selection.effort !== undefined) {
      return { ...base, reasoningEffort: selection.effort };
    }
    const rest = { ...base };
    delete rest.reasoningEffort;
    return rest;
  };
  const hasExplicitRunSelection = (current: RunRecord): boolean =>
    current.defaultExecutionSelection !== undefined || current.defaultRepairSelection !== undefined;

  /**
   * Complexity router over the CLIs actually installed on this machine. The
   * availability probe runs once per process; a gemini-only box degrades to
   * gemini lanes instead of failing leaves with ENOENT.
   */
  const routerFor = async (current: RunRecord): Promise<ExecutorRouter | undefined> => {
    if (executionConfigFor(current).routing === "fixed" || hasExplicitRunSelection(current)) {
      return undefined;
    }
    availableExecutors ??= probeExecutorAvailability();
    return new ComplexityRoutingPolicy({ available: await availableExecutors });
  };

  const persistNodeResult = async (
    graph: TaskGraph,
    nodeResult:
      | { kind: "leaf"; result: AgentExecutionResult; worktrees: never[] }
      | Awaited<ReturnType<RunExecutor["runNode"]>>,
    traces: TraceStore
  ): Promise<void> => {
    await updateRunForOperation(runId, options.operationLease, (current) => ({
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
    const runExecutor = makeRunExecutor(traceStore, await routerFor(current));
    const selection = executionSelection(current);
    const node = taskGraph.nodes[params.taskId];
    if (node === undefined) throw new RunLifecycleError(`Unknown task ${params.taskId}.`);
    const kind: TaskAttemptKind = node.kind === "integrator" ? "integrator" : "scheduled";
    const prepared = await beginAttempt(
      current,
      params.taskId,
      kind,
      taskGraph.baseCommit,
      selection,
      undefined,
      params.waveId
    );
    let attempt = prepared.attempt;
    if (prepared.reuse !== undefined) return { result: prepared.reuse };
    attempt = await transitionAttempt(attempt, "invocation_reserved", {});
    attempt = await transitionAttempt(attempt, "executor_running", {});

    const signal = getRunAbort(runId)?.signal;
    let nodeResult: Extract<Awaited<ReturnType<RunExecutor["runNode"]>>, { kind: "leaf" }>;
    try {
      const candidate = await runExecutor.runNode({
        graph: taskGraph,
        config: configForStage(executionConfigFor(current), selection),
        model: current.model,
        defaultExecutionSelection: selection,
        runId,
        taskId: params.taskId,
        attemptId: attempt.attemptId,
        ...(signal !== undefined ? { signal } : {})
      });
      if (candidate.kind !== "leaf") {
        throw new Error(`Expected leaf result for node ${params.taskId}, got ${candidate.kind}`);
      }
      nodeResult = candidate;
    } catch (error) {
      await terminalizeThrownAttempt(attempt, signal, error);
      throw error;
    }
    const result = { ...nodeResult.result, attemptId: attempt.attemptId };
    attempt = await transitionAttempt(attempt, "executor_finished", {
      executorResult: {
        exitCode: result.executorExitCode,
        timedOut: result.executorTimedOut,
        durationMs: result.executorDurationMs
      }
    });
    attempt = await transitionAttempt(attempt, "diff_captured", {
      diffIdentity: {
        baseHead: result.baseHead,
        currentHead: result.currentHead,
        hash: digest(result.diff),
        files: result.changedFiles
      }
    });
    attempt = await transitionAttempt(attempt, "scope_evaluated", { scopeResult: result.scopeCheck });
    if (result.validationResult !== undefined) {
      attempt = await transitionAttempt(attempt, "validation_finished", { validationResult: result.validationResult });
    }
    if (result.commitSha !== undefined) {
      attempt = await transitionAttempt(attempt, "commit_created", { commitSha: result.commitSha });
    }
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
    await persistNodeResult(taskGraph, { ...nodeResult, result }, traceStore);
    await transitionAttempt(attempt, "result_persisted", {
      ...(result.commitSha !== undefined ? { commitSha: result.commitSha } : {}),
      nodeDisposition: result.disposition ?? result.status
    });
    return { result };
  };

  const repairLeaf = async (
    params: LeafExecutionInput & { validationOutput: string }
  ): Promise<{ result: AgentExecutionResult } | null> => {
    const current = await getRunRepository().get(runId);
    const traceStore = traceStoreFactory();
    const runExecutor = makeRunExecutor(traceStore, await routerFor(current));
    const selection = repairSelection(current);
    const prepared = await beginAttempt(
      current,
      params.taskId,
      "repair",
      taskGraph.baseCommit,
      selection,
      undefined,
      params.waveId
    );
    let attempt = prepared.attempt;
    if (prepared.reuse !== undefined) return { result: prepared.reuse };
    attempt = await transitionAttempt(attempt, "invocation_reserved", {});
    attempt = await transitionAttempt(attempt, "executor_running", {});

    const repairSignal = getRunAbort(runId)?.signal;
    let repairResult: Awaited<ReturnType<RunExecutor["repairLeaf"]>>;
    try {
      repairResult = await runExecutor.repairLeaf({
        graph: taskGraph,
        config: configForStage(executionConfigFor(current), selection),
        model: current.model,
        defaultRepairSelection: selection,
        runId,
        taskId: params.taskId,
        attemptId: attempt.attemptId,
        validationOutput: params.validationOutput,
        ...(repairSignal !== undefined ? { signal: repairSignal } : {})
      });
    } catch (error) {
      await terminalizeThrownAttempt(attempt, repairSignal, error);
      throw error;
    }
    const { result, worktree } = repairResult;

    const attemptedResult = { ...result, attemptId: attempt.attemptId };
    attempt = await transitionAttempt(attempt, "executor_finished", {
      executorResult: {
        exitCode: attemptedResult.executorExitCode,
        timedOut: attemptedResult.executorTimedOut,
        durationMs: attemptedResult.executorDurationMs
      }
    });
    attempt = await transitionAttempt(attempt, "diff_captured", {
      diffIdentity: {
        baseHead: attemptedResult.baseHead,
        currentHead: attemptedResult.currentHead,
        hash: digest(attemptedResult.diff),
        files: attemptedResult.changedFiles
      }
    });
    attempt = await transitionAttempt(attempt, "scope_evaluated", { scopeResult: attemptedResult.scopeCheck });
    if (attemptedResult.validationResult !== undefined) {
      attempt = await transitionAttempt(attempt, "validation_finished", { validationResult: attemptedResult.validationResult });
    }
    if (attemptedResult.commitSha !== undefined) {
      attempt = await transitionAttempt(attempt, "commit_created", { commitSha: attemptedResult.commitSha });
    }
    publishRunEvent(runId, {
      kind: "agent.run.completed",
      taskId: params.taskId,
      success: attemptedResult.status === "success",
      at: new Date().toISOString()
    });
    publishRunEvent(runId, {
      kind: "validation.completed",
      taskId: params.taskId,
      passed: attemptedResult.status === "success",
      at: new Date().toISOString()
    });
    await persistNodeResult(taskGraph, { kind: "leaf", result: attemptedResult, worktrees: [worktree] }, traceStore);
    await transitionAttempt(attempt, "result_persisted", {
      ...(attemptedResult.commitSha !== undefined ? { commitSha: attemptedResult.commitSha } : {}),
      nodeDisposition: attemptedResult.disposition ?? attemptedResult.status
    });
    return { result: attemptedResult };
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
    const selection = repairSelection(current);
    const prepared = await beginAttempt(
      current,
      params.compositeTaskId,
      "integrator",
      taskGraph.baseCommit,
      selection,
      params.repoPath
    );
    let attempt = prepared.attempt;
    if (prepared.reuse !== undefined || prepared.alreadyCompleted === true) {
      const existingIntegration = executionResultsFromRun(current).integrationResults.find(
        (entry) => entry.compositeTaskId === params.compositeTaskId
      );
      if (existingIntegration !== undefined) return existingIntegration;
    }
    attempt = await transitionAttempt(attempt, "invocation_reserved", {});
    attempt = await transitionAttempt(attempt, "executor_running", {});

    const integrateSignal = getRunAbort(runId)?.signal;
    let nodeResult: Extract<Awaited<ReturnType<RunExecutor["runNode"]>>, { kind: "integration" }>;
    try {
      const candidate = await runExecutor.runNode({
        graph: taskGraph,
        config: configForStage(executionConfigFor(current), selection),
        model: current.model,
        defaultRepairSelection: selection,
        runId,
        taskId: params.compositeTaskId,
        attemptId: attempt.attemptId,
        integrationOperation: {
          journal: integrationJournal,
          runId,
          ...(options.operationLease !== undefined ? { operationId: options.operationLease.operationId, fencingToken: options.operationLease.fencingToken } : {})
        },
        childResults: params.childResults,
        ...(integrateSignal !== undefined ? { signal: integrateSignal } : {}),
        ...(options.predictedConflicts !== undefined ? { predictedConflicts: options.predictedConflicts } : {})
      });
      if (candidate.kind !== "integration") {
        throw new Error(`Expected integration result for composite ${params.compositeTaskId}`);
      }
      nodeResult = candidate;
    } catch (error) {
      await terminalizeThrownAttempt(attempt, integrateSignal, error);
      throw error;
    }
    const result = { ...nodeResult.result, attemptId: attempt.attemptId };
    attempt = await transitionAttempt(attempt, "executor_finished", {});
    if (result.integrationCommitSha !== undefined) {
      attempt = await transitionAttempt(attempt, "commit_created", { commitSha: result.integrationCommitSha });
    }
    publishRunEvent(runId, {
      kind: "agent.run.completed",
      taskId: params.compositeTaskId,
      success: INTEGRATION_SUCCESS.has(result.status),
      at: new Date().toISOString()
    });
    await persistNodeResult(taskGraph, { ...nodeResult, result }, traceStore);
    await transitionAttempt(attempt, "result_persisted", {
      ...(result.integrationCommitSha !== undefined ? { commitSha: result.integrationCommitSha } : {}),
      nodeDisposition: result.status
    });
    return result;
  };

  const validateRun = async (params: {
    acceptedLeafFailures?: string[];
    acceptedIntegrationFailures?: string[];
  } = {}): Promise<{ passed: boolean; output?: string }> => {
    const current = await getRunRepository().get(runId);
    const { leafResults, integrationResults } = executionResultsFromRun(current);
    // Human-accepted failures count as resolved (P2b): the operator decided to
    // proceed, so the precheck treats them as OK and lets run-level validation
    // judge the integrated tree on its own merits.
    const acceptedLeaves = new Set(params.acceptedLeafFailures ?? []);
    const acceptedIntegrations = new Set(params.acceptedIntegrationFailures ?? []);
    const resultsOk =
      leafResults.length > 0 &&
      leafResults.every((result) => result.status === "success" || acceptedLeaves.has(result.taskId)) &&
      integrationResults.every(
        (result) => INTEGRATION_SUCCESS.has(result.status) || acceptedIntegrations.has(result.compositeTaskId)
      );
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
    const worktreePath = worktreePathFor({
      worktreesRoot: join(provisioned.repoRoot, ".manyhands", "worktrees"),
      runId,
      taskId: taskGraph.rootId
    });
    const validation = await new ChildProcessValidationRunner().run(commands, {
      worktreePath,
      repoRoot: provisioned.repoRoot,
      supervision: {
        runId,
        ...(options.operationLease !== undefined ? { operationId: options.operationLease.operationId } : {})
      }
    });
    traceStore.append({
      type: "validation_completed",
      actor: "system",
      payload: { scope: "run", passed: validation.passed, exitCode: validation.exitCode }
    });
    await updateRunForOperation(runId, options.operationLease, (record) => ({
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
      selectWave: async ({ graph: waveGraph, candidates }) => {
        const result = await selectAndPersistSchedulingWave({
          runId,
          graph: waveGraph,
          candidates,
          source: "execution-host",
          effectiveConfig: executionConfigFor(run),
          riskMatrix,
          ...(staticConflictSignals !== undefined ? { staticSignals: staticConflictSignals } : {}),
        });
        console.log("[Runner] Risk-aware wave selected", {
          runId,
          policy: result.payload.policy,
          readyTaskCount: result.payload.readyTaskIds.length,
          selectedTaskCount: result.payload.selectedTaskIds.length,
          blockedByRiskCount: result.payload.blockedTaskIds.length,
          warnings: result.payload.warnings.map((warning) => warning.code)
        });
        for (const warning of result.payload.warnings) {
          console.warn(`[Runner] Scheduling fallback for run ${runId}: ${warning.message}`);
        }
        return { taskIds: result.selectedTaskIds, waveId: result.payload.waveId };
      }
    },
    leafGateDeps: {
      beforeRetryDispatch: ({ taskId }) => persistRetryDispatch({ runId, taskId })
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

/** Identity of the latest durable execution checkpoint, when one exists. */
export async function executionCheckpointId(runId: string): Promise<string | undefined> {
  const checkpointer = new JsonFileCheckpointSaver(join(resolveRunsDirectory(), "checkpoints"));
  return (await checkpointer.getTuple({ configurable: { thread_id: runId } }))?.checkpoint.id;
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
  | { kind: "aborted" }
  | {
      kind: "finished";
      status: "completed" | "failed";
      /** True when the run completed with human-accepted leaf/integration failures (P2b). */
      acceptedResolutions?: boolean;
      errorMessage?: string;
    };

/**
 * Stream the graph until it finishes, suspends on a gate interrupt, or the
 * run is aborted. On interrupt, projects the gate into the RunRecord
 * (pendingDecision + the human-readable pendingQuestion the DecisionChannel
 * renders) and pauses. On abort the stream is cut between supersteps — the
 * checkpoint of the last completed superstep is already persisted, so the run
 * stays resumable via restart.
 */
export async function driveExecution(
  host: ExecutionHost,
  input: Record<string, unknown> | Command | null,
  signal?: AbortSignal
): Promise<ExecutionDriveOutcome> {
  // The runtime accepts state input, a resume Command, or null (continue);
  // the generated generics are narrower than the runtime contract.
  const stream = await host.graph.stream(input as never, { ...host.threadConfig, streamMode: "updates" });
  for await (const _chunk of stream) {
    void _chunk;
    // Updates are persisted by the deps themselves; the stream is consumed to
    // drive the graph to its next suspension point.
    if (isAborted(signal)) {
      await (stream as unknown as { return?: () => Promise<unknown> }).return?.();
      return { kind: "aborted" };
    }
    await waitWhilePlainPaused(host.threadConfig.configurable.thread_id, "running", signal);
    if (isAborted(signal)) {
      await (stream as unknown as { return?: () => Promise<unknown> }).return?.();
      return { kind: "aborted" };
    }
  }
  if (isAborted(signal)) {
    return { kind: "aborted" };
  }

  const state = await host.graph.getState(host.threadConfig);
  const interrupt = state.tasks.flatMap((task) => task.interrupts)[0]?.value as
    | LeafValidationInterrupt
    | MergeConflictInterrupt
    | BudgetExceededInterrupt
    | undefined;

  if (interrupt !== undefined) {
    return { kind: "paused", gate: gateFromInterrupt(interrupt) };
  }

  const values = state.values as
    | {
        status?: string;
        errorMessage?: string | null;
        acceptedLeafFailures?: string[];
        acceptedIntegrationFailures?: string[];
      }
    | undefined;
  if (values?.status === "completed") {
    const acceptedResolutions =
      (values.acceptedLeafFailures?.length ?? 0) > 0 || (values.acceptedIntegrationFailures?.length ?? 0) > 0;
    return { kind: "finished", status: "completed", ...(acceptedResolutions ? { acceptedResolutions } : {}) };
  }
  return {
    kind: "finished",
    status: "failed",
    errorMessage: values?.errorMessage ?? "Execution failed during run-level validation."
  };
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function gateFromInterrupt(
  interrupt: LeafValidationInterrupt | MergeConflictInterrupt | BudgetExceededInterrupt
): NonNullable<RunRecord["pendingDecision"]> {
  // Unique per suspension: a resume carrying this id can only resolve THIS
  // interruption (INV-4). A re-suspension of the same task mints a fresh id,
  // so decisions aimed at the previous gate 409 instead of resolving it.
  if (interrupt.type === "leaf_validation_failed") {
    return {
      gate: "leaf_validation_failed",
      gateId: mintGateId("leaf_validation_failed", interrupt.taskId),
      taskId: interrupt.taskId,
      validationOutput: interrupt.validationOutput
    };
  }
  if (interrupt.type === "budget_exceeded") {
    return {
      gate: "budget_exceeded",
      gateId: mintGateId("budget_exceeded", interrupt.runId),
      taskId: interrupt.runId,
      spentTokens: interrupt.spentTokens,
      spentUsd: interrupt.spentUsd,
      pendingTasks: interrupt.pendingTasks
    };
  }
  return {
    gate: "merge_conflict",
    gateId: mintGateId("merge_conflict", interrupt.compositeTaskId),
    taskId: interrupt.compositeTaskId,
    ...(interrupt.conflictDetails !== undefined ? { conflictFiles: interrupt.conflictDetails.files } : {}),
    integrationStatus: interrupt.status,
    failureClass: interrupt.failureClass,
    ...(interrupt.validationExitCode !== undefined ? { validationExitCode: interrupt.validationExitCode } : {})
  };
}

function mintGateId(gate: string, taskId: string): string {
  return `${gate}:${taskId}:${randomUUID().slice(0, 8)}`;
}

/**
 * Question + option order for a merge_conflict gate, by failure class. The
 * postmortem run showed an npm-not-found (exit 127) presented as "conflictos
 * que el Composer no pudo resolver" — with zero actual conflicts. Copy must
 * say what really happened; options lead with the most sensible action.
 */
function mergeConflictGateCopy(gate: NonNullable<RunRecord["pendingDecision"]>): {
  question: string;
  options: string[];
} {
  const labelFor = (action: string): string =>
    CONFLICT_GATE_OPTIONS.find((option) => option.action === action)?.label ?? action;
  const exitSuffix = gate.validationExitCode !== undefined ? ` (exit ${gate.validationExitCode})` : "";

  switch (gate.failureClass) {
    case "infra":
      return {
        question:
          `La integración de "${gate.taskId}" no pudo validarse por un fallo del entorno` +
          `${exitSuffix}: el comando de validación no se pudo ejecutar (binario no encontrado, ` +
          `comando rechazado o timeout). No hubo conflictos de merge. ` +
          `Arreglá el entorno y reintentá. ¿Cómo querés continuar?`,
        options: [labelFor("retry_integration"), labelFor("accept_conflict"), labelFor("abort_run")]
      };
    case "code_validation":
      return {
        question:
          `La integración de "${gate.taskId}" se aplicó sin conflictos, pero la validación ` +
          `del padre falló${exitSuffix}. ¿Cómo querés continuar?`,
        options: [labelFor("accept_conflict"), labelFor("retry_integration"), labelFor("abort_run")]
      };
    case "merge_conflict":
      return {
        question: `La integración de "${gate.taskId}" falló con conflictos que el Composer no pudo resolver. ¿Cómo querés continuar?`,
        options: [labelFor("accept_conflict"), labelFor("retry_integration"), labelFor("abort_run")]
      };
    default:
      return {
        question: `La integración de "${gate.taskId}" falló (${gate.integrationStatus ?? "error interno"}). ¿Cómo querés continuar?`,
        options: [labelFor("retry_integration"), labelFor("accept_conflict"), labelFor("abort_run")]
      };
  }
}

/** Persist a gate pause: status, typed decision, and the projected question. */
export async function persistExecutionPause(
  runId: string,
  gate: NonNullable<RunRecord["pendingDecision"]>,
  operationLease?: RunOperationLease
): Promise<void> {
  const checkpointId = await executionCheckpointId(runId);
  const conflictCopy = gate.gate === "merge_conflict" ? mergeConflictGateCopy(gate) : undefined;
  const options =
    conflictCopy?.options ??
    (gate.gate === "leaf_validation_failed" ? LEAF_GATE_OPTIONS : BUDGET_GATE_OPTIONS).map(
      (option) => option.label
    );
  const question =
    conflictCopy?.question ??
    (gate.gate === "leaf_validation_failed"
      ? `La validación de la tarea "${gate.taskId}" falló tras la auto-reparación. ¿Cómo querés continuar?`
      : `El run alcanzó su presupuesto (${Math.round(gate.spentTokens ?? 0)} tokens / $${(gate.spentUsd ?? 0).toFixed(2)}). ` +
        `Quedan ${gate.pendingTasks?.length ?? 0} tareas pendientes. ¿Cómo querés continuar?`);

  let previous: RunRecord | undefined;
  const saved = await updateRunForOperation(runId, operationLease, (current) => {
    previous = current;
    return {
      ...current,
      status: "paused",
      pausedDuring: "running",
      pendingDecision: gate,
      pendingQuestion: { nodeId: gate.taskId, question, options }
    };
  });

  const now = new Date().toISOString();
  await appendStatusAndRunEventsOrRollback(
    requireCapturedRunRecord(previous, runId),
    saved,
    [
      {
        actor: "system",
        at: now,
        type: "decision.raised",
        payload: {
          decisionId: `clarify:${gate.taskId}`,
          kind: "clarify",
          blocking: true,
          context: {
            nodeIds: [gate.taskId],
            question,
            options,
            gate: gate.gate,
            ...(checkpointId !== undefined ? { checkpointId } : {}),
            ...(gate.gateId !== undefined ? { gateId: gate.gateId } : {})
          }
        }
      }
    ],
    { at: now, ...(operationLease !== undefined ? { lease: operationLease } : {}) }
  );
}

/**
 * Claim and clear the gate projection when a resume decision is accepted.
 * The claim verifies — inside the per-run write lock — that the gate is still
 * pending (and matches `expectedGateId` when the caller has one), then clears
 * it atomically so a concurrent duplicate decision gets a deterministic 409.
 */
export async function clearExecutionPause(
  runId: string,
  target: "running",
  expectedGateId?: string,
  expectedVersion?: number,
  requiredEvents: readonly RunModelEventInput[] = []
): Promise<RunRecord> {
  let previous: RunRecord | undefined;
  const updated = await claimRunMutation(
    runId,
    {
      status: ["paused"],
      pausedDuring: "running",
      pendingDecisionGateId: expectedGateId ?? "any",
      rejectFreshOperationAfterMs: DEFAULT_STALE_MS,
      ...(expectedVersion !== undefined ? { version: expectedVersion } : {})
    },
    (current) => {
      previous = current;
      const next = { ...current, status: target } as RunRecord;
      delete next.pausedDuring;
      delete next.pendingDecision;
      delete next.pendingQuestion;
      return next;
    }
  );
  const statusOptions = {
    actor: "human" as const,
    ...(requiredEvents[0]?.at !== undefined ? { at: requiredEvents[0].at } : {})
  };
  await appendStatusAndRunEventsOrRollback(
    requireCapturedRunRecord(previous, runId),
    updated,
    requiredEvents,
    statusOptions
  );
  return updated;
}

/** Build the Command that resumes a suspended execution graph natively. */
export function resumeCommand(decision: ResumeDecision): Command {
  return new Command({ resume: decision });
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
