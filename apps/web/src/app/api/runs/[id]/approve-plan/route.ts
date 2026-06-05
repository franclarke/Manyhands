import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  assertTransition,
  getRunRepository,
  parseRunPatches
} from "@/lib/server/runs";
import { publishRunEvent } from "@/lib/server/runs/event-bus";
import { toRunResponse } from "@/lib/server/runs/presenter";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const acknowledge = await readAcknowledge(request);

  try {
    const repo = getRunRepository();
    const run = await repo.get(id);

    // Quality gate (Fase B): block approval on reliable critic errors — graph
    // validation errors + orphan consumed seams — unless the user explicitly
    // acknowledged them in the plan review gate. Recomputed from the snapshot so
    // it matches what the modal shows (and reflects post-planning edits).
    if (!acknowledge) {
      const summary = buildPlanReviewSummary(projectRunRecordToSnapshot(run), parseRunPatches(run.patches));
      if (summary !== null && summary.issueCounts.errors > 0) {
        const detail = summary.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.title)
          .join(", ");
        throw new RunLifecycleError(
          `Plan has ${summary.issueCounts.errors} blocking error(s): ${detail}. ` +
            "Resolve them, or approve explicitly from the plan review gate."
        );
      }
    }

    assertTransition(run.status, "approved");
    const now = new Date().toISOString();
    const saved = await repo.save({ ...run, status: "approved", approvedAt: now });
    publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: now });
    return NextResponse.json(toRunResponse(saved));
  } catch (error) {
    return errorResponse(error);
  }
}

async function readAcknowledge(request: Request): Promise<boolean> {
  try {
    const body = (await request.json()) as { acknowledgeCriticErrors?: unknown };
    return body.acknowledgeCriticErrors === true;
  } catch {
    return false;
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
