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
import {
    RepoNotConfiguredError,
    RunLifecycleError,
    RunMutationConflictError,
    RunValidationError
} from "./errors";
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
    assertExecutableRunGraph,
    manualReadinessForTask,
    mergeNodeExecutionResult,
    provisionedFromRecord,
    resolveExecutionGraph,
    resolveRepoProvisionAction
} from "./execution-state";
import { applyFinalPatch } from "./final-apply";
import { applyValidationToManifest, terminalDispositionForArtifact } from "./final-artifact";
import { executionSelection, groundingSelection, repairSelection } from "./executor-selection";
import { persistEffectiveExecutionConfig } from "./effective-execution-config";
import { assertRunActionAllowed, assertTransition } from "./lifecycle";
import { LiveExecutionTraceStore } from "./live-trace-store";
import { waitWhilePlainPaused } from "./pause-control";
import { PreflightError, runPreflight } from "./preflight";
import { runWithProcessSupervision } from "./process-supervision";
import {
    acquireRepoLock,
    assertRepoLeaseCurrent,
    releaseRepoLease,
    startRepoLeaseHeartbeat,
    type RepoLease
} from "./repo-lock";
import {
    createDefaultRepoProvisioner,
    recreateProvisionedRepo,
    type ProvisionedRepo,
    type RepoProvisioner
} from "./repo-provisioner";
import { createRunAbort, disposeRunAbort } from "./run-abort-registry";
import { verifyProvisionedAgainstTarget } from "./target-context";
import { createHash } from "node:crypto";
import path from "node:path";
import {
    appendRunEventRequired,
    appendRunEventsRequired,
    ensureRunModelEventLogForRun,
    publishRunModelEvent
} from "./run-model-event-log";
import { transitionTo } from "./planning-pipeline";
import { reconcileExecutionWorld } from "./world-reconcile";
import { type RunTitle } from "./run-titler";
import { startHeartbeat } from "./runner-heartbeat";
import { isRunnerActive, markRunnerInactive, startRunBackgroundTask, tryMarkRunnerActive } from "./runner-state";
import { startBudgetWatchdog } from "./runner-watchdog";
import { saveRunWithRequiredStatusEvent } from "./audited-mutation";
import {
    claimRunOperation,
    releaseRunOperation,
    updateRunForOperation
} from "./run-operation-lease";
import type {
    ExecutionConfigInput,
    FinalArtifactManifest,
    NodeReview,
    RunOperationLease,
    RunRecord
} from "./schema";
import { getRunRepository } from "./store";
import { resolveRunsDirectory } from "./repository";
import {
    JsonTaskAttemptJournal,
    TASK_ATTEMPT_EVENT_TYPES,
    type TaskAttempt,
    type TaskAttemptState
} from "./task-attempt-journal";
import type { RunEventType } from "@/lib/run-model/types";

export { computeInvalidatedTasks } from "./execution-state";
export type { ExecutionResults } from "./execution-state";


