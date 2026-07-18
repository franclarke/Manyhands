import { NextResponse } from "next/server";

import { RunLifecycleError, RunValidationError, getRunRepository } from "@/lib/server/runs";
import { toCanonicalRunResponse } from "@/lib/server/runs/presenter";
import { runErrorResponse } from "@/lib/server/runs/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    return NextResponse.json(await toCanonicalRunResponse(await getRunRepository().get((await context.params).id)));
  } catch (error) {
    return runErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const payload = await request.json() as { title?: unknown };
    if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
      throw new RunValidationError("A non-empty title is required.");
    }
    const title = payload.title.trim().slice(0, 120);
    const run = await getRunRepository().update(id, (current) => ({ ...current, title }));
    return NextResponse.json(await toCanonicalRunResponse(run));
  } catch (error) {
    return runErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    await getRunRepository().update(id, (current) => {
      if (["planning", "running", "waiting_for_input", "cancelling", "delivering"].includes(current.projection.lifecycle)) {
        throw new RunLifecycleError(`Run ${id} must be paused, interrupted, or terminal before it can be archived.`);
      }
      const now = new Date().toISOString();
      return { ...current, archivedAt: now, updatedAt: now };
    });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return runErrorResponse(error);
  }
}
