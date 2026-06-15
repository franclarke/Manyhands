import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTransition,
  canPause,
  getRunRepository
} from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
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
    if (!canPause(run.status)) {
      throw new RunLifecycleError(`Cannot pause from status ${run.status}`);
    }
    const pausedDuring = run.status === "generating" ? "generating" : "running";
    assertTransition(run.status, "paused");
    const now = new Date().toISOString();
    const saved = await repo.save({ ...run, status: "paused", pausedDuring });
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: now });
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
