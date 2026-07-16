/**
 * Planning pipeline — drives the LangGraph planning StateGraph for a run.
 *
 * The graph (see @manyhands/orchestrator-graph planning-graph.ts) owns the
 * control flow: decompose ⇄ questionGate, critics, approvalGate. This module
 * owns the RunRecord projection: status transitions, pause bookkeeping for the
 * DecisionChannel, and the SSE status events. Clarifying questions and plan
 * approval are native interrupts resumed with Command({ resume }) — the
 * exception-driven HITL flow (DecomposerQuestionError) no longer exists here.
 *
 * Transitions: created/interrupted → generating → needs_review → approved
 * (or paused while a question waits; or failed with an actionable message).
 */
import { Command } from "@langchain/langgraph";
import type { PredictedConflictHint, RunExecutionResult } from "@manyhands/execution-core";
import type { PlanningResumeDecision } from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import { type TraceStore } from "@manyhands/trace-store";
import { publishRunEvent } from "./event-bus";
import { assertTransition } from "./lifecycle";
import { waitWhilePlainPaused } from "./pause-control";
import {
  PLAN_DEGRADED_NODE_ID,
  PLAN_DEGRADED_OPTIONS,
  buildPlanningHost,
  drivePlanning,
  hasPlanningCheckpoint,
  initialPlanningState,
  planningResumeFor,
  type PlanningDriveOutcome
} from "./planning-host";
import { publishRunModelEvent } from "./run-model-event-log";
import { type ProvisionedRepo, type RepoProvisioner } from "./repo-provisioner";
import { titlerSelection } from "./executor-selection";
import { supervisedSpawnFn } from "./process-supervision";
import { resolveRunTargetPath } from "./target-context";
import { generateRunTitle, type RunTitle } from "./run-titler";
import { persistEffectivePlanningBudget } from "./effective-planning-budget";
import type { ExecutorSelection } from "@manyhands/execution-core";
import { startHeartbeat } from "./runner-heartbeat";
import { markRunnerInactive, startRunBackgroundTask, tryMarkRunnerActive } from "./runner-state";
import { saveRunWithRequiredStatusEvent } from "./audited-mutation";
import { assertExecutableRunGraph, resolveExecutionGraph } from "./execution-state";
import { RunMutationConflictError } from "./errors";
import { DEFAULT_STALE_MS } from "./interrupted";
import {
  claimRunOperation,
  releaseRunOperationWithRetry,
  updateRunForOperation
} from "./run-operation-lease";
import type { ExecutionConfigInput, RunOperationLease, RunRecord, RunStatus } from "./schema";
import { getRunRepository } from "./store";
import { settleRunCancellation } from "./cancel-service";

export { computeInvalidatedTasks } from "./execution-state";
export type { ExecutionResults } from "./execution-state";
export {
  buildFeatureRequestFromPrompt,
  persistLivePlanningNodes,
  hasPlanningCheckpoint,
  resetPlanningThread
} from "./planning-host";

// Re-export for the SSE endpoint to detect orphaned runs.
export { isRunnerActive } from "./runner-state";

export interface PlanningRunnerOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the selected executor-backed titler. */
  titler?: (input: { userPrompt: string; selection: ExecutorSelection; model: string }) => Promise<RunTitle>;
}

/**
 * Execution seam (C17). The pipeline resolves the graph and maps results to
 * SSE; the engine owns the actual run. The default engine drives the real
 * RunExecutor against a git repo, but tests (and future provisioning layers)
 * can inject their own to stay deterministic without disk/network/CLIs.
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
}

export async function transitionTo(
  run: RunRecord,
  status: RunStatus,
  extra: Partial<RunRecord> = {},
  options: { lease?: RunOperationLease } = {}
): Promise<RunRecord> {
  console.log(`[Runner] Run ${run.runId}: Transición de estado de "${run.status}" a "${status}"`);
  assertTransition(run.status, status);
  const next: RunRecord = { ...run, ...extra, status };
  return saveRunWithRequiredStatusEvent(run, next, {
    ...(options.lease !== undefined ? { lease: options.lease } : {})
  });
}

export async function waitWhilePaused(runId: string, phase: "generating" | "running"): Promise<void> {
  await waitWhilePlainPaused(runId, phase);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run (or continue) the planning graph for a run. Fresh runs enter at START;
 * runs with a persisted planning checkpoint continue from their last
 * suspension point (idempotent: re-driving a suspended gate just re-projects
 * the same pause).
 */
