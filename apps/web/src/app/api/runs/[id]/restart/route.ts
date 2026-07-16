import { NextResponse } from "next/server";
import {
  appendStatusEventOrRollback,
  assertRunActionAllowed,
  assertTransition,
  claimRunMutation,
  getRunRepository,
  isRunnerActive,
  requireCapturedRunRecord,
  resetPlanningThread,
  restartResumesExecution,
  runExecutionPipeline,
  runPlanningPipeline,
  type RunRecord
} from "@/lib/server/runs";
import { resetExecutionThread } from "@/lib/server/runs/execution-host";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { startRunBackgroundTask } from "@/lib/server/runs/runner-state";
import { withDefaultReasoningEffort } from "@/lib/server/runs/execution-config-defaults";
import { resumeDurablePendingReplan } from "@/lib/server/runs/replan-service";
import {
  claimRunOperation,
  assertRunOperationCurrent,
  invalidateRunOperation,
  mutateRunWithLease,
  releaseRunOperation
} from "@/lib/server/runs/run-operation-lease";
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import { DEFAULT_STALE_MS } from "@/lib/server/runs/interrupted";
import type { RunOperationLease } from "@/lib/server/runs/schema";
import { startHeartbeat } from "@/lib/server/runs/runner-heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const restartCandidate = await getRunRepository().get(id);
    assertRunActionAllowed(restartCandidate, "restart");
    if (isRunnerActive(id)) {
      throw new RunMutationConflictError(
        `Run ${id} is being driven by an active runner; wait for it to pause or finish.`,
        restartCandidate.status,
        restartCandidate.version
      );
    }

    const preparesFreshPlanning = restartStartsFreshPlanning(restartCandidate);
    if (preparesFreshPlanning) {
      return await restartFreshPlanning(restartCandidate);
    }

    // Claim the restart atomically (INV-4): only explicitly restartable durable
    // statuses can be claimed. The mutator moves the run OUT of that state so a
    // restartable, an in-process runner blocks the claim, and the mutator moves
    // the run OUT of a restartable status — so a concurrent second restart gets
    // a deterministic 409 instead of kicking a duplicate pipeline.
    let resumesExecution = false;
    let resumesPendingReplan = false;
    let restoresPendingReplanQuestion = false;
    let previous: RunRecord | undefined;
    const claimed = await claimRunMutation(
      id,
      {
        status: ["interrupted", "failed", "failed_artifact"],
        version: restartCandidate.version,
        rejectActiveRunner: true,
        rejectFreshOperationAfterMs: DEFAULT_STALE_MS
      },
      (current) => {
        previous = current;
        assertRunActionAllowed(current, "restart");
        restoresPendingReplanQuestion =
          current.status === "interrupted" &&
          current.pendingQuestion !== undefined &&
          current.pendingReplan !== undefined;
        if (restoresPendingReplanQuestion) {
          assertTransition(current.status, "paused");
          const next = {
            ...invalidateRunOperation(current),
            status: "paused" as const,
            pausedDuring: "running" as const,
            interruptedDuring: undefined,
            errorMessage: undefined,
            failedDuring: undefined
          };
          return next;
        }
        resumesPendingReplan =
          (current.status === "interrupted" || current.status === "failed") &&
          current.pendingQuestion === undefined &&
          current.pendingReplan?.resumeRequestedAt !== undefined;
        if (resumesPendingReplan) {
          assertTransition(current.status, "running");
          const next = {
            ...invalidateRunOperation(current),
            status: "running" as const,
            interruptedDuring: undefined,
            errorMessage: undefined,
            failedDuring: undefined
          };
          delete next.pausedDuring;
          return next;
        }
        resumesExecution = restartResumesExecution(current);
        const now = new Date().toISOString();
        const effectiveSelection =
          current.defaultExecutionSelection ??
          (current.planningExecutorId !== undefined
            ? { executorId: current.planningExecutorId, model: current.planningModel ?? current.model }
            : undefined);
        const executionConfig = withDefaultReasoningEffort(current.executionConfig, effectiveSelection);
        if (resumesExecution) {
          // The execution pipeline transitions "approved" → "running". Persist
          // approved metadata if missing and bridge through the lifecycle step.
          assertTransition(current.status, "approved");
          const next = {
            ...invalidateRunOperation(current),
            status: "approved" as const,
            errorMessage: undefined,
            failedDuring: undefined,
            interruptedDuring: undefined,
            executionConfig,
            approvedAt: current.approvedAt ?? now
          };
          delete next.pausedDuring;
          delete next.pendingDecision;
          delete next.pendingQuestion;
          delete next.pendingReplan;
          return next;
        }
        throw new RunMutationConflictError(
          `Run ${id} requires fenced fresh-planning preparation before restart.`,
          current.status,
          current.version
        );
      }
    );
    await appendStatusEventOrRollback(requireCapturedRunRecord(previous, id), claimed, { actor: "human" });

    if (restoresPendingReplanQuestion) {
      return NextResponse.json(await toCanonicalRunResponse(claimed));
    }

    if (resumesPendingReplan) {
      const handoff = await getRunRepository().get(claimed.runId);
      if (handoff.status === "running" && handoff.activeOperation === undefined) {
        startRunBackgroundTask(handoff.runId, "route:restart:replan-resume", () =>
          resumeDurablePendingReplan(handoff.runId).then(() => undefined)
        );
      }
      return NextResponse.json(await toCanonicalRunResponse(handoff));
    }

    if (resumesExecution) {
      startRunBackgroundTask(claimed.runId, "route:restart:execution", () => runExecutionPipeline(claimed.runId));
      return NextResponse.json(await toCanonicalRunResponse(await getRunRepository().get(id)));
    }

    throw new Error(`Restart classification invariant failed for run ${claimed.runId}.`);
  } catch (error) {
    return runErrorResponse(error);
  }
}

