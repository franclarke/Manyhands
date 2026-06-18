import { deriveConflictList } from "@/lib/conflict-view-model";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import {
    DefaultAgentExecutorFactory,
    ExecutionConfigSchema,
    GroundingAgent,
    RunExecutor,
    SimpleGitRunner,
    type AgentExecutionResult,
    type PredictedConflictHint,
    type RunExecutionResult,
    type RunNodeExecutionResult
} from "@manyhands/execution-core";
import type { ResumeDecision } from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore, type TraceStore } from "@manyhands/trace-store";
import { RepoNotConfiguredError, RunLifecycleError, RunValidationError } from "./errors";
import { publishRunEvent } from "./event-bus";
import type { StreamEvent } from "./events";
import {
    buildExecutionHost,
    driveExecution,
    hasExecutionCheckpoint,
    persistExecutionPause,
    resumeCommand,
    type ExecutionDriveOutcome
} from "./execution-host";
import {
    INTEGRATION_SUCCESS,
    buildExecutionArtifact,
    computeInvalidatedTasks,
    deriveRunValidationSummary,
    executionResultsFromRun,
    manualReadinessForTask,
    mergeNodeExecutionResult,
    provisionedFromRecord,
    resolveExecutionGraph
} from "./execution-state";
import { applyFinalPatch } from "./final-apply";
import { groundingSelection } from "./executor-selection";
import { assertTransition } from "./lifecycle";
import { LiveExecutionTraceStore } from "./live-trace-store";
import { waitWhilePlainPaused } from "./pause-control";
import { PreflightError, runPreflight } from "./preflight";
import { acquireRepoLock, releaseRepoLock } from "./repo-lock";
import {
    createDefaultRepoProvisioner,
    type ProvisionedRepo,
    type RepoProvisioner
} from "./repo-provisioner";
import { createRunAbort, disposeRunAbort } from "./run-abort-registry";
import {
    ensureRunModelEventLogForRun,
    publishRunModelEvent
} from "./run-model-event-log";
import { transitionTo } from "./planning-pipeline";
import { reconcileExecutionWorld } from "./world-reconcile";
import { type RunTitle } from "./run-titler";
import { startHeartbeat } from "./runner-heartbeat";
import { markRunnerInactive, startRunBackgroundTask, tryMarkRunnerActive } from "./runner-state";
import { startBudgetWatchdog } from "./runner-watchdog";
import { appendRunStatusChanged } from "./run-status-events";
import type {
    ExecutionConfigInput,
    NodeReview,
    RunRecord
} from "./schema";
import { getRunRepository } from "./store";

export { computeInvalidatedTasks } from "./execution-state";
export type { ExecutionResults } from "./execution-state";


// Re-export for the SSE endpoint to detect orphaned runs.
export { isRunnerActive } from "./runner-state";

export interface PlanningRunnerOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the real Gemini-backed titler. */
  titler?: (input: { userPrompt: string; model: string }) => Promise<RunTitle>;
}

/**
 * Execution seam (C17). The pipeline resolves the graph and maps results to
 * SSE; the engine owns the actual run. The default engine drives the real
 * RunExecutor against a git repo, but tests (and future provisioning layers)
 * can inject their own to stay deterministic without disk/network/Codex.
 */
export interface ExecutionEngineInput {
  graph: TaskGraph;
  model: string;
  defaultExecutionSelection?: RunRecord["defaultExecutionSelection"];
  defaultRepairSelection?: RunRecord["defaultRepairSelection"];
  runId: string;
  /** Trace sink owned by the web runner; engines append here for live UI updates and persisted evidence. */
  traceStore?: TraceStore;
  /** Real repo provisioned for this run (C17). Required by the default engine. */
  provisioned?: ProvisionedRepo;
  /** Optional per-run config overrides; defaults applied by the engine. */
  executionConfig?: ExecutionConfigInput;
  /** Run-level cancellation: aborts in-flight executors and stops scheduling. */
  signal?: AbortSignal;
  /** Awaited at each batch boundary (pause hold); resolves to continue. */
  onBatchBoundary?: () => Promise<void>;
  /** Conflicts predicted at planning time; feed the conflict-aware composer (D8). */
  predictedConflicts?: PredictedConflictHint[];
}

export interface ExecutionEngine {
  run(input: ExecutionEngineInput): Promise<RunExecutionResult>;
}

export interface ExecutionRunnerOptions {
  intervalMs?: number;
  engine?: ExecutionEngine;
  /** Injectable for tests; default prepares the configured target repo. */
  provisioner?: RepoProvisioner;
  /** Injectable for tests; receives the engine's trace events to persist as evidence. */
  traceStore?: TraceStore;
  /** Internal route seam: caller already claimed runner-state before dispatch. */
  runnerAlreadyClaimed?: boolean;
}

async function runNodeWithDefaultEngine(input: {
  graph: TaskGraph;
  model: string;
  taskId: string;
  runId: string;
  provisioned: ProvisionedRepo;
  executionConfig?: ExecutionConfigInput;
  childResults?: AgentExecutionResult[];
  traceStore: TraceStore;
}): Promise<RunNodeExecutionResult> {
  const runExecutor = new RunExecutor({
    git: new SimpleGitRunner(),
    executorFactory: new DefaultAgentExecutorFactory(),
    traceStore: input.traceStore,
    repoRoot: input.provisioned.repoRoot
  });
  return runExecutor.runNode({
    graph: {
      ...input.graph,
      repo: input.provisioned.repoRoot,
      baseBranch: input.provisioned.baseBranch,
      baseCommit: input.provisioned.baseCommit
    },
    config: ExecutionConfigSchema.parse(input.executionConfig ?? {}),
    model: input.model,
    runId: input.runId,
    taskId: input.taskId,
    ...(input.childResults !== undefined ? { childResults: input.childResults } : {})
  });
}