// Re-export for the SSE endpoint to detect orphaned runs.
export { isRunnerActive } from "./runner-state";

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface PlanningRunnerOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the selected executor-backed titler. */
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
  defaultExecutionSelection?: RunRecord["defaultExecutionSelection"];
  defaultRepairSelection?: RunRecord["defaultRepairSelection"];
  taskId: string;
  runId: string;
  attemptId?: string;
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
    ...(input.defaultExecutionSelection !== undefined ? { defaultExecutionSelection: input.defaultExecutionSelection } : {}),
    ...(input.defaultRepairSelection !== undefined ? { defaultRepairSelection: input.defaultRepairSelection } : {}),
    runId: input.runId,
    taskId: input.taskId,
    ...(input.attemptId !== undefined ? { attemptId: input.attemptId } : {}),
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
  let lease: RunOperationLease | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let stopBudgetWatchdog: () => void = () => undefined;
  let repoLease: RepoLease | undefined;
  let stopRepoHeartbeat: (() => void) | undefined;
  try {
    const claimed = await claimRunOperation(runId, "execution", {
      expectedStatuses: ["approved", "running", "interrupted"],
      allowTakeover: true
    });
    lease = claimed.lease;
    let run = claimed.run;
    assertApprovedPlanRevision(run);
    if (run.status === "approved") {
      run = await transitionTo(
        run,
        "running",
        { startedAt: run.startedAt ?? new Date().toISOString() },
        { lease }
      );
    }
    run = await persistEffectiveExecutionConfig(runId, lease);
    stopHeartbeat = startHeartbeat(runId, lease);

    const graph = await resolveExecutionGraph(run);
    assertExecutableRunGraph(graph);
    console.log(
      `[Runner] Execution graph resolved for run ${runId}: root=${graph.rootId}, nodes=${Object.keys(graph.nodes).length}, dependencies=${graph.dependencies.length}`
    );
    const usingDefaultEngine = options.engine === undefined;

    await ensureRunModelEventLogForRun(run);

    const abortController = createRunAbort(runId);
    stopBudgetWatchdog = startBudgetWatchdog(runId, run.executionConfig?.maxWallClockMs, lease);
    if (await executionWasInterrupted(runId, abortController.signal)) {
      console.log(`[Runner] Execution pipeline stopped before provisioning; run ${runId} is interrupted.`);
      return;
    }

    let provisioned: ProvisionedRepo | undefined = provisionedFromRecord(run.provisioned);
    // Cold resume (restart of an execution-interrupted run) already carries a
    // `provisioned` record: reuse it. Only a genuinely repo-less run under the
    // default engine is an error — deciding "reuse" as "missing" wedged every
    // cold resume with RepoNotConfiguredError (E2E 2026-07-06).
    const repoAction = resolveRepoProvisionAction({
      provisioned,
      hasRepoSpec: run.repoSpec !== undefined
    });

    // One active pipeline per target repo (U7/B-004). The lease must exist
    // BEFORE any git side effect against the source — the provisioning clone
    // reads it — so claim as soon as the source path is known. B-008: the
    // frozen target context is the authoritative source path.
    const preLockTarget =
      provisioned?.sourceRepoRoot ??
      run.targetContext?.sourceRealPath ??
      (repoAction === "provision" && run.repoSpec?.kind === "localPath" ? run.repoSpec.path : undefined);
    if (preLockTarget !== undefined) {
      repoLease = await claimRepoOrThrow(preLockTarget, runId);
      stopRepoHeartbeat = startRepoLeaseHeartbeat(repoLease);
    }

    if (repoAction === "provision") {
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      console.log(`[Runner] Provisioning repo for run ${runId}: kind=${run.repoSpec!.kind}`);
      // B-008: provision exactly the captured target, never a re-resolved path.
      const provisionSpec =
        run.repoSpec!.kind === "localPath" && run.targetContext !== undefined
          ? { kind: "localPath" as const, path: run.targetContext.sourceRealPath }
          : run.repoSpec!;
      provisioned = await runWithProcessSupervision(
        {
          runId: run.runId,
          label: "git-provision",
          ...(lease !== undefined ? { operationId: lease.operationId } : {}),
          signal: abortController.signal
        },
        () => provisioner.provision({ spec: provisionSpec, runId: run.runId })
      );
      if (run.targetContext !== undefined) {
        await verifyProvisionedAgainstTarget(provisioned, run.targetContext);
        if (provisioned.sourceBaseCommit !== run.targetContext.sourceBaseCommit) {
          console.warn(
            `[Runner] Target ${run.targetContext.sourceRealPath} advanced since capture ` +
              `(${run.targetContext.sourceBaseCommit.slice(0, 8)} → ${provisioned.sourceBaseCommit?.slice(0, 8)}); ` +
              "executing against the current HEAD of the same repository."
          );
        }
      }
      console.log(
        `[Runner] Repo provisioned for run ${runId}: repoRoot=${provisioned.repoRoot}, baseBranch=${provisioned.baseBranch}, baseCommit=${provisioned.baseCommit}`
      );
      const provisionedRepo = provisioned;
      run = await updateRunForOperation(run.runId, lease, (current) => ({
        ...current,
        provisioned: {
          repoRoot: provisionedRepo.repoRoot,
          sourceRepoRoot: provisionedRepo.sourceRepoRoot,
          sourceBranch: provisionedRepo.sourceBranch,
          sourceBaseCommit: provisionedRepo.sourceBaseCommit,
          baseBranch: provisionedRepo.baseBranch,
          baseCommit: provisionedRepo.baseCommit,
          executionBaseCommit: provisionedRepo.executionBaseCommit,
          provisionedAt: new Date().toISOString()
        },
        // B-008: fill the execution side of the frozen context exactly once.
        ...(current.targetContext !== undefined
          ? {
              targetContext: {
                ...current.targetContext,
                executionRepoPath: current.targetContext.executionRepoPath ?? provisionedRepo.repoRoot,
                executionBaseCommit:
                  current.targetContext.executionBaseCommit ??
                  provisionedRepo.executionBaseCommit ??
                  provisionedRepo.baseCommit
              }
            }
          : {})
      }));
      if (isInterrupted(run, abortController.signal)) {
        console.log(`[Runner] Execution pipeline stopped after provisioning; run ${runId} is interrupted.`);
        return;
      }
    } else if (repoAction === "reuse" && run.provisioned !== undefined) {
      // B-016: a GC/manual deletion can remove only the run-owned root while
      // its durable source/base descriptor remains. Recreate that exact root
      // before any graph resume; this path never invokes grounding/executors.
      const restored = await recreateProvisionedRepo({ runId, record: run.provisioned });
      provisioned = restored.provisioned;
      if (restored.recreated) {
        await appendRunEventRequired(runId, {
          actor: "system",
          type: "world.reconciled",
          payload: {
            baseCommitReachable: true,
            keptTaskIds: [],
            invalidatedTaskIds: [],
            cleanedWorktrees: [],
            gcFailures: [],
            removedLocks: [],
            warnings: [],
            rootWorktreeRecreated: true,
            executionBaseCommit: provisioned.executionBaseCommit
          }
        });
      }
    } else if (repoAction === "missing" && usingDefaultEngine) {
      console.error(
        `[Runner] El run ${runId} no tiene repoSpec configurado y el engine real requiere un repo. ` +
          "Configurá un workspace con un repo git local."
      );
      throw new RepoNotConfiguredError(run.runId);
    }

    // Fixture provisioning (no stable source path upfront): claim on the
    // provisioned source once it exists. Released in the finally below.
    if (repoLease === undefined && provisioned !== undefined) {
      repoLease = await claimRepoOrThrow(provisioned.sourceRepoRoot, runId);
      stopRepoHeartbeat = startRepoLeaseHeartbeat(repoLease);
    }

    // Provisioning only reads the captured source. All subsequent worktree,
    // commit, integration and final-apply mutations target the isolated run
    // repository, therefore must be fenced by that repository's common-dir
    // lease rather than the source checkout's lease.
    if (provisioned !== undefined && repoLease?.repoRoot !== provisioned.repoRoot) {
      stopRepoHeartbeat?.();
      if (repoLease !== undefined) await releaseRepoLease(repoLease);
      repoLease = await claimRepoOrThrow(provisioned.repoRoot, runId);
      stopRepoHeartbeat = startRepoLeaseHeartbeat(repoLease);
    }

    if (await executionWasInterrupted(runId, abortController.signal)) {
      console.log(`[Runner] Execution pipeline stopped before preflight; run ${runId} is interrupted.`);
      return;
    }

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
        model: run.model,
        defaultExecutionSelection: executionSelection(run),
        defaultRepairSelection: repairSelection(run)
      });

      // Cooperative cancellation check
      const afterEngine = await getRunRepository().get(runId);
      if (isInterrupted(afterEngine, abortController.signal) || afterEngine.status === "cancelling") {
        if (afterEngine.status === "cancelling") await waitForCancellationSettlement(runId);
        console.log(`[Runner] Run ${runId} cancelled after engine returned; discarding stale engine result.`);
        return;
      }
      await waitWhilePlainPaused(runId, "running", abortController.signal);
      const afterPause = await getRunRepository().get(runId);
      if (isInterrupted(afterPause, abortController.signal) || afterPause.status === "cancelling") {
        if (afterPause.status === "cancelling") await waitForCancellationSettlement(runId);
        console.log(`[Runner] Run ${runId} cancelled after pause hold; keeping partial execution.`);
        return;
      }

      const finalApplication =
        result.status === "completed" && provisioned !== undefined
          ? await (async () => {
              // Fencing (B-004): verify the repo lease immediately before the
              // final git side effect covered by it.
              if (repoLease !== undefined) await assertRepoLeaseCurrent(repoLease);
              await appendRunEventRequired(runId, {
                actor: "system",
                type: "run.artifact.creation.started",
                payload: { ...(lease !== undefined ? { operationId: lease.operationId } : {}) }
              });
              console.log(`[Runner] Final apply start for run ${runId}`);
              const applied = await runWithProcessSupervision(
                {
                  runId,
                  label: "git-final-apply",
                  ...(lease !== undefined ? { operationId: lease.operationId } : {})
                },
                () => applyFinalPatch({
                  graph, result, provisioned: provisioned!, runId, slug: run.title,
                  repositoryLeaseHeld: repoLease !== undefined,
                  ...(run.targetContext?.fingerprint !== undefined
                    ? { sourceTargetFingerprint: run.targetContext.fingerprint }
                    : {})
                })
              );
              console.log(
                `[Runner] Final apply complete for run ${runId}: status=${applied?.finalApplicationStatus ?? "(none)"} branch=${applied?.finalBranchName ?? "(none)"} commit=${applied?.finalCommitSha ?? "(none)"}`
              );
              if (applied?.finalArtifactManifest !== undefined) {
                applied.finalArtifactManifest = {
                  ...applied.finalArtifactManifest,
                  validationCommands: runValidationCommandsForManifest(graph),
                  validationResults: result.validationResult !== undefined ? [result.validationResult] : [],
                  verificationDisposition:
                    result.validationResult?.passed === true
                      ? "verified"
                      : result.validationResult === undefined
                        ? "unverified"
                        : "failed"
                };
              }
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
      const currentRun = await getRunRepository().get(runId);
      if (result.status === "completed") {
        const terminalStatus = terminalDispositionForArtifact({
          manifest: finalApplication?.finalArtifactManifest,
          acceptedRisk: false
        });
        console.log(`[Runner] Persisting ${terminalStatus} run ${runId}`);
        await transitionTo(currentRun, terminalStatus, {
          execution: result,
          executionOutcome: "succeeded",
          artifactOutcome:
            finalApplication?.finalArtifactManifest?.verificationDisposition === "unverified"
              ? "unverified"
              : finalApplication?.finalArtifactManifest?.artifactDisposition ?? "failed",
          deliveryOutcome: finalApplication?.finalArtifactManifest?.deliveryDisposition ?? "failed",
          ...(executionTraces.length > 0 ? { executionTraces: [...(currentRun.executionTraces ?? []), ...executionTraces] } : {}),
          ...(finalApplication !== undefined ? finalApplication : {}),
          completedAt: new Date().toISOString()
        }, { lease });
        await appendArtifactFinishedEvent(runId, lease?.operationId, finalApplication?.finalArtifactManifest);
        publishRunModelEventsFromExecutionResult(run, graph, result, finalApplication);
      } else {
        console.warn(`[Runner] Persisting failed run ${runId}`);
        await saveRunWithRequiredStatusEvent(currentRun, {
          ...currentRun,
          status: result.status === "failed" ? "failed" : "interrupted",
          failedDuring: "running",
          execution: result,
          ...(executionTraces.length > 0 ? { executionTraces: [...(currentRun.executionTraces ?? []), ...executionTraces] } : {}),
          errorMessage: result.status === "failed" ? "Execution failed" : "Budget exceeded"
        }, { lease });
        publishRunModelEventsFromExecutionResult(run, graph, result, finalApplication);
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
        selectionLocked: run.executionConfig?.routing === "fixed",
        groundingSelection: groundingSelection(run),
        defaultExecutionSelection: executionSelection(run),
        defaultRepairSelection: repairSelection(run)
      });
      for (const warning of preflight.warnings) {
        console.warn(`[Runner] Preflight warning (${warning.check}) for run ${runId}: ${warning.message}`);
      }
      console.log(`[Runner] Preflight ok for run ${runId}`);
      if (await executionWasInterrupted(runId, abortController.signal)) {
        console.log(`[Runner] Execution pipeline stopped after preflight; run ${runId} is interrupted.`);
        return;
      }
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
      provisioned!.executionBaseCommit = skeletonCommit;
      run = await updateRunForOperation(run.runId, lease, (current) => ({
        ...current,
        provisioned: {
          repoRoot: provisioned!.repoRoot,
          sourceRepoRoot: provisioned!.sourceRepoRoot,
          sourceBranch: provisioned!.sourceBranch,
          sourceBaseCommit: provisioned!.sourceBaseCommit,
          baseBranch: provisioned!.baseBranch,
          baseCommit: skeletonCommit,
          executionBaseCommit: skeletonCommit,
          provisionedAt: current.provisioned?.provisionedAt ?? new Date().toISOString()
        }
      }));
      if (isInterrupted(run, abortController.signal)) {
        console.log(`[Runner] Execution pipeline stopped after grounding; run ${runId} is interrupted.`);
        return;
      }

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
      predictedConflicts: derivePredictedConflicts(run),
      operationLease: lease
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
    await settleExecutionOutcome(runId, host, outcome, provisioned!, options, lease, repoLease);
  } catch (error) {
    console.error(`[Runner] FALLO la ejecucion del run "${runId}":`, error);
    if (!(error instanceof RunMutationConflictError)) {
      await settleExecutionException(runId, error, lease);
    }
  } finally {
    stopRepoHeartbeat?.();
    if (repoLease !== undefined) {
      await releaseRepoLease(repoLease).catch(() => undefined);
    }
    stopBudgetWatchdog();
    disposeRunAbort(runId);
    stopHeartbeat?.();
    if (lease !== undefined) await releaseRunOperation(runId, lease);
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
async function settleExecutionException(
  runId: string,
  error: unknown,
  lease: RunOperationLease | undefined
): Promise<void> {
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
    await saveRunWithRequiredStatusEvent(run, {
      ...run,
      status: "interrupted",
      interruptedDuring: "running",
      errorMessage: `interrupted: ${message} (reanudable con restart — el checkpoint del último paso completo sobrevive)`
    }, { ...(lease !== undefined ? { lease } : {}) });
    return;
  }

  await saveRunWithRequiredStatusEvent(
    run,
    { ...run, status: "failed", failedDuring: "running", errorMessage: message },
    { ...(lease !== undefined ? { lease } : {}) }
  );
}