export async function runPlanningPipeline(runId: string, options: PlanningRunnerOptions = {}): Promise<void> {
  console.log(`[Runner] Iniciando pipeline de planificación para el run: ${runId}`);
  if (!tryMarkRunnerActive(runId)) {
    console.warn(`[Runner] Planning pipeline already active for run: ${runId}`);
    return;
  }
  let lease: RunOperationLease | undefined;
  let stopHeartbeat: (() => void) | undefined;
  try {
    const claimed = await claimRunOperation(runId, "planning", {
      expectedStatuses: ["created", "generating", "interrupted"],
      allowTakeover: true,
      takeoverStaleAfterMs: DEFAULT_STALE_MS
    });
    lease = claimed.lease;
    stopHeartbeat = startHeartbeat(runId, lease);
    let run = claimed.run;
    if (run.status === "created" || run.status === "interrupted") {
      run = await transitionTo(run, "generating", {
        startedAt: run.startedAt ?? new Date().toISOString()
      }, { lease });
    }
    run = await persistEffectivePlanningBudget(runId, lease);

    // Generate a clean title + summary before decomposition so the workspace
    // header reads well while the graph is still generating. This is a
    // presentation-only helper: it must use the selected executor, but it must
    // never block decomposition if the auxiliary model call fails or times out.
    if (run.summary === undefined) {
      // B-005: the titler CLI is registered under the run so cancel kills it.
      const titlerSpawn = supervisedSpawnFn({
        runId: run.runId,
        label: "titler",
        ...(lease !== undefined ? { operationId: lease.operationId } : {})
      });
      const titleFn = options.titler ?? ((input) => generateRunTitle({ ...input, spawn: titlerSpawn }));
      const selection = titlerSelection(run);
      let runTitle: RunTitle;
      try {
        runTitle = await titleFn({
          userPrompt: run.userPrompt,
          selection,
          model: selection.model
        });
      } catch (error) {
        console.warn(
          `[Runner] Run titler skipped for run ${run.runId}: ${error instanceof Error ? error.message : String(error)}`
        );
        runTitle = fallbackRunTitle(run.userPrompt);
      }
      run = await updateRunForOperation(run.runId, lease, (current) => ({
        ...current,
        title: runTitle.title,
        summary: runTitle.summary
      }));
      publishRunEvent(run.runId, {
        kind: "title.updated",
        title: runTitle.title,
        summary: runTitle.summary,
        at: new Date().toISOString()
      });
    }

    run = await getRunRepository().get(runId);
    if (run.status === "interrupted") {
      console.log(`[Runner] Planning pipeline stopped before decomposition; run ${runId} is interrupted.`);
      return;
    }

    const host = buildPlanningHost(run, { ...options, operationLease: lease });
    const input = (await hasPlanningCheckpoint(runId))
      ? null
      : initialPlanningState(run, await resolveRepoPath(run));

    const outcome = await drivePlanning(host, input);
    await waitWhilePlainPaused(runId, "generating");
    await projectPlanningOutcome(runId, outcome, lease);
  } catch (error) {
    if (!(error instanceof RunMutationConflictError)) {
      await failPlanning(runId, error, lease);
    }
  } finally {
    await finalizePlanningPipelineOwnership(runId, lease, stopHeartbeat);
  }
}

/**
 * Resume a suspended planning gate natively: a question answer or the plan
 * approval decision travels as Command({ resume }) — checkpoints are never
 * hand-edited. Falls back to re-running the pipeline for legacy runs that
 * have no planning checkpoint yet.
 */
