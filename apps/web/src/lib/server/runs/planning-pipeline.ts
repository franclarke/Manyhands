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
import { getWorkspaceRepository } from "../workspaces";
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
import { generateRunTitle, type RunTitle } from "./run-titler";
import { startHeartbeat } from "./runner-heartbeat";
import { markRunnerActive, markRunnerInactive } from "./runner-state";
import { appendRunStatusChanged, publishRunStatusChanged } from "./run-status-events";
import type { ExecutionConfigInput, RunRecord, RunStatus } from "./schema";
import { getRunRepository } from "./store";

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
  /** Injectable for tests; defaults to the real Gemini-backed titler. */
  titler?: (input: { userPrompt: string; model: string }) => Promise<RunTitle>;
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
  extra: Partial<RunRecord> = {}
): Promise<RunRecord> {
  console.log(`[Runner] Run ${run.runId}: Transición de estado de "${run.status}" a "${status}"`);
  assertTransition(run.status, status);
  const next: RunRecord = { ...run, ...extra, status };
  const saved = await getRunRepository().save(next);
  publishRunStatusChanged(saved);
  return saved;
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
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "created" || run.status === "interrupted") {
      run = await transitionTo(run, "generating", {
        startedAt: run.startedAt ?? new Date().toISOString()
      });
    }

    // Generate a clean title + summary before decomposition so the workspace
    // header reads well while the graph is still generating. Cosmetic: a titler
    // failure must NOT fail the run (this is presentation, not D3).
    if (run.summary === undefined) {
      const titleFn = options.titler ?? ((input) => generateRunTitle(input));
      const runTitle = await titleFn({
        userPrompt: run.userPrompt,
        model: run.planningModel ?? run.model
      }).catch((error) => {
        console.warn(
          `[Runner] Titler skipped for run ${run.runId}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      });
      if (runTitle !== null) {
        run = await getRunRepository().save({ ...run, title: runTitle.title, summary: runTitle.summary });
        publishRunEvent(run.runId, {
          kind: "title.updated",
          title: runTitle.title,
          summary: runTitle.summary,
          at: new Date().toISOString()
        });
      }
    }

    const host = buildPlanningHost(run, options);
    const input = (await hasPlanningCheckpoint(runId))
      ? null
      : initialPlanningState(run, await resolveRepoPath(run));

    const outcome = await drivePlanning(host, input);
    await waitWhilePlainPaused(runId, "generating");
    await projectPlanningOutcome(runId, outcome);
  } catch (error) {
    await failPlanning(runId, error);
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
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
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    const run = await getRunRepository().get(runId);
    const host = buildPlanningHost(run, options);
    const outcome = await drivePlanning(host, new Command({ resume: decision }));
    await waitWhilePlainPaused(runId, "generating");
    await projectPlanningOutcome(runId, outcome);
  } catch (error) {
    await failPlanning(runId, error);
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
  }
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
  // acknowledge=true: autonomy explicitly opts past the critic-error gate.
  await processPlanApproval(runId, true);
  await runExecutionPipeline(runId);
}

// ─── outcome projection ────────────────────────────────────────────────────

async function projectPlanningOutcome(runId: string, outcome: PlanningDriveOutcome): Promise<void> {
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
      await repo.save({
        ...run,
        status: "generating",
        questionAnswers: { ...(run.questionAnswers ?? {}), [outcome.interrupt.nodeId]: answer }
      });
      const nodeId = outcome.interrupt.nodeId;
      setTimeout(() => {
        void resumePlanningPipeline(runId, planningResumeFor(nodeId, answer)).catch((error) => {
          console.error(`[Runner] Auto-respuesta falló para ${runId}:`, error);
        });
      }, 0);
      return;
    }

    console.log(
      `[Runner] Planificación pausada en el nodo "${outcome.interrupt.nodeId}" para interactuar con el usuario.`
    );
    const saved = await repo.save({
      ...run,
      status: "paused",
      pausedDuring: "generating",
      pendingQuestion: {
        nodeId: outcome.interrupt.nodeId,
        question: outcome.interrupt.question,
        options: outcome.interrupt.options
      }
    });
    const now = new Date().toISOString();
    await appendRunStatusChanged(saved, { at: now });
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
    const saved = await repo.save({
      ...run,
      status: "paused",
      pausedDuring: "generating",
      pendingQuestion: { nodeId: PLAN_DEGRADED_NODE_ID, question, options }
    });
    const now = new Date().toISOString();
    await appendRunStatusChanged(saved, { at: now });
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
    const reviewed = run.status === "needs_review" ? run : await transitionTo(run, "needs_review");

    // Autonomy (W6): semi/autonomous skip the human approval gate — auto-approve
    // the plan and start execution. Supervised stays parked at needs_review.
    if (reviewed.autonomy === "semi" || reviewed.autonomy === "autonomous") {
      console.log(`[Runner] Autonomía "${reviewed.autonomy}": auto-aprobando el plan y ejecutando ${runId}.`);
      void autoApproveAndExecute(runId).catch((error) => {
        console.error(`[Runner] Auto-aprobación falló para ${runId}:`, error);
      });
    }
    return;
  }

  // Finished: the approval gate resolved, or the human aborted from the
  // degraded gate (the only INV-5-sanctioned road to "failed" here).
  if (outcome.status === "failed") {
    const saved = await repo.save({
      ...run,
      status: "failed",
      failedDuring: "generating",
      errorMessage: `aborted by user at plan_degraded gate: ${outcome.errorMessage ?? "plan generation failed"}`
    });
    await appendRunStatusChanged(saved);
    return;
  }
  if (outcome.status === "approved" && run.status !== "approved") {
    await transitionTo(run, "approved", { approvedAt: new Date().toISOString() });
  }
}

async function failPlanning(runId: string, error: unknown): Promise<void> {
  console.error(`[Runner] FALLÓ la generación del plan para el run "${runId}":`, error);
  const message = error instanceof Error ? error.message : String(error);
  const run = await getRunRepository()
    .get(runId)
    .catch(() => null);
  if (run !== null) {
    const saved = await getRunRepository().save({
      ...run,
      status: "failed",
      failedDuring: "generating",
      errorMessage: message
    });
    await appendRunStatusChanged(saved);
  }
}

async function resolveRepoPath(run: RunRecord): Promise<string> {
  const workspace = await getWorkspaceRepository()
    .get(run.workspaceId)
    .catch(() => null);
  return workspace?.repoPath ?? "";
}