/**
 * Build a FeatureRequest from the user's natural-language prompt.
 */
export async function runExecutionPipeline(runId: string, options: ExecutionRunnerOptions = {}): Promise<void> {
  console.log(`[Runner] Starting execution pipeline for run: ${runId}`);
  if (options.runnerAlreadyClaimed !== true && !tryMarkRunnerActive(runId)) {
    console.warn(`[Runner] Execution pipeline already active for run: ${runId}`);
    return;
  }
  const stopHeartbeat = startHeartbeat(runId);
  let stopBudgetWatchdog: () => void = () => undefined;
  let lockedRepoRoot: string | undefined;
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "approved") {
      run = await transitionTo(run, "running", { startedAt: run.startedAt ?? new Date().toISOString() });
    }

    const graph = await resolveExecutionGraph(run);
    console.log(
      `[Runner] Execution graph resolved for run ${runId}: root=${graph.rootId}, nodes=${Object.keys(graph.nodes).length}, dependencies=${graph.dependencies.length}`
    );
    const usingDefaultEngine = options.engine === undefined;

    await ensureRunModelEventLogForRun(run);

    let provisioned: ProvisionedRepo | undefined = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined && run.repoSpec !== undefined) {
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      console.log(`[Runner] Provisioning repo for run ${runId}: kind=${run.repoSpec.kind}`);
      provisioned = await provisioner.provision({ spec: run.repoSpec, runId: run.runId });
      console.log(
        `[Runner] Repo provisioned for run ${runId}: repoRoot=${provisioned.repoRoot}, baseBranch=${provisioned.baseBranch}, baseCommit=${provisioned.baseCommit}`
      );
      run = await getRunRepository().save({
        ...run,
        provisioned: {
          repoRoot: provisioned.repoRoot,
          baseBranch: provisioned.baseBranch,
          baseCommit: provisioned.baseCommit,
          provisionedAt: new Date().toISOString()
        }
      });
    } else if (usingDefaultEngine) {
      console.error(
        `[Runner] El run ${runId} no tiene repoSpec configurado y el engine real requiere un repo. ` +
          "Configurá un workspace con un repo git local."
      );
      throw new RepoNotConfiguredError(run.runId);
    }

    // One active pipeline per target repo (U7): atomic lock, stale locks of
    // crashed owners are stolen. Released in the finally below.
    if (provisioned !== undefined) {
      await claimRepoOrThrow(provisioned.repoRoot, runId);
      lockedRepoRoot = provisioned.repoRoot;
    }

    const abortController = createRunAbort(runId);
    stopBudgetWatchdog = startBudgetWatchdog(runId, run.executionConfig?.maxWallClockMs);

    if (options.engine !== undefined) {
      console.log(`[Runner] Running mock/custom engine for run ${runId}`);
      const traceStore = new LiveExecutionTraceStore(
        options.traceStore ?? new InMemoryTraceStore(),
        runId,
        run.model
      );

      const result = await options.engine.run({
        runId: run.runId,
        graph,
        provisioned: provisioned!,
        executionConfig: run.executionConfig ?? {},
        traceStore,
        signal: abortController.signal,
        onBatchBoundary: () => waitWhilePlainPaused(runId, "running", abortController.signal),
        model: run.model
      });

      // Cooperative cancellation check
      const afterEngine = await getRunRepository().get(runId);
      if (afterEngine.status === "interrupted") {
        console.log(`[Runner] Run ${runId} interrupted after engine returned; persisting partial execution.`);
        const cancelTraces = traceStore.list();
        await getRunRepository().save({
          ...afterEngine,
          execution: result,
          ...(cancelTraces.length > 0 ? { executionTraces: [...(afterEngine.executionTraces ?? []), ...cancelTraces] } : {})
        });
        return;
      }
      await waitWhilePlainPaused(runId, "running", abortController.signal);
      const afterPause = await getRunRepository().get(runId);
      if (afterPause.status === "interrupted") {
        console.log(`[Runner] Run ${runId} interrupted after pause hold; keeping partial execution.`);
        return;
      }

      const finalApplication =
        result.status === "completed" && provisioned !== undefined
          ? await (async () => {
              console.log(`[Runner] Final apply start for run ${runId}`);
              const applied = await applyFinalPatch({ graph, result, provisioned: provisioned!, runId, slug: run.title });
              console.log(
                `[Runner] Final apply complete for run ${runId}: status=${applied?.finalApplicationStatus ?? "(none)"} branch=${applied?.finalBranchName ?? "(none)"} commit=${applied?.finalCommitSha ?? "(none)"}`
              );
              return applied;
            })()
          : undefined;

      // Publish stream events for mock results
      for (const leaf of result.leafResults) {
        if (!traceStore.hasPublishedStart(leaf.taskId)) {
          publishEvent(runId, {
            kind: "agent.run.started",
            taskId: leaf.taskId,
            at: new Date().toISOString()
          });
        }
        publishEvent(runId, {
          kind: "agent.run.completed",
          taskId: leaf.taskId,
          success: leaf.status === "success",
          at: new Date().toISOString()
        });
        publishEvent(runId, {
          kind: "validation.completed",
          taskId: leaf.taskId,
          passed: leaf.status === "success",
          at: new Date().toISOString()
        });
      }

      for (const integration of result.integrationResults) {
        if (!traceStore.hasPublishedStart(integration.compositeTaskId)) {
          publishEvent(runId, {
            kind: "agent.run.started",
            taskId: integration.compositeTaskId,
            at: new Date().toISOString()
          });
        }
        const success = integration.status === "success" || integration.status === "executor_repair_success";
        publishEvent(runId, {
          kind: "agent.run.completed",
          taskId: integration.compositeTaskId,
          success,
          at: new Date().toISOString()
        });
      }

      const executionTraces = traceStore.list();
      publishRunModelEventsFromExecutionResult(run, graph, result, finalApplication);
      const currentRun = await getRunRepository().get(runId);
      if (result.status === "completed") {
        console.log(`[Runner] Persisting completed run ${runId}`);
        await transitionTo(currentRun, "completed", {
          execution: result,
          ...(executionTraces.length > 0 ? { executionTraces: [...(currentRun.executionTraces ?? []), ...executionTraces] } : {}),
          ...(finalApplication !== undefined ? finalApplication : {}),
          completedAt: new Date().toISOString()
        });
      } else {
        console.warn(`[Runner] Persisting failed run ${runId}`);
        const saved = await getRunRepository().save({
          ...currentRun,
          status: result.status === "failed" ? "failed" : "interrupted",
          failedDuring: "running",
          execution: result,
          ...(executionTraces.length > 0 ? { executionTraces: [...(currentRun.executionTraces ?? []), ...executionTraces] } : {}),
          errorMessage: result.status === "failed" ? "Execution failed" : "Budget exceeded"
        });
        await appendRunStatusChanged(saved);
      }
      return;
    }

    if (usingDefaultEngine && provisioned !== undefined) {
      console.log(`[Runner] Preflight start for run ${runId}`);
      const preflight = await runPreflight({
        repoRoot: provisioned.repoRoot,
        baseBranch: provisioned.baseBranch,
        legacyModel: run.model,
        graph,
        groundingSelection: groundingSelection(run),
        ...(run.defaultExecutionSelection !== undefined
          ? { defaultExecutionSelection: run.defaultExecutionSelection }
          : {}),
        ...(run.defaultRepairSelection !== undefined ? { defaultRepairSelection: run.defaultRepairSelection } : {})
      });
      for (const warning of preflight.warnings) {
        console.warn(`[Runner] Preflight warning (${warning.check}) for run ${runId}: ${warning.message}`);
      }
      console.log(`[Runner] Preflight ok for run ${runId}`);
    }

    // Cold resume (restart after crash/cancel): reconcile the physical world
    // against the recorded state BEFORE re-entering the graph (INV-3). May
    // filter invalidated results and reset the thread, in which case the run
    // re-enters from scratch seeded with the surviving artifact.
    let alreadyStarted = await hasExecutionCheckpoint(runId);
    if (alreadyStarted && usingDefaultEngine && provisioned !== undefined) {
      const reconciled = await reconcileExecutionWorld(run, provisioned);
      run = reconciled.run;
      if (reconciled.threadReset) {
        alreadyStarted = false;
      }
    }

    // First start of this thread: freeze the seams, scaffold the walking
    // skeleton (GroundingAgent) and persist the skeleton commit as the base
    // every leaf branches from. A resumed/restarted thread skips grounding.
    if (!alreadyStarted) {
      publishRunModelEvent(run.runId, {
        actor: "system",
        at: new Date().toISOString(),
        type: "grounding.started",
        payload: {}
      });
      const nowStr = new Date().toISOString();
      for (const node of Object.values(graph.nodes)) {
        for (const iface of node.contract?.producedInterfaces ?? []) {
          publishRunModelEvent(run.runId, {
            actor: "system",
            at: nowStr,
            type: "seam.frozen",
            payload: {
              seamId: iface.id,
              revision: 1,
              frozenSignature: iface.signature,
              extractedFrom: `contract:${node.id}`
            }
          });
        }
      }

      const groundingAgent = new GroundingAgent();
      const skeletonCommit = await groundingAgent.run({
        repoRoot: provisioned!.repoRoot,
        graph,
        selection: groundingSelection(run),
        runId: run.runId
      });
      provisioned!.baseCommit = skeletonCommit;
      run = await getRunRepository().save({
        ...run,
        provisioned: {
          repoRoot: provisioned!.repoRoot,
          baseBranch: provisioned!.baseBranch,
          baseCommit: skeletonCommit,
          provisionedAt: run.provisioned?.provisionedAt ?? new Date().toISOString()
        }
      });

      publishRunModelEvent(run.runId, {
        actor: "system",
        at: new Date().toISOString(),
        type: "grounding.completed",
        payload: { skeletonCommit }
      });
    }

    const host = buildExecutionHost(run, provisioned!, {
      traceStoreFactory: () =>
        new LiveExecutionTraceStore(options.traceStore ?? new InMemoryTraceStore(), runId, run.model),
      predictedConflicts: derivePredictedConflicts(run)
    });

    // Seed surviving results (e.g. after a seam amendment filtered the
    // execution artifact and reset the thread) so the frontier only
    // re-dispatches invalidated tasks.
    const seed = executionResultsFromRun(run);
    const budgetLimits =
      run.executionConfig?.maxTokensTotal !== undefined || run.executionConfig?.maxCostUsd !== undefined
        ? {
            ...(run.executionConfig.maxTokensTotal !== undefined
              ? { maxTokensTotal: run.executionConfig.maxTokensTotal }
              : {}),
            ...(run.executionConfig.maxCostUsd !== undefined ? { maxCostUsd: run.executionConfig.maxCostUsd } : {})
          }
        : null;

    const initialState = {
      runId,
      userPrompt: run.userPrompt,
      workspaceId: run.workspaceId,
      repoPath: provisioned!.repoRoot,
      taskGraph: host.taskGraph,
      planningQueue: [],
      planningStepCache: {},
      leafResults: seed.leafResults,
      integrationResults: seed.integrationResults,
      acceptedLeafFailures: [],
      acceptedIntegrationFailures: [],
      budgetLimits,
      finishPartial: false,
      pendingQuestion: null,
      userAnswers: {},
      status: "running" as const,
      errorMessage: null
    };

    const outcome = await driveExecution(host, alreadyStarted ? null : initialState, abortController.signal);
    await waitWhilePlainPaused(runId, "running", abortController.signal);
    await settleExecutionOutcome(runId, host, outcome, provisioned!, options);
  } catch (error) {
    console.error(`[Runner] FALLO la ejecucion del run "${runId}":`, error);
    await settleExecutionException(runId, error);
  } finally {
    if (lockedRepoRoot !== undefined) {
      await releaseRepoLock(lockedRepoRoot, runId).catch(() => undefined);
    }
    stopBudgetWatchdog();
    disposeRunAbort(runId);
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

/**
 * Persist the outcome of an unhandled pipeline exception (INV-5): when the
 * thread already has a checkpoint the failure is recoverable — the run goes
 * to `interrupted` (restart reconciles and resumes) instead of a dead-end
 * `failed`. Plain `failed` remains only for preconditions (preflight, busy
 * repo, missing repo) where there is nothing to resume.
 */
async function settleExecutionException(runId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const run = await getRunRepository().get(runId).catch(() => null);
  if (run === null) return;
  if (run.status === "interrupted") {
    console.log(`[Runner] Run ${runId} was interrupted; not saving status as failed.`);
    return;
  }

  const precondition = error instanceof PreflightError || error instanceof RepoNotConfiguredError;
  const recoverable = !precondition && (await hasExecutionCheckpoint(runId).catch(() => false));
  if (recoverable) {
    const saved = await getRunRepository().save({
      ...run,
      status: "interrupted",
      interruptedDuring: "running",
      errorMessage: `interrupted: ${message} (reanudable con restart — el checkpoint del último paso completo sobrevive)`
    });
    await appendRunStatusChanged(saved);
    return;
  }

  const saved = await getRunRepository().save({ ...run, status: "failed", failedDuring: "running", errorMessage: message });
  await appendRunStatusChanged(saved);
}

/**
 * Acquire the per-repo run lock or fail preflight-style with an actionable
 * message naming the owner (U7).
 */
async function claimRepoOrThrow(repoRoot: string, runId: string): Promise<void> {
  const lock = await acquireRepoLock(repoRoot, runId);
  if (!lock.acquired) {
    throw new PreflightError(
      "repo_busy",
      `El repo ${repoRoot} está siendo usado por el run ${lock.owner.runId} (pid ${lock.owner.pid}). ` +
        "Cancelá ese run o esperá a que termine antes de ejecutar otro sobre el mismo repo."
    );
  }
  if (lock.stolen) {
    console.warn(`[Runner] Repo lock for ${repoRoot} was stale and stolen by run ${runId}.`);
  }
}

/**
 * Resume a paused execution natively: delivers the human gate decision to
 * the suspended LangGraph thread via Command({ resume }) - no checkpoint
 * surgery - and settles the run exactly like the initial start.
 */
export async function resumeExecutionPipeline(
  runId: string,
  decision: ResumeDecision,
  options: ExecutionRunnerOptions = {}
): Promise<void> {
  console.log(`[Runner] Resuming execution for run ${runId} with decision:`, decision);
  if (options.runnerAlreadyClaimed !== true && !tryMarkRunnerActive(runId)) {
    console.warn(`[Runner] Execution pipeline already active for run: ${runId}`);
    return;
  }
  const stopHeartbeat = startHeartbeat(runId);
  let stopBudgetWatchdog: () => void = () => undefined;
  let lockedRepoRoot: string | undefined;
  try {
    const run = await getRunRepository().get(runId);
    const provisioned = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined) {
      throw new RepoNotConfiguredError(runId);
    }

    await claimRepoOrThrow(provisioned.repoRoot, runId);
    lockedRepoRoot = provisioned.repoRoot;

    const abortController = createRunAbort(runId);
    stopBudgetWatchdog = startBudgetWatchdog(runId, run.executionConfig?.maxWallClockMs);

    const host = buildExecutionHost(run, provisioned, {
      traceStoreFactory: () =>
        new LiveExecutionTraceStore(options.traceStore ?? new InMemoryTraceStore(), runId, run.model),
      predictedConflicts: derivePredictedConflicts(run)
    });

    const outcome = await driveExecution(host, resumeCommand(decision), abortController.signal);
    await waitWhilePlainPaused(runId, "running", abortController.signal);
    await settleExecutionOutcome(runId, host, outcome, provisioned, options);
  } catch (error) {
    console.error(`[Runner] FALLO el resume de ejecucion del run "${runId}":`, error);
    await settleExecutionException(runId, error);
  } finally {
    if (lockedRepoRoot !== undefined) {
      await releaseRepoLock(lockedRepoRoot, runId).catch(() => undefined);
    }
    stopBudgetWatchdog();
    disposeRunAbort(runId);
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

/**
 * Shared epilogue for start/resume: persists the pause projection when the
 * graph suspended on a gate, otherwise finalizes the run (final apply,
 * run-model events, terminal status).
 */
async function settleExecutionOutcome(
  runId: string,
  host: ReturnType<typeof buildExecutionHost>,
  outcome: ExecutionDriveOutcome,
  provisioned: ProvisionedRepo,
  _options: ExecutionRunnerOptions
): Promise<void> {
  if (outcome.kind === "finished") {
    await waitWhilePlainPaused(runId, "running");
  }

  if (outcome.kind === "paused") {
    console.log(`[Runner] Execution paused at ${outcome.gate.gate} gate (task ${outcome.gate.taskId}).`);
    await persistExecutionPause(runId, outcome.gate);
    return;
  }

  if (outcome.kind === "aborted") {
    // Cancel cut the stream between supersteps; the cancel endpoint already
    // persisted `interrupted` and owns kill/GC. Keep the partial execution.
    console.log(`[Runner] Execution stream aborted for run ${runId}; keeping partial execution.`);
    return;
  }

  const currentRun = await getRunRepository().get(runId);
  if (currentRun.status === "interrupted") {
    console.log(`[Runner] Run ${runId} interrupted; keeping partial execution.`);
    return;
  }

  const existing = executionResultsFromRun(currentRun);
  const artifact = buildExecutionArtifact(runId, host.taskGraph, existing.leafResults, existing.integrationResults);
  if (artifact === undefined) {
    const saved = await getRunRepository().save({
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      errorMessage: outcome.errorMessage ?? "Execution produced no results."
    });
    await appendRunStatusChanged(saved);
    return;
  }

  const persistedValidation = (currentRun.execution as Partial<RunExecutionResult> | undefined)?.validationResult;
  const result: RunExecutionResult = {
    ...artifact,
    status: outcome.status,
    ...(persistedValidation !== undefined ? { validationResult: persistedValidation } : {})
  };
  const settledAt = new Date().toISOString();
  const validationSummary = deriveRunValidationSummary(host.taskGraph, outcome.status, persistedValidation, settledAt);

  const finalApplication =
    outcome.status === "completed"
      ? await (async () => {
          console.log(`[Runner] Final apply start for run ${runId}`);
          const applied = await applyFinalPatch({
            graph: host.taskGraph,
            result,
            provisioned,
            runId,
            slug: currentRun.title
          });
          console.log(
            `[Runner] Final apply complete for run ${runId}: status=${applied?.finalApplicationStatus ?? "(none)"} branch=${applied?.finalBranchName ?? "(none)"} commit=${applied?.finalCommitSha ?? "(none)"}`
          );
          return applied;
        })()
      : undefined;

  publishRunModelEventsFromExecutionResult(currentRun, host.taskGraph, result, finalApplication);

  if (outcome.status === "completed") {
    // A run the human steered past accepted failures still delivers its result
    // (final-apply ran above), but we record it as a distinct terminal state so
    // the UI never claims a fully-clean run (P2b).
    const terminalStatus = outcome.acceptedResolutions ? "completed_with_accepted" : "completed";
    console.log(`[Runner] Persisting ${terminalStatus} run ${runId}`);
    await transitionTo(currentRun, terminalStatus, {
      execution: result,
      ...(finalApplication !== undefined ? finalApplication : {}),
      ...(validationSummary !== undefined ? { validation: validationSummary } : {}),
      completedAt: settledAt
    });
  } else {
    console.warn(`[Runner] Persisting failed run ${runId}`);
    const saved = await getRunRepository().save({
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      execution: result,
      ...(validationSummary !== undefined ? { validation: validationSummary } : {}),
      errorMessage: outcome.errorMessage ?? describeExecutionFailure(result)
    });
    await appendRunStatusChanged(saved);
  }
}



export async function runNodeExecutionPipeline(
  runId: string,
  taskId: string,
  options: ExecutionRunnerOptions = {}
): Promise<void> {
  console.log(`[Runner] Starting node execution pipeline for run=${runId} task=${taskId}`);
  if (options.runnerAlreadyClaimed !== true && !tryMarkRunnerActive(runId)) {
    console.warn(`[Runner] Node execution pipeline already active for run=${runId}`);
    return;
  }
  const stopHeartbeat = startHeartbeat(runId);
  try {
    const repo = getRunRepository();
    let run = await repo.get(runId);
    if (run.status !== "approved") {
      throw new RunLifecycleError(`Cannot execute individual nodes from status ${run.status}`);
    }

    const graph = await resolveExecutionGraph(run);
    const existing = executionResultsFromRun(run);
    const readiness = manualReadinessForTask(graph, taskId, existing);
    console.log(
      `[Runner] Node readiness run=${runId} task=${taskId} ready=${readiness.ready} existingLeaves=${existing.leafResults.length} existingIntegrations=${existing.integrationResults.length}`
    );
    if (!readiness.ready) {
      throw new RunLifecycleError(readiness.reason);
    }

    let provisioned = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined) {
      if (run.repoSpec === undefined) {
        throw new RepoNotConfiguredError(run.runId);
      }
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      console.log(`[Runner] Provisioning repo for node run=${runId} task=${taskId}: kind=${run.repoSpec.kind}`);
      provisioned = await provisioner.provision({ spec: run.repoSpec, runId: run.runId });
      console.log(
        `[Runner] Repo provisioned for node run=${runId} task=${taskId}: repoRoot=${provisioned.repoRoot}, baseBranch=${provisioned.baseBranch}, baseCommit=${provisioned.baseCommit}`
      );
      run = await repo.save({
        ...run,
        provisioned: {
          repoRoot: provisioned.repoRoot,
          baseBranch: provisioned.baseBranch,
          baseCommit: provisioned.baseCommit,
          provisionedAt: new Date().toISOString()
        }
      });
    }

    console.log(`[Runner] Node preflight start run=${runId} task=${taskId}`);
    await runPreflight({ repoRoot: provisioned.repoRoot, baseBranch: provisioned.baseBranch });
    console.log(`[Runner] Node preflight ok run=${runId} task=${taskId}`);

    publishEvent(runId, { kind: "agent.run.started", taskId, at: new Date().toISOString() });

    const traceStore = options.traceStore ?? new InMemoryTraceStore();
    console.log(`[Runner] Node engine start run=${runId} task=${taskId}`);
    const nodeResult = await runNodeWithDefaultEngine({
      graph,
      model: run.model,
      taskId,
      runId: run.runId,
      provisioned,
      ...(run.executionConfig !== undefined ? { executionConfig: run.executionConfig } : {}),
      ...(readiness.childResults !== undefined ? { childResults: readiness.childResults } : {}),
      traceStore
    });
    console.log(
      `[Runner] Node engine complete run=${runId} task=${taskId} kind=${nodeResult.kind} status=${nodeResult.kind === "leaf" ? nodeResult.result.status : nodeResult.result.status}`
    );

    const merged = mergeNodeExecutionResult({
      runId: run.runId,
      graph: {
        ...graph,
        repo: provisioned.repoRoot,
        baseBranch: provisioned.baseBranch,
        baseCommit: provisioned.baseCommit
      },
      existing,
      nodeResult
    });
    const executionTraces = [...(run.executionTraces ?? []), ...traceStore.list()];
    run = await repo.get(runId);
    console.log(
      `[Runner] Persisting node result run=${runId} task=${taskId} mergedStatus=${merged.status} leaves=${merged.leafResults.length} integrations=${merged.integrationResults.length}`
    );
    await repo.save({
      ...run,
      execution: merged,
      executionTraces,
      heartbeatAt: new Date().toISOString()
    });

    const success =
      nodeResult.kind === "leaf"
        ? nodeResult.result.status === "success"
        : INTEGRATION_SUCCESS.has(nodeResult.result.status);
    publishEvent(runId, {
      kind: "agent.run.completed",
      taskId,
      success,
      at: new Date().toISOString()
    });
    publishEvent(runId, {
      kind: "validation.completed",
      taskId,
      passed: success,
      at: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Runner] Node execution failed run="${runId}" task="${taskId}":`, error);
    const run = await getRunRepository().get(runId).catch(() => null);
    if (run !== null) {
      await getRunRepository().save({ ...run, errorMessage: message });
    }
    publishEvent(runId, {
      kind: "agent.run.completed",
      taskId,
      success: false,
      at: new Date().toISOString()
    });
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

export async function assertManualNodeExecutionReady(run: RunRecord, taskId: string): Promise<void> {
  if (run.status !== "approved") {
    throw new RunLifecycleError(`Cannot execute individual nodes from status ${run.status}`);
  }
  const graph = await resolveExecutionGraph(run);
  const readiness = manualReadinessForTask(graph, taskId, executionResultsFromRun(run));
  if (!readiness.ready) {
    throw new RunLifecycleError(readiness.reason);
  }
}

/**
 * Build the predicted-conflict hints that feed the conflict-aware composer (Pieza 2).
 * Reuses the exact computation the UI shows (deriveConflictList) so foresight at
 * planning time and repair at integration time stay consistent. Includes every
 * actionable pair — even acknowledged ones, since acknowledgement is precisely the
 * decision to let the composer reconcile them.
 */
function derivePredictedConflicts(run: RunRecord): PredictedConflictHint[] {
  // Best-effort foresight: a malformed/partial snapshot must never break the run.
  if (!hasProjectableConflictSnapshotInput(run)) {
    return [];
  }
  try {
    const snapshot = projectRunRecordToSnapshot(run);
    if (snapshot === null) {
      return [];
    }
    return deriveConflictList(snapshot, run.patches ?? [])
      .filter((conflict) => conflict.level === "medium" || conflict.level === "high" || conflict.level === "blocking")
      .map((conflict) => ({
        taskAId: conflict.taskAId,
        taskBId: conflict.taskBId,
        level: conflict.level,
        sharedFiles: conflict.sharedFiles,
        sharedSymbols: conflict.sharedSymbols,
        explanation: conflict.reason
      }));
  } catch (error) {
    console.warn(
      `[Runner] Predicted-conflict derivation skipped for run ${run.runId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function hasProjectableConflictSnapshotInput(run: RunRecord): boolean {
  const execution = run.execution;
  if (isPlainRecord(execution) && execution.snapshot !== undefined) return true;
  return hasProjectablePlanningShape(run.planning);
}

function hasProjectablePlanningShape(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const decomposition = asPlainRecord(value.decomposition);
  const feature = asPlainRecord(decomposition?.feature);
  const graph = asPlainRecord(decomposition?.graph);
  const summary = asPlainRecord(value.summary);
  const schedule = asPlainRecord(value.schedule);
  return (
    typeof feature?.id === "string" &&
    typeof graph?.rootId === "string" &&
    isPlainRecord(graph.nodes) &&
    Array.isArray(decomposition?.contracts) &&
    typeof summary?.mode === "string" &&
    Array.isArray(schedule?.batches)
  );
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}


function publishRunModelEventsFromExecutionResult(
  run: RunRecord,
  graph: TaskGraph,
  result: RunExecutionResult,
  finalApplication: Partial<RunRecord> | undefined
): void {
  const now = new Date().toISOString();

  for (const leaf of result.leafResults) {
    if (leaf.status === "success") {
      publishRunModelEvent(run.runId, {
        actor: "agent",
        at: now,
        type: "node.verify.passed",
        payload: {
          nodeId: leaf.taskId,
          commit: leaf.commitSha ?? leaf.currentHead,
          changedFiles: [...leaf.changedFiles],
          builtAgainst: consumedRevisionRefs(graph, leaf.taskId),
          ...(producedRevisionRef(graph, leaf.taskId) !== undefined
            ? { produces: producedRevisionRef(graph, leaf.taskId)! }
            : {})
        }
      });
    } else {
      publishRunModelEvent(run.runId, {
        actor: "agent",
        at: now,
        type: "node.execution.failed",
        payload: { nodeId: leaf.taskId, cause: leafFailureCause(leaf) }
      });
    }
  }

  for (const integration of result.integrationResults) {
    const childNodeIds = integration.childResults.map((child) => child.taskId);
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "integration.started",
      payload: { compositeNodeId: integration.compositeTaskId, childNodeIds }
    });

    if (integration.conflictDetails !== undefined) {
      const conflictId = `integration:${integration.compositeTaskId}:conflict`;
      const resolved = INTEGRATION_SUCCESS.has(integration.status);
      publishRunModelEvent(run.runId, {
        actor: "system",
        at: now,
        type: "conflict.detected",
        payload: {
          conflictId,
          dimension: "textual",
          status: resolved ? "resolved" : "detected",
          nodeIds: childNodeIds,
          files: [...integration.conflictDetails.files],
          autoResolvable: integration.repairAttempted,
          diagnosisRef: `diagnosis://runs/${run.runId}/integration/${integration.compositeTaskId}`
        }
      });
      if (resolved) {
        publishRunModelEvent(run.runId, {
          actor: "system",
          at: now,
          type: "conflict.resolved",
          payload: { conflictId, by: "system", resolutionId: integration.status }
        });
      } else {
        publishRunModelEvent(run.runId, {
          actor: "system",
          at: now,
          type: "decision.raised",
          payload: {
            decisionId: `resolve_conflict:${integration.compositeTaskId}`,
            kind: "resolve_conflict",
            blocking: true,
            context: { nodeIds: childNodeIds, conflictId }
          }
        });
      }
    }

    const validation = integration.parentValidation;
    const integrationPassed = INTEGRATION_SUCCESS.has(integration.status);
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "integration.validated",
      payload: {
        compositeNodeId: integration.compositeTaskId,
        testsPass: validation !== undefined ? (validation.passed ? 1 : 0) : 0,
        testsTotal: validation !== undefined ? 1 : 0,
        passed: validation !== undefined ? validation.passed : integrationPassed,
        builtAgainst: consumedRevisionRefs(graph, integration.compositeTaskId)
      }
    });
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "integration.completed",
      payload: {
        compositeNodeId: integration.compositeTaskId,
        commit: integration.integrationCommitSha ?? graph.baseCommit,
        status: integrationPassed ? "success" : integration.status
      }
    });
  }

  if (result.status === "completed") {
    const integrationCommit =
      finalApplication?.finalCommitSha ??
      finalApplication?.integrationCommitSha ??
      result.integrationResults.at(-1)?.integrationCommitSha ??
      result.leafResults.at(-1)?.commitSha ??
      graph.baseCommit;
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "run.evidence.ready",
      payload: {
        aggregateDiffRef: `diff://runs/${run.runId}/final`,
        tests: testsFor(result),
        narrativeRef: `narrative://runs/${run.runId}/receipt`,
        integrationCommit
      }
    });
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "decision.raised",
      payload: {
        decisionId: "approve_merge",
        kind: "approve_merge",
        blocking: true,
        context: { diffRef: `diff://runs/${run.runId}/final` }
      }
    });
  }

  publishRunModelEvent(run.runId, {
    actor: "system",
    at: now,
    type: "run.metrics.ready",
    payload: { metrics: metricsFromVector(result.granularityVector) }
  });
  publishRunModelEvent(run.runId, {
    actor: "system",
    at: now,
    type: "run.completed",
    payload: { status: result.status === "completed" ? "success" : "failed" }
  });
}

