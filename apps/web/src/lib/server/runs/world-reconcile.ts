/**
 * Cold-restart reconciliation seam (INV-3) — runs BEFORE re-entering the
 * execution graph whenever a thread checkpoint exists. Audits checkpoint
 * health (corrupt latest.json → degraded resume; all corrupt → lost), runs
 * the physical world reconciler from execution-core, and projects everything
 * as durable run-model events. When evidence was invalidated, the execution
 * artifact is filtered and the thread reset so the wavefront re-enters seeded
 * only with surviving results — the same reseed mechanism amendments use.
 */
import { join } from "node:path";
import { SimpleGitRunner, reconcileWorld, type ReconciliationReport } from "@manyhands/execution-core";
import type { AgentExecutionResult, IntegrationResult, RunExecutionResult } from "@manyhands/execution-core";
import { JsonFileCheckpointSaver } from "@manyhands/orchestrator-graph";
import { resolveRunsDirectory } from "./repository";
import { appendRunModelEvent } from "./run-model-event-log";
import { executionResultsFromRun } from "./execution-state";
import { resetExecutionThread } from "./execution-host";
import { getRunRepository } from "./store";
import type { ProvisionedRepo } from "./repo-provisioner";
import type { RunRecord } from "./schema";

/** Raised when the provisioned repo can no longer host the run (INV-3). */
export class RunNotResumableError extends Error {
  constructor(runId: string, detail: string) {
    super(
      `Run ${runId} cannot resume: ${detail} ` +
        "Exportá el patch desde la evidencia del run o abortalo; el repo destino ya no contiene la base."
    );
    this.name = "RunNotResumableError";
  }
}

export interface WorldReconcileOutcome {
  run: RunRecord;
  report: ReconciliationReport;
  /** True when the thread was reset (invalidations or lost checkpoints) — the caller must re-enter from scratch. */
  threadReset: boolean;
}

/**
 * Reconcile checkpoint + filesystem before a cold resume. Persists the audit
 * events durably (INV-6) and either returns the (possibly filtered) run ready
 * to resume, or throws RunNotResumableError when the base commit vanished.
 */
export async function reconcileExecutionWorld(
  run: RunRecord,
  provisioned: ProvisionedRepo
): Promise<WorldReconcileOutcome> {
  const runId = run.runId;
  const now = (): string => new Date().toISOString();
  let threadReset = false;

  // 1) Checkpoint health: never resume silently over corruption.
  const checkpointer = new JsonFileCheckpointSaver(join(resolveRunsDirectory(), "checkpoints"));
  const health = await checkpointer.inspectThread(runId);
  if (health.status === "degraded") {
    await appendRunModelEvent(runId, {
      actor: "system",
      at: now(),
      type: "checkpoint.degraded",
      payload: { usedCheckpointId: health.checkpointId, corrupted: health.corrupted }
    });
  } else if (health.status === "lost") {
    await appendRunModelEvent(runId, {
      actor: "system",
      at: now(),
      type: "checkpoint.lost",
      payload: { corrupted: health.corrupted }
    });
    // Nothing readable: drop the thread so the pipeline re-enters from scratch
    // (grounding re-runs) seeded with whatever the RunRecord still holds.
    await resetExecutionThread(runId);
    threadReset = true;
  }

  // 2) Physical world vs. recorded evidence.
  const existing = executionResultsFromRun(run);
  const report = await reconcileWorld({
    git: new SimpleGitRunner(),
    repoRoot: provisioned.repoRoot,
    runId,
    baseCommit: provisioned.baseCommit,
    leafEvidence: existing.leafResults.map((result) => ({
      taskId: result.taskId,
      commitSha: result.commitSha
    })),
    integrationEvidence: existing.integrationResults.map((result) => ({
      taskId: result.compositeTaskId,
      commitSha: result.integrationCommitSha
    }))
  });

  await appendRunModelEvent(runId, {
    actor: "system",
    at: now(),
    type: "world.reconciled",
    payload: {
      baseCommitReachable: report.baseCommitReachable,
      keptTaskIds: report.keptTaskIds,
      invalidatedTaskIds: report.invalidatedTaskIds,
      cleanedWorktrees: report.cleanedWorktrees,
      gcFailures: report.gcFailures,
      removedLocks: report.removedLocks,
      warnings: report.warnings
    }
  });

  if (!report.baseCommitReachable) {
    const saved = await getRunRepository().update(runId, (current) => ({
      ...current,
      status: "interrupted" as const,
      interruptedDuring: "running" as const,
      errorMessage:
        `interrupted: el commit base ${provisioned.baseCommit} ya no existe en el repo destino ` +
        "(¿git gc / repo recreado?). Exportá el patch o abortá el run."
    }));
    void saved;
    throw new RunNotResumableError(runId, `base commit ${provisioned.baseCommit} is unreachable.`);
  }

  // 3) Invalidations: filter the artifact and reset the thread so the frontier
  //    re-dispatches exactly the invalidated closure.
  if (report.invalidatedTaskIds.length > 0) {
    const invalidated = new Set(report.invalidatedTaskIds);
    const updated = await getRunRepository().update(runId, (current) => {
      const execution = current.execution as Partial<RunExecutionResult> | undefined;
      if (execution === undefined) return current;
      const leafResults = (execution.leafResults ?? []).filter(
        (result: AgentExecutionResult) => !invalidated.has(result.taskId)
      );
      const integrationResults = (execution.integrationResults ?? []).filter(
        (result: IntegrationResult) => !invalidated.has(result.compositeTaskId)
      );
      return { ...current, execution: { ...execution, leafResults, integrationResults } };
    });
    await resetExecutionThread(runId);
    threadReset = true;
    return { run: updated, report, threadReset };
  }

  const current = await getRunRepository().get(runId);
  return { run: current, report, threadReset };
}
