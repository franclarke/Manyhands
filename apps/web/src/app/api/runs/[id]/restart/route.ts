import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  canRestart,
  getRunRepository,
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
    // Decide which pipeline to kick based on how the run was interrupted.
    // Planning is the default; execution restart is reserved for runs that had
    // already been approved before crashing.
    const shouldResumeExecution = run.interruptedDuring === "running" && run.planning !== undefined;
    if (shouldResumeExecution) {
      // The execution pipeline transitions "approved" → "running"; we need
      // "interrupted" → "running" instead. Persist approved metadata if missing
      // and bridge through the lifecycle step.
      const approved = await repo.save({
        ...run,
        status: "approved",
        ...(run.approvedAt === undefined ? { approvedAt: new Date().toISOString() } : {})
      });
      void runExecutionPipeline(approved.runId).catch(() => undefined);
      return NextResponse.json(toRunResponse(await repo.get(id)));
    }
    void runPlanningPipeline(run.runId).catch(() => undefined);
    return NextResponse.json(toRunResponse(run));
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