/**
 * Acquire the per-repo run lease or fail preflight-style with an actionable
 * message naming the owner (U7/B-004). The returned lease carries the
 * fencing token; release it with `releaseRepoLease`.
 */
async function claimRepoOrThrow(repoRoot: string, runId: string): Promise<RepoLease> {
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
  return lock.lease;
}

async function executionWasInterrupted(runId: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return true;
  }
  const run = await getRunRepository()
    .get(runId)
    .catch(() => null);
  return run !== null && isInterrupted(run, signal);
}

function isInterrupted(run: RunRecord, signal: AbortSignal): boolean {
  return signal.aborted || run.status === "interrupted";
}

/** The watchdog owns terminal cancellation; do not release pipeline leases while it is still persisting allDead/audit. */
async function waitForCancellationSettlement(runId: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await getRunRepository().get(runId);
    if (current.status !== "cancelling") return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new RunLifecycleError(`Cancellation for run ${runId} did not settle within 30 seconds.`);
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
  let lease: RunOperationLease | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let stopBudgetWatchdog: () => void = () => undefined;
  let repoLease: RepoLease | undefined;
  let stopRepoHeartbeat: (() => void) | undefined;
  try {
    const claimed = await claimRunOperation(runId, "execution", {
      expectedStatuses: ["running", "paused", "interrupted"],
      allowTakeover: true
    });
    lease = claimed.lease;
    const operationLease = lease;
    stopHeartbeat = startHeartbeat(runId, lease);
    const run = claimed.run;
    assertExecutableRunGraph(resolveExecutionGraph(run));
    const provisioned = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined) {
      throw new RepoNotConfiguredError(runId);
    }

    repoLease = await claimRepoOrThrow(provisioned.sourceRepoRoot, runId);
    stopRepoHeartbeat = startRepoLeaseHeartbeat(repoLease);

    const abortController = createRunAbort(runId);
    stopBudgetWatchdog = startBudgetWatchdog(runId, run.executionConfig?.maxWallClockMs, lease);

    const host = buildExecutionHost(run, provisioned, {
      traceStoreFactory: () =>
        new LiveExecutionTraceStore(options.traceStore ?? new InMemoryTraceStore(), runId, run.model),
      predictedConflicts: derivePredictedConflicts(run),
      operationLease: lease
    });

    const outcome = await driveExecution(host, resumeCommand(decision), abortController.signal);
    await waitWhilePlainPaused(runId, "running", abortController.signal);
    await settleExecutionOutcome(runId, host, outcome, provisioned, options, lease, repoLease);
  } catch (error) {
    console.error(`[Runner] FALLO el resume de ejecucion del run "${runId}":`, error);
    if (!(error instanceof RunMutationConflictError)) {
      await settleExecutionException(runId, error, lease);
    }
  } finally {
    stopRepoHeartbeat?.();
    if (repoLease !== undefined) {
      await releaseRepoLease(repoLease).catch(() => undefined);
    }
    stopBudgetWatchdog();
    disposeRunAbort(runId);
    stopHeartbeat?.();
    if (lease !== undefined) await releaseRunOperation(runId, lease);
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
  _options: ExecutionRunnerOptions,
  lease: RunOperationLease,
  repoLease?: RepoLease
): Promise<void> {
  if (outcome.kind === "finished") {
    await waitWhilePlainPaused(runId, "running");
  }

  if (outcome.kind === "paused") {
    console.log(`[Runner] Execution paused at ${outcome.gate.gate} gate (task ${outcome.gate.taskId}).`);
    await persistExecutionPause(runId, outcome.gate, lease);
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
    await saveRunWithRequiredStatusEvent(currentRun, {
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      errorMessage: outcome.errorMessage ?? "Execution produced no results."
    }, { lease });
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
          // Fencing (B-004): verify the repo lease immediately before the
          // final git side effect covered by it.
          if (repoLease !== undefined) await assertRepoLeaseCurrent(repoLease);
          await appendRunEventRequired(runId, {
            actor: "system",
            type: "run.artifact.creation.started",
            payload: { operationId: lease.operationId }
          });
          console.log(`[Runner] Final apply start for run ${runId}`);
          const applied = await runWithProcessSupervision(
            { runId, label: "git-final-apply", operationId: lease.operationId },
            () =>
              applyFinalPatch({
                graph: host.taskGraph,
                result,
                provisioned,
                runId,
                slug: currentRun.title,
                repositoryLeaseHeld: repoLease !== undefined,
                ...(currentRun.targetContext?.fingerprint !== undefined
                  ? { sourceTargetFingerprint: currentRun.targetContext.fingerprint }
                  : {})
              })
          );
          console.log(
            `[Runner] Final apply complete for run ${runId}: status=${applied?.finalApplicationStatus ?? "(none)"} branch=${applied?.finalBranchName ?? "(none)"} commit=${applied?.finalCommitSha ?? "(none)"}`
          );
          if (applied?.finalArtifactManifest !== undefined) {
            applied.finalArtifactManifest = applyValidationToManifest({
              ...applied.finalArtifactManifest,
              validationCommands: runValidationCommandsForManifest(host.taskGraph),
              validationResults: persistedValidation !== undefined ? [persistedValidation] : [],
              omittedTasks: result.integrationResults.flatMap((entry) => entry.omittedChildCommits?.map((item) => item.childTaskId) ?? []),
              repairEvidence: result.integrationResults.flatMap((entry) => entry.repairAttempts ?? []) as Array<Record<string, unknown>>
            }, validationSummary);
            if (outcome.acceptedResolutions) {
              applied.finalArtifactManifest = {
                ...applied.finalArtifactManifest,
                artifactDisposition: "partial",
                acceptedFailures: ["human-accepted execution failure"]
              };
            }
          }
          return applied;
        })()
      : undefined;

  if (outcome.status === "completed") {
    // A run the human steered past accepted failures still delivers its result
    // (final-apply ran above), but we record it as a distinct terminal state so
    // the UI never claims a fully-clean run (P2b).
    const terminalStatus = terminalDispositionForArtifact({
      manifest: finalApplication?.finalArtifactManifest,
      acceptedRisk: outcome.acceptedResolutions === true
    });
    console.log(`[Runner] Persisting ${terminalStatus} run ${runId}`);
    await transitionTo(currentRun, terminalStatus, {
      execution: result,
      executionOutcome: outcome.acceptedResolutions ? "partial" : "succeeded",
      artifactOutcome:
        finalApplication?.finalArtifactManifest?.verificationDisposition === "unverified"
          ? "unverified"
          : finalApplication?.finalArtifactManifest?.artifactDisposition ?? "failed",
      deliveryOutcome: finalApplication?.finalArtifactManifest?.deliveryDisposition ?? "failed",
      ...(finalApplication !== undefined ? finalApplication : {}),
      ...(validationSummary !== undefined ? { validation: validationSummary } : {}),
      completedAt: settledAt
    }, { lease });
    await appendArtifactFinishedEvent(runId, lease.operationId, finalApplication?.finalArtifactManifest);
    publishRunModelEventsFromExecutionResult(currentRun, host.taskGraph, result, finalApplication);
  } else {
    console.warn(`[Runner] Persisting failed run ${runId}`);
    await saveRunWithRequiredStatusEvent(currentRun, {
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      execution: result,
      ...(validationSummary !== undefined ? { validation: validationSummary } : {}),
      errorMessage: outcome.errorMessage ?? describeExecutionFailure(result)
    }, { lease });
    publishRunModelEventsFromExecutionResult(currentRun, host.taskGraph, result, finalApplication);
  }
}