function consumedRevisionRefs(graph: TaskGraph, taskId: string): Array<{ seamId: string; revision: number }> {
  const node = graph.nodes[taskId];
  return (node?.contract?.consumedInterfaces ?? []).map((iface) => ({ seamId: iface.id, revision: 1 }));
}

function producedRevisionRef(graph: TaskGraph, taskId: string): { seamId: string; revision: number } | undefined {
  const iface = graph.nodes[taskId]?.contract?.producedInterfaces?.[0];
  return iface !== undefined ? { seamId: iface.id, revision: 1 } : undefined;
}

function leafFailureCause(leaf: AgentExecutionResult): string {
  if (leaf.executorTimedOut) return `${leaf.status}: timed out`;
  const stderr = leaf.stderrTail?.trim();
  if (stderr !== undefined && stderr.length > 0) return `${leaf.status}: ${stderr}`;
  return `${leaf.status}: executor exit ${leaf.executorExitCode}`;
}

function testsFor(result: RunExecutionResult): { pass: number; total: number } {
  if (result.validationResult !== undefined) {
    return { pass: result.validationResult.passed ? 1 : 0, total: 1 };
  }
  const checks = result.leafResults
    .map((leaf) => leaf.validationResult)
    .filter((validation): validation is NonNullable<AgentExecutionResult["validationResult"]> => validation !== undefined);
  return { pass: checks.filter((validation) => validation.passed).length, total: checks.length };
}

