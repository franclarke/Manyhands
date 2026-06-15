import { NextResponse } from "next/server";
import {
  claimRunMutation,
  getRunRepository,
  resetPlanningThread,
  restartResumesExecution,
  runExecutionPipeline,
  runPlanningPipeline
} from "@/lib/server/runs";
import { runErrorResponse } from "@/lib/server/runs/route-errors";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    // Claim the restart atomically (INV-4): only `interrupted`/`failed` runs are
    // restartable, an in-process runner blocks the claim, and the mutator moves
    // the run OUT of a restartable status — so a concurrent second restart gets
    // a deterministic 409 instead of kicking a duplicate pipeline.
    let resumesExecution = false;
    const claimed = await claimRunMutation(
      id,
      { status: ["interrupted", "failed"], rejectActiveRunner: true },
      (current) => {
        resumesExecution = restartResumesExecution(current);
        const now = new Date().toISOString();
        if (resumesExecution) {
          // The execution pipeline transitions "approved" → "running". Persist
          // approved metadata if missing and bridge through the lifecycle step.
          return {
            ...current,
            status: "approved" as const,
            errorMessage: undefined,
            failedDuring: undefined,
            approvedAt: current.approvedAt ?? now
          };
        }
        // Restart planning from the top. Jump straight to "generating" (the
        // pipeline's own transition target) so the run leaves the restartable
        // statuses within the claim itself.
        return {
          ...current,
          status: "generating" as const,
          interruptedDuring: undefined,
          errorMessage: undefined,
          failedDuring: undefined,
          startedAt: current.startedAt ?? now
        };
      }
    );

    if (resumesExecution) {
      void runExecutionPipeline(claimed.runId).catch(() => undefined);
      return NextResponse.json(toRunResponse(await getRunRepository().get(id)));
    }

    // Restart plans from scratch: drop the suspended planning thread so the
    // graph re-enters at START instead of resuming a stale gate.
    await resetPlanningThread(claimed.runId);
    void runPlanningPipeline(claimed.runId).catch(() => undefined);
    return NextResponse.json(toRunResponse(claimed));
  } catch (error) {
    return runErrorResponse(error);
  }
}
