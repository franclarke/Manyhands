import { NextResponse } from "next/server";
import { SimpleGitRunner, WorktreeManager, killOwnedProcessTrees } from "@manyhands/execution-core";
import {
  abortRun,
  assertTransition,
  claimRunMutation,
  getRunRepository
} from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { appendRunModelEvent } from "@/lib/server/runs/run-model-event-log";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";
import type { RunRecord } from "@/lib/server/runs/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CANCELLABLE: ReadonlyArray<RunRecord["status"]> = ["generating", "running", "paused"];

/**
 * Stops an in-flight run for real (INV-2): claims the `interrupted` transition,
 * fires the cooperative AbortSignal, then FORCE-KILLS every registered
 * subprocess of the run and waits until each tree is verified dead before
 * cleaning the run's worktrees and responding. After the 200, no process of
 * this run can keep writing. The run stays resumable via restart.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const now = new Date().toISOString();
    const saved = await claimRunMutation(id, { status: CANCELLABLE }, (current) => {
      assertTransition(current.status, "interrupted");
      const interruptedDuring: "generating" | "running" =
        current.status === "running" || current.pausedDuring === "running" ? "running" : "generating";
      return {
        ...current,
        status: "interrupted" as const,
        interruptedDuring,
        pausedDuring: undefined,
        errorMessage: "interrupted: cancelled by user"
      };
    });

    // 1) Cooperative abort: the drive loop cuts the stream between supersteps
    //    and in-flight executors receive the signal.
    abortRun(saved.runId);

    // 2) Hard kill + verification: whatever is still registered for this run
    //    dies now, and we do not respond until each tree is verified dead.
    const killReport = await killOwnedProcessTrees(saved.runId);

    // 3) Worktree GC: by directory convention, best-effort per entry. Only
    //    meaningful when the run got far enough to have a provisioned repo.
    let cleaned: { removed: string[]; failed: string[] } = { removed: [], failed: [] };
    if (saved.provisioned !== undefined) {
      const manager = new WorktreeManager({
        git: new SimpleGitRunner(),
        repoRoot: saved.provisioned.repoRoot
      });
      cleaned = await manager.gcRun(saved.runId);
    }

    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: now });
    // Awaited (not fire-and-forget): the cancellation audit must be durable
    // before the 200 lands (INV-6).
    await appendRunModelEvent(saved.runId, {
      actor: "human",
      at: now,
      type: "run.cancelled",
      payload: {
        killedProcesses: killReport.verifications.length,
        escalatedKills: killReport.verifications.filter((v) => v.outcome === "escalated").length,
        survivors: killReport.verifications.filter((v) => v.outcome === "survived").map((v) => v.pid),
        cleanedWorktrees: cleaned.removed,
        gcFailures: cleaned.failed
      }
    });

    return NextResponse.json({
      ...toRunResponse(saved),
      cancellation: {
        processesKilled: killReport.verifications.length,
        allProcessesDead: killReport.allDead,
        worktreesCleaned: cleaned.removed.length,
        worktreeGcFailures: cleaned.failed.length
      }
    });
  } catch (error) {
    return runErrorResponse(error);
  }
}