function metricsFromVector(vector: RunExecutionResult["granularityVector"]) {
  return {
    depth: vector.depth,
    leafCount: vector.leafCount,
    compositeCount: vector.compositeCount,
    avgLeafDepth: vector.avgLeafDepth,
    maxLeafDepth: vector.maxLeafDepth,
    dependencyCount: vector.dependencyCount,
    avgAcceptanceCriteriaPerLeaf: vector.avgAcceptanceCriteriaPerLeaf,
    ...(vector.estimatedTokensPerLeaf !== undefined ? { estimatedTokensPerLeaf: vector.estimatedTokensPerLeaf } : {}),
    integrationSuccessRate: vector.integrationSuccessRate,
    leafSuccessRate: vector.leafSuccessRate,
    conflictRate: vector.conflictRate,
    totalDurationMs: vector.totalDurationMs,
    linesChanged: vector.linesChanged,
    unexpectedCommitCount: vector.unexpectedCommitCount,
    scopeViolationCount: vector.scopeViolationCount,
    ...(vector.totalCostUsd !== undefined ? { totalCostUsd: vector.totalCostUsd } : {}),
    ...(vector.testsPassedRate !== undefined ? { testsPassedRate: vector.testsPassedRate } : {})
  };
}

export type NodeReviewAction = "approve" | "request_changes" | "rerun";