async function appendArtifactFinishedEvent(
  runId: string,
  operationId: string | undefined,
  manifest: FinalArtifactManifest | undefined
): Promise<void> {
  await appendRunEventRequired(runId, {
    actor: "system",
    type: "run.artifact.creation.finished",
    payload: {
      ...(operationId !== undefined ? { operationId } : {}),
      ...(manifest?.manifestId !== undefined ? { manifestId: manifest.manifestId } : {}),
      ...(manifest?.finalSha !== undefined ? { finalSha: manifest.finalSha } : {}),
      artifactDisposition: manifest?.artifactDisposition ?? "failed"
    }
  });
}

function runValidationCommandsForManifest(graph: TaskGraph): Array<{ command: string; args: string[] }> {
  return Object.values(graph.nodes).flatMap((node) =>
    (node.contract?.runValidationCommands ?? []).map((item) => ({ command: item.command, args: [...item.args] }))
  );
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
  let lease: RunOperationLease | undefined;
  let stopHeartbeat: (() => void) | undefined;
  let repoLease: RepoLease | undefined;
  let stopRepoHeartbeat: (() => void) | undefined;
  try {
    const repo = getRunRepository();
    const claimed = await claimRunOperation(runId, "execution", {
      expectedStatuses: ["approved"]
    });
    lease = claimed.lease;
    const operationLease = lease;
    stopHeartbeat = startHeartbeat(runId, lease);
    let run = claimed.run;
    if (run.status !== "approved") {
      throw new RunLifecycleError(`Cannot execute individual nodes from status ${run.status}`);
    }

    const graph = await resolveExecutionGraph(run);
    assertExecutableRunGraph(graph);
    const existing = executionResultsFromRun(run);
    const readiness = manualReadinessForTask(graph, taskId, existing);
    console.log(
      `[Runner] Node readiness run=${runId} task=${taskId} ready=${readiness.ready} existingLeaves=${existing.leafResults.length} existingIntegrations=${existing.integrationResults.length}`
    );
    if (!readiness.ready) {
      throw new RunLifecycleError(readiness.reason);
    }

    const attemptJournal = new JsonTaskAttemptJournal({ directory: path.join(resolveRunsDirectory(), "attempts") });
    const node = graph.nodes[taskId];
    if (node === undefined) throw new RunLifecycleError(`Unknown task ${taskId}.`);
    const attemptKind = node.kind === "integrator" ? "integrator" as const : "manual" as const;
    const priorAttempts = await attemptJournal.list(runId);
    const prior = priorAttempts
      .filter((entry) => entry.nodeId === taskId && entry.kind === attemptKind)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    if (prior !== undefined && !["failed", "cancelled", "discarded"].includes(prior.state)) {
      throw new RunLifecycleError(`Manual node ${taskId} has a prior ${prior.state} attempt; recovery is required.`);
    }
    let attempt = await attemptJournal.reserve({
      runId,
      nodeId: taskId,
      operationId: lease.operationId,
      fencingToken: lease.fencingToken,
      kind: attemptKind,
      baseCommit: graph.baseCommit,
      ...(run.targetContext?.fingerprint !== undefined ? { targetFingerprint: run.targetContext.fingerprint } : {}),
      contractHash: digest(node.contract ?? node.goal),
      promptHash: digest(node.goal),
      executorConfigHash: digest(run.executionConfig ?? {}),
      executor: executionSelection(run),
      idempotencyKey: `${runId}:${taskId}:${attemptKind}:${graph.baseCommit}:${priorAttempts.length}`
    });
    const journalEvent = async (state: TaskAttemptState): Promise<void> => {
      const type = TASK_ATTEMPT_EVENT_TYPES[state];
      if (type === undefined) return;
      await appendRunEventRequired(runId, {
        actor: "system",
        type: type as RunEventType,
        payload: {
          attemptId: attempt.attemptId,
          nodeId: taskId,
          operationId: attempt.operationId,
          fencingToken: attempt.fencingToken,
          state,
          kind: attempt.kind,
          ...(attempt.commitSha !== undefined ? { commitSha: attempt.commitSha } : {})
        } as never
      });
    };
    const moveAttempt = async (state: TaskAttemptState, patch: Record<string, unknown> = {}): Promise<void> => {
      attempt = await attemptJournal.transition(attempt.attemptId, {
        ...patch,
        expectedVersion: attempt.version,
        lease: operationLease,
        state
      });
      await journalEvent(state);
    };
    await journalEvent("prepared");
    await moveAttempt("invocation_reserved");

    let provisioned = provisionedFromRecord(run.provisioned);

    // Same exclusion as the full pipeline (U7/B-004): manual node execution
    // provisions from and executes against the same target repo. B-008: the
    // frozen target context is the authoritative source path.
    const preLockTarget =
      provisioned?.sourceRepoRoot ??
      run.targetContext?.sourceRealPath ??
      (run.repoSpec?.kind === "localPath" ? run.repoSpec.path : undefined);
    if (preLockTarget !== undefined) {
      repoLease = await claimRepoOrThrow(preLockTarget, runId);
      stopRepoHeartbeat = startRepoLeaseHeartbeat(repoLease);
    }

    if (provisioned === undefined) {
      if (run.repoSpec === undefined) {
        throw new RepoNotConfiguredError(run.runId);
      }
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      console.log(`[Runner] Provisioning repo for node run=${runId} task=${taskId}: kind=${run.repoSpec.kind}`);
      // B-008: provision exactly the captured target, never a re-resolved path.
      const provisionSpec =
        run.repoSpec.kind === "localPath" && run.targetContext !== undefined
          ? { kind: "localPath" as const, path: run.targetContext.sourceRealPath }
          : run.repoSpec;
      provisioned = await runWithProcessSupervision(
        {
          runId: run.runId,
          label: "git-provision",
          ...(lease !== undefined ? { operationId: lease.operationId } : {})
        },
        () => provisioner.provision({ spec: provisionSpec, runId: run.runId })
      );
      if (run.targetContext !== undefined) {
        await verifyProvisionedAgainstTarget(provisioned, run.targetContext);
      }
      const provisionedRepo = provisioned;
      console.log(
        `[Runner] Repo provisioned for node run=${runId} task=${taskId}: repoRoot=${provisioned.repoRoot}, baseBranch=${provisioned.baseBranch}, baseCommit=${provisioned.baseCommit}`
      );
      run = await updateRunForOperation(runId, lease, (current) => ({
        ...current,
        provisioned: {
          repoRoot: provisionedRepo.repoRoot,
          sourceRepoRoot: provisionedRepo.sourceRepoRoot,
          sourceBranch: provisionedRepo.sourceBranch,
          sourceBaseCommit: provisionedRepo.sourceBaseCommit,
          baseBranch: provisionedRepo.baseBranch,
          baseCommit: provisionedRepo.baseCommit,
          executionBaseCommit: provisionedRepo.executionBaseCommit,
          provisionedAt: new Date().toISOString()
        }
      }));
    }

    if (provisioned !== undefined && repoLease?.repoRoot !== provisioned.repoRoot) {
      stopRepoHeartbeat?.();
      if (repoLease !== undefined) await releaseRepoLease(repoLease);
      repoLease = await claimRepoOrThrow(provisioned.repoRoot, runId);
      stopRepoHeartbeat = startRepoLeaseHeartbeat(repoLease);
    }

    console.log(`[Runner] Node preflight start run=${runId} task=${taskId}`);
    await runPreflight({
      repoRoot: provisioned.repoRoot,
      baseBranch: provisioned.baseBranch,
      legacyModel: run.model,
      graph,
      selectionLocked: run.executionConfig?.routing === "fixed",
      groundingSelection: groundingSelection(run),
      defaultExecutionSelection: executionSelection(run),
      defaultRepairSelection: repairSelection(run)
    });
    console.log(`[Runner] Node preflight ok run=${runId} task=${taskId}`);

    const manualSelection = executionSelection(run);
    await appendRunEventRequired(runId, {
      actor: "agent",
      type: "node.execution.started",
      payload: {
        nodeId: taskId,
        operationId: lease.operationId,
        attemptId: attempt.attemptId,
        agent: manualSelection.executorId,
        model: manualSelection.model
      }
    });

    publishEvent(runId, { kind: "agent.run.started", taskId, at: new Date().toISOString() });

    const traceStore = options.traceStore ?? new InMemoryTraceStore();
    console.log(`[Runner] Node engine start run=${runId} task=${taskId}`);
    await moveAttempt("executor_running");
    const nodeResult = await runNodeWithDefaultEngine({
      graph,
      model: run.model,
      defaultExecutionSelection: executionSelection(run),
      defaultRepairSelection: repairSelection(run),
      taskId,
      runId: run.runId,
      attemptId: attempt.attemptId,
      provisioned,
      ...(run.executionConfig !== undefined ? { executionConfig: run.executionConfig } : {}),
      ...(readiness.childResults !== undefined ? { childResults: readiness.childResults } : {}),
      traceStore
    });
    const attemptedNodeResult = nodeResult.kind === "leaf"
      ? { ...nodeResult, result: { ...nodeResult.result, attemptId: attempt.attemptId } }
      : { ...nodeResult, result: { ...nodeResult.result, attemptId: attempt.attemptId } };
    await moveAttempt("executor_finished");
    if (attemptedNodeResult.kind === "leaf") {
      await moveAttempt("diff_captured", {
        diffIdentity: {
          baseHead: attemptedNodeResult.result.baseHead,
          currentHead: attemptedNodeResult.result.currentHead,
          hash: digest(attemptedNodeResult.result.diff),
          files: attemptedNodeResult.result.changedFiles
        },
        executorResult: {
          exitCode: attemptedNodeResult.result.executorExitCode,
          timedOut: attemptedNodeResult.result.executorTimedOut,
          durationMs: attemptedNodeResult.result.executorDurationMs
        }
      });
      await moveAttempt("scope_evaluated", { scopeResult: attemptedNodeResult.result.scopeCheck });
      if (attemptedNodeResult.result.validationResult !== undefined) {
        await moveAttempt("validation_finished", { validationResult: attemptedNodeResult.result.validationResult });
      }
      if (attemptedNodeResult.result.commitSha !== undefined) await moveAttempt("commit_created", { commitSha: attemptedNodeResult.result.commitSha });
    } else if (attemptedNodeResult.result.integrationCommitSha !== undefined) {
      await moveAttempt("commit_created", { commitSha: attemptedNodeResult.result.integrationCommitSha });
    }
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
      nodeResult: attemptedNodeResult
    });
    run = await repo.get(runId);
    console.log(
      `[Runner] Persisting node result run=${runId} task=${taskId} mergedStatus=${merged.status} leaves=${merged.leafResults.length} integrations=${merged.integrationResults.length}`
    );
    await updateRunForOperation(runId, lease, (current) => ({
      ...current,
      execution: merged,
      executionTraces: [...(current.executionTraces ?? []), ...traceStore.list()],
      heartbeatAt: new Date().toISOString()
    }));
    await moveAttempt("result_persisted", {
      ...(attemptedNodeResult.kind === "leaf" && attemptedNodeResult.result.commitSha !== undefined
        ? { commitSha: attemptedNodeResult.result.commitSha }
        : {}),
      ...(attemptedNodeResult.kind === "integration" && attemptedNodeResult.result.integrationCommitSha !== undefined
        ? { commitSha: attemptedNodeResult.result.integrationCommitSha }
        : {}),
      nodeDisposition: attemptedNodeResult.result.status
    });

    if (attemptedNodeResult.kind === "leaf") {
      const leaf = attemptedNodeResult.result;
      await appendRunEventsRequired(runId, [
        ...(leaf.validationResult !== undefined
          ? [{
              actor: "system" as const,
              type: "node.verify.iteration" as const,
              payload: {
                nodeId: taskId, operationId: lease.operationId,
                iteration: 1, maxIterations: 1, build: "pass" as const,
                testsPass: leaf.validationResult.passed ? 1 : 0, testsTotal: 1
              }
            }]
          : []),
        leaf.status === "success"
          ? {
              actor: "agent" as const,
              type: "node.verify.passed" as const,
              payload: { nodeId: taskId, operationId: lease.operationId, commit: leaf.commitSha ?? leaf.currentHead, changedFiles: [...leaf.changedFiles], builtAgainst: consumedRevisionRefs(graph, taskId) }
            }
          : {
              actor: "agent" as const,
              type: "node.execution.failed" as const,
              payload: { nodeId: taskId, operationId: lease.operationId, cause: leafFailureCause(leaf) }
            }
      ]);
    }

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
    if (run !== null && lease !== undefined) {
      await updateRunForOperation(run.runId, lease, (current) => ({ ...current, errorMessage: message }))
        .catch((failure) => {
          if (!(failure instanceof RunMutationConflictError)) throw failure;
        });
    }
    publishEvent(runId, {
      kind: "agent.run.completed",
      taskId,
      success: false,
      at: new Date().toISOString()
    });
  } finally {
    stopRepoHeartbeat?.();
    if (repoLease !== undefined) {
      await releaseRepoLease(repoLease).catch(() => undefined);
    }
    stopHeartbeat?.();
    if (lease !== undefined) await releaseRunOperation(runId, lease);
    markRunnerInactive(runId);
  }
}