async function restartFreshPlanning(candidate: RunRecord): Promise<NextResponse> {
  // Checkpoints are external durable state. Acquire the durable/fenced writer
  // authority while the record remains restartable, then clean them. A second
  // process cannot race a late delete against the winner's new checkpoint.
  const { run: leased, lease } = await claimRunOperation(candidate.runId, "planning", {
    expectedStatuses: ["interrupted", "failed", "failed_artifact"],
    expectedVersion: candidate.version,
    allowTakeover: true,
    takeoverStaleAfterMs: DEFAULT_STALE_MS
  });
  let stopHeartbeat: (() => void) | undefined = startHeartbeat(candidate.runId, lease);
  try {
    await assertRunOperationCurrent(candidate.runId, lease);
    const resetResults = await Promise.allSettled([
      resetCheckpointUnderLease(candidate.runId, lease, resetPlanningThread),
      resetCheckpointUnderLease(candidate.runId, lease, resetExecutionThread)
    ]);
    const resetFailures = resetResults.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ checkpoint: index === 0 ? "planning" : "execution", cause: result.reason }]
        : []
    );
    if (resetFailures.length > 0) {
      const details = resetFailures
        .map(({ checkpoint, cause }) => `${checkpoint}: ${errorMessage(cause)}`)
        .join("; ");
      const message =
        `No se pudo preparar el reinicio de planning (${details}). ` +
        "El run sigue siendo reiniciable; corregí el acceso al checkpoint y reintentá.";
      await failFreshPlanningPreparation(candidate.runId, lease, message);
      throw new Error(message, { cause: resetFailures[0]?.cause });
    }

    // Stop renewals before the status CAS/event pair; otherwise a heartbeat
    // could advance the version between the record write and event rollback.
    stopHeartbeat();
    stopHeartbeat = undefined;
    const authorityAfterReset = await assertRunOperationCurrent(candidate.runId, lease);
    const now = new Date().toISOString();
    const transitioned = await mutateRunWithLease(
      candidate.runId,
      lease,
      { status: ["interrupted", "failed", "failed_artifact"] },
      (current) => {
        assertTransition(current.status, "generating");
        const effectiveSelection =
          current.defaultExecutionSelection ??
          (current.planningExecutorId !== undefined
            ? { executorId: current.planningExecutorId, model: current.planningModel ?? current.model }
            : undefined);
        const next: RunRecord = {
          // Retain the preparation lease through the required status event so
          // event failure can roll back under the same fence.
          ...current,
          status: "generating",
          interruptedDuring: undefined,
          errorMessage: undefined,
          failedDuring: undefined,
          executionConfig: withDefaultReasoningEffort(current.executionConfig, effectiveSelection),
          planRevision: (current.planRevision ?? 1) + 1,
          patches: [],
          startedAt: current.startedAt ?? now
        };
        clearForFreshPlanning(next);
        return next;
      }
    );

    try {
      await appendStatusEventOrRollback(authorityAfterReset, transitioned, { actor: "human", lease });
    } catch (error) {
      await failFreshPlanningPreparation(
        candidate.runId,
        lease,
        `El reinicio limpió los checkpoints pero no pudo registrar la transición: ${errorMessage(error)}`
      ).catch(() => undefined);
      throw error;
    }

    const released = await releaseRunOperation(candidate.runId, lease);
    if (released.activeOperation !== undefined) {
      throw new Error(
        `Restart preparation lease ${lease.operationId} could not be released; ` +
        `${released.activeOperation.operationId} still owns the run.`
      );
    }
    // Release is itself a locked read-modify-write, but a pause/cancel may win
    // immediately after it. Re-read terminal truth before dispatch; the
    // pipeline claim remains the final guard if an action wins after this read.
    const handoff = await getRunRepository().get(released.runId);
    if (handoff.status === "generating" && handoff.activeOperation === undefined) {
      startRunBackgroundTask(handoff.runId, "route:restart:planning", () => runPlanningPipeline(handoff.runId));
    }
    return NextResponse.json(await toCanonicalRunResponse(handoff));
  } finally {
    stopHeartbeat?.();
    await releaseRunOperation(candidate.runId, lease).catch(() => undefined);
  }
}

