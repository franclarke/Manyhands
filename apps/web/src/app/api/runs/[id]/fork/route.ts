/**
 * POST /api/runs/[id]/fork — non-destructive time-travel rollback.
 *
 * When the user rolls back to a previous checkpoint from the canvas/timeline,
 * this endpoint:
 *   1. Reads the checkpoint history for the source run.
 *   2. Clones the state up to the specified checkpoint_id.
 *   3. Creates a new RunRecord with a fresh runId (preserves the original).
 *   4. Returns the new run ID so the frontend can navigate to it.
 *
 * Design: docs/design/langgraph-orchestrator-design.md §6 (Forking)
 * Invariant: Worktrees for the new run will be named mh-{newRunId}-{nodeId}.
 */
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  allowedStatusesForAction,
  assertRunActionAllowed,
  getRunRepository,
  persistForkAtomically
} from "@/lib/server/runs";
import {
  assertRunOperationCurrent,
  claimRunOperation,
  releaseRunOperation
} from "@/lib/server/runs/run-operation-lease";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { JsonFileCheckpointSaver } from "@manyhands/orchestrator-graph";
import { resolveRunsDirectory } from "@/lib/server/runs/repository";
import { join } from "node:path";
import type { RunRecord, RunTargetContext } from "@/lib/server/runs/schema";
import {
  RunTargetMismatchError,
  assertRunHasVerifiableLocalTarget,
  resolveRunTargetPath
} from "@/lib/server/runs/target-context";
import { isRunnerActive } from "@/lib/server/runs/runner-state";
import { startHeartbeat } from "@/lib/server/runs/runner-heartbeat";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError
} from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const ForkRequestSchema = z.object({
  /**
   * The checkpoint ID to fork from. If omitted, forks from "latest". Restricted
   * to a safe identifier charset (UUID-shaped): it is interpolated into a file
   * path (`<checkpoint_id>.json`) and `path.join`'d, so allowing `.`/`/`/`\`
   * enables path traversal into other threads' checkpoints — an authz bypass
   * (F-025).
   */
  checkpointId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/, "checkpointId must be a safe identifier")
    .optional()
});

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id: sourceRunId } = await context.params;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    body = {};
  }

  const parsed = ForkRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid fork request" }, { status: 400 });
  }

  try {
    // Claim the source itself, not just a process-local runner flag. This CAS
    // closes the window where restart/resume could acquire durable authority
    // after this route read the source but before it cloned the checkpoint.
    const candidate = await getRunRepository().get(sourceRunId);
    assertRunActionAllowed(candidate, "fork");
    const { run: sourceRun, lease } = await claimRunOperation(sourceRunId, "fork", {
      expectedStatuses: allowedStatusesForAction("fork"),
      expectedVersion: candidate.version
    });
    const stopHeartbeat = startHeartbeat(sourceRunId, lease);
    let heartbeatStopped = false;
    let leaseReleased = false;
    const stopForkHeartbeat = (): void => {
      if (heartbeatStopped) return;
      heartbeatStopped = true;
      stopHeartbeat();
    };
    try {
      assertRunHasVerifiableLocalTarget(sourceRun);
      if (isRunnerActive(sourceRun.runId)) {
        throw new RunLifecycleError(`Run ${sourceRun.runId} is being driven by an active runner.`);
      }

      // Revalidate the immutable physical repository identity at the fork
      // decision boundary. A canonical path is not a repository identity.
      await assertRunOperationCurrent(sourceRunId, lease);
      await resolveRunTargetPath(sourceRun);
      await assertRunOperationCurrent(sourceRunId, lease);

      // Read the checkpoint to restore from while restart/resume remain
      // excluded by the durable fork lease.
      const runsDirectory = resolveRunsDirectory();
      const checkpointsDirectory = join(runsDirectory, "checkpoints");
      const checkpointer = new JsonFileCheckpointSaver(checkpointsDirectory);

      const checkpointConfig = {
        configurable: {
          thread_id: sourceRunId,
          ...(parsed.data.checkpointId !== undefined
            ? { checkpoint_id: parsed.data.checkpointId }
            : {})
        }
      };

      const sourceTuple = await checkpointer.getTuple(checkpointConfig);
      await assertRunOperationCurrent(sourceRunId, lease);

      const newRunId = randomUUID();
      const now = new Date().toISOString();

      const forkedRun: RunRecord = {
        runId: newRunId,
        workspaceId: sourceRun.workspaceId,
        granularity: sourceRun.granularity,
        model: sourceRun.model,
        userPrompt: sourceRun.userPrompt,
        title: `[Fork] ${sourceRun.title}`,
        version: 0,
        planRevision: 1,
        status: "created",
        createdAt: now,
        updatedAt: now,
        patches: [],
        ...(sourceRun.planningModel !== undefined ? { planningModel: sourceRun.planningModel } : {}),
        ...(sourceRun.planningExecutorId !== undefined
          ? { planningExecutorId: sourceRun.planningExecutorId }
          : {}),
        ...(sourceRun.defaultExecutionSelection !== undefined
          ? { defaultExecutionSelection: sourceRun.defaultExecutionSelection }
          : {}),
        ...(sourceRun.defaultRepairSelection !== undefined
          ? { defaultRepairSelection: sourceRun.defaultRepairSelection }
          : {}),
        // U2A-2: carry the canonical per-stage selections across the fork.
        ...(sourceRun.planningSelection !== undefined ? { planningSelection: sourceRun.planningSelection } : {}),
        ...(sourceRun.executionSelection !== undefined ? { executionSelection: sourceRun.executionSelection } : {}),
        ...(sourceRun.repairSelection !== undefined ? { repairSelection: sourceRun.repairSelection } : {}),
        executionConfig: { ...(sourceRun.executionConfig ?? {}), routing: "fixed" },
        ...(sourceRun.repoSpec !== undefined ? { repoSpec: sourceRun.repoSpec } : {}),
        ...(sourceRun.targetContext !== undefined
          ? { targetContext: sourceTargetContextForFork(sourceRun.targetContext) }
          : {})
      };

      const savedRun = await persistForkAtomically({
        sourceWorkspaceId: sourceRun.workspaceId,
        forkedRun,
        ...(sourceTuple !== undefined
          ? {
              cloneCheckpoint: async (): Promise<void> => {
                await assertRunOperationCurrent(sourceRunId, lease);
                const metadata = sourceTuple.metadata ?? {
                  source: "fork" as const,
                  step: -1,
                  parents: {}
                };
                await checkpointer.put(
                  { configurable: { thread_id: newRunId } },
                  sourceTuple.checkpoint,
                  metadata,
                  {}
                );
                await assertRunOperationCurrent(sourceRunId, lease);
              },
              cleanupCheckpoint: async (): Promise<void> => checkpointer.deleteThread(newRunId)
            }
          : {}),
        validateAfterSave: async (): Promise<void> => {
          await assertRunOperationCurrent(sourceRunId, lease);
          stopForkHeartbeat();
          let released: RunRecord;
          try {
            released = await releaseRunOperation(sourceRunId, lease);
          } catch (error) {
            throw new Error(
              `Fork ${newRunId} could not release its durable source lease; ` +
                "the child publication was rolled back and the fork can be retried.",
              { cause: error }
            );
          }
          if (
            released.mutationFence !== lease.fencingToken ||
            released.activeOperation !== undefined
          ) {
            throw new RunLifecycleError(
              `Fork ${newRunId} lost durable source authority before publication committed; ` +
                "the child publication was rolled back."
            );
          }
          leaseReleased = true;
        }
      });

      if (!leaseReleased) {
        throw new Error(`Fork ${newRunId} did not durably release its source lease.`);
      }

      return NextResponse.json({
        newRunId: savedRun.runId,
        sourceRunId,
        forkedFromCheckpointId: parsed.data.checkpointId ?? "latest",
        run: {
          runId: savedRun.runId,
          status: savedRun.status,
          title: savedRun.title,
          createdAt: savedRun.createdAt
        }
      }, { status: 201 });
    } catch (operationError) {
      stopForkHeartbeat();
      if (!leaseReleased) {
        try {
          const released = await releaseRunOperation(sourceRunId, lease);
          leaseReleased =
            released.mutationFence === lease.fencingToken &&
            released.activeOperation === undefined;
        } catch (releaseError) {
          throw new AggregateError(
            [operationError, releaseError],
            `Fork of run ${sourceRunId} failed and its durable source lease could not be released. ` +
              "No child was published; retry after storage access is restored."
          );
        }
      }
      throw operationError;
    } finally {
      stopForkHeartbeat();
      if (!leaseReleased) {
        await releaseRunOperation(sourceRunId, lease).catch((releaseError) => {
          console.error(
            `[Fork] Safety release failed for ${sourceRunId} ` +
              `${lease.operationId}/${lease.fencingToken}: ${String(releaseError)}`
          );
        });
      }
    }
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return NextResponse.json(
        {
          error:
            `Cannot fork run ${sourceRunId}: its workspace no longer exists. ` +
            "Restore the workspace before forking this run."
        },
        { status: 409 }
      );
    }
    if (error instanceof WorkspaceConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof RunNotFoundError || error instanceof RunValidationError || error instanceof RunLifecycleError) {
      return runErrorResponse(error);
    }
    if (error instanceof RunTargetMismatchError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/** A fork inherits source identity, never the source run's execution allocation. */
function sourceTargetContextForFork(context: RunTargetContext): RunTargetContext {
  return {
    sourceRealPath: context.sourceRealPath,
    gitCommonDir: context.gitCommonDir,
    ...(context.physicalIdentity !== undefined
      ? { physicalIdentity: { ...context.physicalIdentity } }
      : {}),
    sourceBranch: context.sourceBranch,
    sourceBaseCommit: context.sourceBaseCommit,
    ...(context.remoteUrl !== undefined ? { remoteUrl: context.remoteUrl } : {}),
    fingerprint: context.fingerprint,
    capturedAt: context.capturedAt
  };
}
