import { NextResponse } from "next/server";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  getWorkspaceRepository
} from "@/lib/server/workspaces";
import { normalizeRepoPath } from "@/lib/server/workspaces/repo-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    const workspace = await getWorkspaceRepository().get(id);
    return NextResponse.json({ workspace });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  try {
    const workspace = await getWorkspaceRepository().update(id, await normalizeWorkspacePayload(payload));
    return NextResponse.json({ workspace });
  } catch (error) {
    return errorResponse(error);
  }
}

async function normalizeWorkspacePayload(payload: unknown): Promise<unknown> {
  if (typeof payload !== "object" || payload === null || !("repoPath" in payload)) {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (typeof record.repoPath !== "string" || record.repoPath.trim().length === 0) {
    return payload;
  }
  return { ...record, repoPath: await normalizeRepoPath(record.repoPath) };
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  try {
    await getWorkspaceRepository().delete(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof WorkspaceValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (error instanceof WorkspaceConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 500 }
  );
}