export async function assertManualNodeExecutionReady(run: RunRecord, taskId: string): Promise<void> {
  if (run.status !== "approved") {
    throw new RunLifecycleError(`Cannot execute individual nodes from status ${run.status}`);
  }
  const graph = await resolveExecutionGraph(run);
  assertExecutableRunGraph(graph);
  assertApprovedPlanRevision(run);
  const readiness = manualReadinessForTask(graph, taskId, executionResultsFromRun(run));
  if (!readiness.ready) {
    throw new RunLifecycleError(readiness.reason);
  }
}

function assertApprovedPlanRevision(run: RunRecord): void {
  const revision = run.planRevision ?? 1;
  const legacyApproved = run.approvedAt !== undefined || [
    "approved", "running", "completed", "completed_with_accepted", "partial",
    "unverified", "needs_delivery", "failed_artifact", "failed_delivery"
  ].includes(run.status) || (run.status === "failed" && run.failedDuring === "running");
  const approvedRevision = run.approvedPlanRevision ?? (legacyApproved ? 1 : undefined);
  if (approvedRevision !== revision) {
    throw new RunLifecycleError(
      `Plan revision ${revision} is not approved (approved revision: ${run.approvedPlanRevision ?? "none"}).`
    );
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
    return repo.update(run.runId, (current) => {
      const reviews: Record<string, NodeReview> = { ...(current.nodeReviews ?? {}) };
      reviews[taskId] = { status: "approved", at: now };
      return { ...current, nodeReviews: reviews, updatedAt: now };
    });
  }

  assertRunActionAllowed(run, action === "rerun" ? "manual_node_rerun" : "manual_node_review");
  if (isRunnerActive(run.runId)) {
    throw new RunLifecycleError(`Run ${run.runId} is being driven by an active runner.`);
  }

  // Re-open a finished run so Rerun / Request changes work in the autonomous
  // flow too (not only during the manual `approved` workflow).
  if (run.status === "completed" || run.status === "completed_with_accepted" || run.status === "failed") {
    assertTransition(run.status, "approved");
    run = await saveRunWithRequiredStatusEvent(run, { ...run, status: "approved", updatedAt: now }, { at: now, actor: "human" });
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
