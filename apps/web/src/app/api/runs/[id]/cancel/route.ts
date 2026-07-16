import { NextResponse } from "next/server";
import { cancelRun } from "@/lib/server/runs/cancel-service";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Stops an in-flight run for real (INV-2/B-005): claims the `cancelling`
 * transition, invalidates the operation lease, fires the cooperative
 * AbortSignal, then FORCE-KILLS every registered subprocess of the run and
 * waits until each tree is verified dead. Only a clean kill report reaches
 * the resumable `interrupted` state; any survivor leaves the run in
 * `cancelling` (the response says so) and a retried cancel finishes the job.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const outcome = await cancelRun(id);
    return NextResponse.json(
      {
        ...(await toCanonicalRunResponse(outcome.run)),
        cancellation: {
          processesKilled: outcome.killReport.verifications.length,
          allProcessesDead: outcome.killReport.allDead,
          survivors: outcome.killReport.verifications
            .filter((v) => v.outcome === "survived" || v.outcome === "unverified")
            .map((v) => ({ pid: v.pid, label: v.label ?? "unknown" })),
          worktreesCleaned: outcome.cleaned.removed.length,
          worktreeGcFailures: outcome.cleaned.failed.length,
          terminal: outcome.terminal
        }
      },
      // 202: the cancel was accepted but is not terminal yet (survivors).
      { status: outcome.terminal ? 200 : 202 }
    );
  } catch (error) {
    return runErrorResponse(error);
  }
}