export async function resumePlanningPipeline(
  runId: string,
  decision: PlanningResumeDecision,
  options: PlanningRunnerOptions = {}
): Promise<void> {
  if (!(await hasPlanningCheckpoint(runId))) {
    await runPlanningPipeline(runId, options);
    return;
  }

  console.log(`[Runner] Reanudando planning graph para el run: ${runId}`);
  if (!tryMarkRunnerActive(runId)) {
    console.warn(`[Runner] Planning pipeline already active for run: ${runId}`);
    return;
  }
  let lease: RunOperationLease | undefined;
  let stopHeartbeat: (() => void) | undefined;
  try {
    const claimed = await claimRunOperation(runId, "planning", {
      expectedStatuses: ["generating", "paused", "interrupted"],
      allowTakeover: true,
      takeoverStaleAfterMs: DEFAULT_STALE_MS
    });
    lease = claimed.lease;
    stopHeartbeat = startHeartbeat(runId, lease);
    const run = claimed.run;
    const host = buildPlanningHost(run, { ...options, operationLease: lease });
    const outcome = await drivePlanning(host, new Command({ resume: decision }));
    await waitWhilePlainPaused(runId, "generating");
    await projectPlanningOutcome(runId, outcome, lease);
  } catch (error) {
    if (!(error instanceof RunMutationConflictError)) {
      await failPlanning(runId, error, lease);
    }
  } finally {
    await finalizePlanningPipelineOwnership(runId, lease, stopHeartbeat);
  }
}

async function finalizePlanningPipelineOwnership(
  runId: string,
  lease: RunOperationLease | undefined,
  stopHeartbeat: (() => void) | undefined
): Promise<void> {
  if (lease !== undefined) await settleRunCancellation(runId);
  let firstError: unknown;
  try {
    try {
      stopHeartbeat?.();
    } catch (error) {
      firstError = error;
    }
    if (lease !== undefined) {
      try {
        await releaseRunOperationWithRetry(runId, lease);
      } catch (error) {
        firstError ??= error;
      }
    }
  } finally {
    markRunnerInactive(runId);
  }
  if (firstError !== undefined) throw firstError;
}

/**
 * Autonomy auto-approval (W6): approve the plan and kick off execution without a
 * human. Dynamic imports break the static cycle (plan-approval-service and
 * execution-pipeline both import this module). Runs fire-and-forget after the
 * planning pipeline has parked the run at needs_review.
 */
async function autoApproveAndExecute(runId: string): Promise<void> {
  const { processPlanApproval } = await import("./plan-approval-service");
  const { runExecutionPipeline } = await import("./execution-pipeline");
  await processPlanApproval(runId);
  await runExecutionPipeline(runId);
}

// ─── outcome projection ────────────────────────────────────────────────────

