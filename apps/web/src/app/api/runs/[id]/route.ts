import { NextResponse } from "next/server";
import {
  RunLifecycleError,
  RunNotFoundError,
  RunValidationError,
  getRunRepository,
  sweepRunIfStale
} from "@/lib/server/runs";
import { toRunResponse } from "@/lib/server/runs/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const run = await getRunRepository().get(id);
    const swept = await sweepRunIfStale(run);
    return NextResponse.json(toRunResponse(swept));
  } catch (error) {
    return errorResponse(error);
  }
}

const MAX_TITLE_LENGTH = 120;

/** Rename a run (history editing). Only the user-facing `title` is mutable. */
export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  try {
    const title = (payload as { title?: unknown })?.title;
    if (typeof title !== "string" || title.trim().length === 0) {
      throw new RunValidationError("A non-empty title is required.");
    }
    const nextTitle = title.trim().slice(0, MAX_TITLE_LENGTH);
    const updated = await getRunRepository().update(id, (current) => ({ ...current, title: nextTitle }));
    return NextResponse.json(toRunResponse(updated));
  } catch (error) {
    return errorResponse(error);
  }
}

/** Delete a run from history. The target repo and its branches are untouched. */
export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await getRunRepository().delete(id);
    return new NextResponse(null, { status: 204 });
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
