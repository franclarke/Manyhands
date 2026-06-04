import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  canRestart,
  getRunRepository,
  restartResumesExecution,
  runExecutionPipeline,
  runPlanningPipeline
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const repo = getRunRepository();
    const run = await repo.get(id);
    if (!canRestart(run.status)) {
      throw new RunLifecycleError(`Cannot restart from status ${run.status}`);
    }
    // Decide which pipeline to kick from the run's recorded phase. A run that was
    // already approved (and has a plan) resumes EXECUTION; otherwise we restart
    // PLANNING. Both branches reset to a status the target pipeline can transition
    // from and clear the stale failure so the next attempt starts clean.
    if (restartResumesExecution(run)) {
      // The execution pipeline transitions "approved" → "running". Persist approved
      // metadata if missing and bridge through the lifecycle step.
      const approved = await repo.save({
        ...run,
        status: "approved",
        errorMessage: undefined,
        failedDuring: undefined,
        ...(run.approvedAt === undefined ? { approvedAt: new Date().toISOString() } : {})
      });
      void runExecutionPipeline(approved.runId).catch(() => undefined);
      return NextResponse.json(toRunResponse(await repo.get(id)));
    }
    // The planning pipeline only transitions "created"/"interrupted" → "generating",
    // so a run that *failed* during planning must be reset to "interrupted" first —
    // otherwise it stays "failed" and the final transition to "needs_review" throws.
    const reset = await repo.save({
      ...run,
      status: "interrupted",
      interruptedDuring: "generating",
      errorMessage: undefined,
      failedDuring: undefined
    });
    void runPlanningPipeline(reset.runId).catch(() => undefined);
    return NextResponse.json(toRunResponse(reset));
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof RunValidationError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof RunLifecycleError) return NextResponse.json({ error: error.message }, { status: 409 });
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
