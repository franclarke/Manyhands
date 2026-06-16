import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTransition,
  getRunRepository,
  runExecutionPipeline
} from "@/lib/server/runs";
import { appendRunStatusChanged } from "@/lib/server/runs/run-status-events";
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
    assertTransition(run.status, "running");
    const saved = await repo.save({
      ...run,
      status: "running",
      startedAt: run.startedAt ?? new Date().toISOString()
    });
    await appendRunStatusChanged(saved);
    void runExecutionPipeline(saved.runId).catch(() => undefined);
    return NextResponse.json(toRunResponse(saved));
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
