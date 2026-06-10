import { NextResponse } from "next/server";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  getRunRepository,
  parseRunPatches
} from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const run = await getRunRepository().get(id);
    const summary = buildPlanReviewSummary(projectRunRecordToSnapshot(run), parseRunPatches(run.patches));
    return NextResponse.json({ planReview: summary });
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