async function resetCheckpointUnderLease(
  runId: string,
  lease: RunOperationLease,
  reset: (runId: string) => Promise<void>
): Promise<void> {
  await assertRunOperationCurrent(runId, lease);
  await reset(runId);
  await assertRunOperationCurrent(runId, lease);
}

async function failFreshPlanningPreparation(
  runId: string,
  lease: RunOperationLease,
  message: string
): Promise<RunRecord> {
  return mutateRunWithLease(
    runId,
    lease,
    { status: ["interrupted", "failed", "failed_artifact"] },
    (current) => ({
      ...invalidateRunOperation(current),
      errorMessage: message
    })
  );
}

function restartStartsFreshPlanning(run: RunRecord): boolean {
  const restoresPendingReplanQuestion =
    run.status === "interrupted" &&
    run.pendingQuestion !== undefined &&
    run.pendingReplan !== undefined;
  if (restoresPendingReplanQuestion) return false;

  const resumesPendingReplan =
    (run.status === "interrupted" || run.status === "failed") &&
    run.pendingQuestion === undefined &&
    run.pendingReplan?.resumeRequestedAt !== undefined;
  return !resumesPendingReplan && !restartResumesExecution(run);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clearForFreshPlanning(next: RunRecord): void {
  delete next.pausedDuring;
  delete next.pendingDecision;
  delete next.pendingQuestion;
  delete next.pendingReplan;
  delete next.planning;
  delete next.planGraphStorage;
  delete next.decomposition;
  delete next.livePlanningNodes;
  delete next.planningCritic;
  delete next.seamCritic;
  delete next.questionAnswers;
  delete next.planningStepCache;
  delete next.repositoryGrounding;
  delete next.approvedAt;
  delete next.approvedPlanRevision;
  delete next.planApprovalOverride;
  delete next.execution;
  delete next.executionTraces;
  delete next.nodeReviews;
  delete next.validation;
  delete next.completedAt;
  delete next.finalPatch;
  delete next.finalApplicationStatus;
  delete next.finalBranchName;
  delete next.finalCommitSha;
  delete next.appliedToRepoPath;
  delete next.appliedAt;
  delete next.exportedPatchPath;
  delete next.finalApplicationMessage;
  delete next.finalArtifactManifest;
  delete next.executionOutcome;
  delete next.artifactOutcome;
  delete next.deliveryOutcome;
  delete next.baseCommit;
  delete next.integrationCommitSha;
}