async function projectPlanningOutcome(
  runId: string,
  outcome: PlanningDriveOutcome,
  lease: RunOperationLease
): Promise<void> {
  const repo = getRunRepository();
  const run = await repo.get(runId);

  if (run.status === "interrupted") {
    console.log(`[Runner] Planificación cancelada para el run: ${runId}`);
    return;
  }

  if (outcome.kind === "question") {
    // Autonomy (W6): an autonomous run answers clarifying questions itself with
    // the recommended option (the decomposer is told to list it first) so it can
    // run unattended. The resume is deferred to a macrotask so it starts AFTER
    // this runner's finally has released the active marker (no double-active).
    if (run.autonomy === "autonomous") {
      const answer = outcome.interrupt.options[0] ?? "Usá tu criterio y elegí la opción más razonable.";
      console.log(
        `[Runner] Autonomía autonomous: auto-respondiendo "${outcome.interrupt.question}" → "${answer}" (${runId}).`
      );
      await updateRunForOperation(runId, lease, (current) => ({
        ...current,
        status: "generating",
        questionAnswers: { ...(current.questionAnswers ?? {}), [outcome.interrupt.nodeId]: answer }
      }));
      const nodeId = outcome.interrupt.nodeId;
      startRunBackgroundTask(runId, "planning:auto-answer", async () => {
        await sleep(0);
        await resumePlanningPipeline(runId, planningResumeFor(nodeId, answer));
      });
      return;
    }

    console.log(
      `[Runner] Planificación pausada en el nodo "${outcome.interrupt.nodeId}" para interactuar con el usuario.`
    );
    const next = {
      ...run,
      status: "paused" as const,
      pausedDuring: "generating" as const,
      pendingQuestion: {
        nodeId: outcome.interrupt.nodeId,
        question: outcome.interrupt.question,
        options: outcome.interrupt.options
      }
    };
    const now = new Date().toISOString();
    await saveRunWithRequiredStatusEvent(run, next, { at: now, lease });
    publishRunEvent(runId, {
      kind: "planning.question",
      nodeId: outcome.interrupt.nodeId,
      question: outcome.interrupt.question,
      options: outcome.interrupt.options,
      at: now
    });
    return;
  }

  if (outcome.kind === "degraded") {
    // Terminal generation failure → gate, not plain "failed" (INV-5). Projects
    // as a pending question under a synthetic node id, so the existing answer
    // routes (and their idempotent claims) drive the retry/abort decision.
    console.warn(`[Runner] Planificación degradada para el run ${runId}: ${outcome.interrupt.errorMessage}`);
    const options = PLAN_DEGRADED_OPTIONS.map((option) => option.label);
    const question =
      `La generación del plan falló tras los reintentos: ${outcome.interrupt.errorMessage} ` +
      "¿Cómo querés continuar?";
    const next = {
      ...run,
      status: "paused" as const,
      pausedDuring: "generating" as const,
      pendingQuestion: { nodeId: PLAN_DEGRADED_NODE_ID, question, options }
    };
    const now = new Date().toISOString();
    await saveRunWithRequiredStatusEvent(run, next, { at: now, lease });
    publishRunEvent(runId, {
      kind: "planning.question",
      nodeId: PLAN_DEGRADED_NODE_ID,
      question,
      options,
      at: now
    });
    publishRunModelEvent(runId, {
      actor: "system",
      at: now,
      type: "decision.raised",
      payload: {
        decisionId: `clarify:${PLAN_DEGRADED_NODE_ID}`,
        kind: "clarify",
        blocking: true,
        context: { nodeIds: [PLAN_DEGRADED_NODE_ID], question, options }
      }
    });
    return;
  }

  if (outcome.kind === "awaiting_approval") {
    console.log(`[Runner] Planificación completada con éxito para el run: ${runId}`);
    assertExecutableRunGraph(resolveExecutionGraph(run));
    const reviewed =
      run.status === "needs_review" ? run : await transitionTo(run, "needs_review", {}, { lease });

    // Autonomy (W6): semi/autonomous skip the human approval gate — auto-approve
    // the plan and start execution. Supervised stays parked at needs_review.
    if (reviewed.autonomy === "semi" || reviewed.autonomy === "autonomous") {
      console.log(`[Runner] Autonomía "${reviewed.autonomy}": auto-aprobando el plan y ejecutando ${runId}.`);
      startRunBackgroundTask(runId, "planning:auto-approve", () => autoApproveAndExecute(runId));
    }
    return;
  }

  // Finished: the approval gate resolved, or the human aborted from the
  // degraded gate (the only INV-5-sanctioned road to "failed" here).
  if (outcome.status === "failed") {
    await saveRunWithRequiredStatusEvent(run, {
      ...run,
      status: "failed",
      failedDuring: "generating",
      errorMessage: `aborted by user at plan_degraded gate: ${outcome.errorMessage ?? "plan generation failed"}`
    }, { lease });
    return;
  }
  if (outcome.status === "approved" && run.status !== "approved") {
    await transitionTo(run, "approved", {
      approvedAt: new Date().toISOString(),
      approvedPlanRevision: run.planRevision ?? 1
    }, { lease });
  }
}

async function failPlanning(
  runId: string,
  error: unknown,
  lease: RunOperationLease | undefined
): Promise<void> {
  console.error(`[Runner] FALLÓ la generación del plan para el run "${runId}":`, error);
  const message = error instanceof Error ? error.message : String(error);
  if (lease === undefined) return;
  const run = await getRunRepository().get(runId).catch(() => null);
  if (run === null) return;
  await saveRunWithRequiredStatusEvent(
    run,
    { ...run, status: "failed", failedDuring: "generating", errorMessage: message },
    { lease }
  ).catch((failure) => {
    if (!(failure instanceof RunMutationConflictError)) throw failure;
  });
}

function fallbackRunTitle(userPrompt: string): RunTitle {
  const normalized = userPrompt.replace(/\s+/g, " ").trim();
  const base = normalized.length > 0 ? normalized : "Untitled run";
  return {
    title: truncateAtWord(base, 80),
    summary: truncateAtWord(base, 400)
  };
}

function truncateAtWord(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength).trimEnd();
  const lastSpace = clipped.lastIndexOf(" ");
  return (lastSpace > 20 ? clipped.slice(0, lastSpace) : clipped).trimEnd();
}

async function resolveRepoPath(run: RunRecord): Promise<string> {
  // B-008: the frozen target context wins; the workspace is only a legacy
  // fallback for pre-context runs.
  return (await resolveRunTargetPath(run)) ?? "";
}
