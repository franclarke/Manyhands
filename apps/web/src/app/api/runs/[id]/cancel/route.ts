import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  abortRun,
  assertTransition,
  getRunRepository
} from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const CANCELLABLE = new Set(["generating", "running", "paused"]);

/**
 * Stops an in-flight run. The transition to `interrupted` is observed
 * cooperatively by the runner, which respects it instead of flipping to
 * completed/failed when the current engine step returns. (In-flight subprocesses
 * finish their current node; full process-kill is a follow-up.)
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const repo = getRunRepository();
    const run = await repo.get(id);
    if (!CANCELLABLE.has(run.status)) {
      throw new RunLifecycleError(`Cannot cancel from status ${run.status}`);
    }
    assertTransition(run.status, "interrupted");
    const interruptedDuring: "generating" | "running" =
      run.status === "running" || run.pausedDuring === "running" ? "running" : "generating";
    const now = new Date().toISOString();
    const saved = await repo.save({
      ...run,
      status: "interrupted",
      interruptedDuring,
      pausedDuring: undefined,
      errorMessage: "interrupted: cancelled by user"
    });
    // Real cancel: abort the in-flight executor subprocess, not just the label.
    abortRun(saved.runId);
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
