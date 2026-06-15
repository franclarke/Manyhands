import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertManualNodeExecutionReady,
  getRunRepository,
  runNodeExecutionPipeline
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; taskId: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, taskId } = await context.params;
  try {
    const repo = getRunRepository();
    const run = await repo.get(id);
    await assertManualNodeExecutionReady(run, taskId);

    void runNodeExecutionPipeline(run.runId, taskId).catch(() => undefined);
    return NextResponse.json(toRunResponse(await repo.get(id)));
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
