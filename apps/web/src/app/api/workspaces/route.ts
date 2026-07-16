import { NextResponse } from "next/server";
import {
  WorkspaceConflictError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  getWorkspaceRepository
} from "@/lib/server/workspaces";
import { ensureRunnableRepo } from "@/lib/server/workspaces/ensure-runnable-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await getWorkspaceRepository().snapshot();
    return NextResponse.json(snapshot);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON" }, { status: 400 });
  }
  try {
    const workspace = await getWorkspaceRepository().create(await normalizeWorkspacePayload(payload));
    return NextResponse.json({ workspace }, { status: 201 });
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
  const repo = await ensureRunnableRepo(record.repoPath);
  return { ...record, repoPath: repo.repoRoot, defaultBranch: repo.branch };
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
