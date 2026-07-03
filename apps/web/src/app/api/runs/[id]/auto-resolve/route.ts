import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  buildPatch,
  loadEditableRunContext,
  persistRunPatches
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { deriveConflictList } from "@/lib/conflict-view-model";
import { planConflictResolution } from "@/lib/conflict-resolution";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Plan-time auto-resolve (Pieza 1). Acknowledges every actionable, not-yet-handled
 * conflict in one shot so the user can go approve → auto-resolve → run with no
 * manual triage. The acknowledgements are advisory (they do not mutate the DAG),
 * so approval is preserved; the conflict-aware composer (D8) does the real merge.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const { run, baseSnapshot, currentSnapshot } = await loadEditableRunContext(id);
    const conflicts = deriveConflictList(currentSnapshot, run.patches ?? []);
    const { acknowledgements } = planConflictResolution(conflicts);

    if (acknowledgements.length === 0) {
      return NextResponse.json({ ...toRunResponse(run), resolvedCount: 0 });
    }

    const patches = acknowledgements.map((ack) =>
      buildPatch("RISK_ACKNOWLEDGED", { taskIds: ack.taskIds, reason: ack.reason }, { actor: "system" })
    );
    const saved = await persistRunPatches({ run, baseSnapshot, patches });
    return NextResponse.json({ ...toRunResponse(saved), resolvedCount: patches.length });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof RunValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof RunLifecycleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
