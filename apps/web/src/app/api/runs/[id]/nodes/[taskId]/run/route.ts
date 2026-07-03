import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertRunActionAllowed,
  assertManualNodeExecutionReady,
  getRunRepository,
  markRunnerInactive,
  runNodeExecutionPipeline
} from "@/lib/server/runs";
import { startRunBackgroundTask, tryMarkRunnerActive } from "@/lib/server/runs/runner-state";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, taskId } = await context.params;
  let runnerClaimed = false;
  try {
    const repo = getRunRepository();
    const run = await repo.get(id);
    assertRunActionAllowed(run, "manual_node_run");
    if (!tryMarkRunnerActive(run.runId)) {
      throw new RunLifecycleError(`Run ${run.runId} is being driven by an active runner.`);
    }
    runnerClaimed = true;
    await assertManualNodeExecutionReady(run, taskId);

    startRunBackgroundTask(run.runId, "route:node-run:execution", () =>
      runNodeExecutionPipeline(run.runId, taskId, { runnerAlreadyClaimed: true })
    );
    runnerClaimed = false;
    return NextResponse.json(toRunResponse(await repo.get(id)));
  } catch (error) {
    if (runnerClaimed) {
      markRunnerInactive(id);
    }
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