/**
 * Applies a per-node review action during the manual execution workflow.
 * - `approve`: marks the node's output reviewed (non-blocking annotation).
 * - `request_changes`: stores human feedback and resets the node + downstream
 *   results so the next run picks up the change.
 * - `rerun`: resets the node + downstream results and re-executes the node.
 *
 * `request_changes`/`rerun` reset execution state, so they only apply while the
 * run awaits manual execution (`approved`); `approve` is allowed in any state.
 */
export async function reviewNode(
  runId: string,
  taskId: string,
  action: NodeReviewAction,
  feedback?: string
): Promise<RunRecord> {
  const repo = getRunRepository();
  let run = await repo.get(runId);
  const graph = resolveExecutionGraph(run);
  if (graph.nodes[taskId] === undefined) {
    throw new RunValidationError(`Task "${taskId}" is not in the graph.`);
  }
  const now = new Date().toISOString();

  if (action === "approve") {
    const reviews: Record<string, NodeReview> = { ...(run.nodeReviews ?? {}) };
    reviews[taskId] = { status: "approved", at: now };
    return repo.save({ ...run, nodeReviews: reviews, updatedAt: now });
  }

  // Re-open a finished run so Rerun / Request changes work in the autonomous
  // flow too (not only during the manual `approved` workflow).
  if (run.status === "completed" || run.status === "completed_with_accepted" || run.status === "failed") {
    assertTransition(run.status, "approved");
    run = await repo.save({ ...run, status: "approved", updatedAt: now });
    await appendRunStatusChanged(run, { at: now, actor: "human" });
  }

  if (run.status !== "approved") {
    throw new RunLifecycleError(
      `"${action}" is only available once the plan is approved or the run has finished, not "${run.status}".`
    );
  }

  // request_changes + rerun both invalidate the node and its downstream closure.
  const invalid = computeInvalidatedTasks(graph, taskId);
  const existing = executionResultsFromRun(run);
  const leafResults = existing.leafResults.filter((result) => !invalid.has(result.taskId));
  const integrationResults = existing.integrationResults.filter(
    (result) => !invalid.has(result.compositeTaskId)
  );
  const execution = buildExecutionArtifact(run.runId, graph, leafResults, integrationResults);

  const reviews: Record<string, NodeReview> = { ...(run.nodeReviews ?? {}) };
  for (const id of invalid) {
    delete reviews[id];
  }
  if (action === "request_changes") {
    reviews[taskId] = {
      status: "changes_requested",
      ...(feedback !== undefined && feedback.trim().length > 0 ? { feedback: feedback.trim() } : {}),
      at: now
    };
  }

  run = await repo.save({
    ...run,
    execution,
    nodeReviews: reviews,
    updatedAt: now,
    heartbeatAt: now
  });

  if (action === "rerun") {
    await assertManualNodeExecutionReady(run, taskId);
    startRunBackgroundTask(run.runId, "review-node:rerun", () => runNodeExecutionPipeline(run.runId, taskId));
    run = await repo.get(runId);
  }

  return run;
}

function describeExecutionFailure(result: RunExecutionResult): string {
  const failedLeaves = result.leafResults.filter((leaf) => leaf.status !== "success");
  if (failedLeaves.length > 0) {
    const detail = failedLeaves.map((leaf) => `${leaf.taskId} (${leaf.status})`).join(", ");
    return `Execution failed: ${failedLeaves.length} leaf task(s) did not succeed: ${detail}.`;
  }
  return "Execution failed during integration or run-level validation.";
}

function publishEvent(runId: string, event: StreamEvent): void {
  publishRunEvent(runId, event);
}
