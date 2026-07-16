import { NextResponse } from "next/server";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { buildPlanControlPlane, type PlanControlNodeReview } from "@/lib/plan-control";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  getRunRepository,
  parseRunPatches
} from "@/lib/server/runs";
import { effectiveExecutionConfig } from "@/lib/server/runs/effective-execution-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const run = await getRunRepository().get(id);
    const snapshot = projectRunRecordToSnapshot(run);
    const summary = buildPlanReviewSummary(snapshot, parseRunPatches(run.patches));
    const controlPlane = buildPlanControlPlane(snapshot, {
      version: run.version,
      status: run.status,
      routing: effectiveExecutionConfig(run.executionConfig).routing,
      ...(run.nodeReviews !== undefined
        ? { nodeReviews: run.nodeReviews as Record<string, PlanControlNodeReview> }
        : {})
    });
    return NextResponse.json({ planReview: summary, controlPlane });
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
