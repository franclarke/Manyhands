import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import {
  MAX_WORKSPACE_FILE_BYTES,
  RunNotFoundError,
  WorkspaceEscapeError,
  getRunRepository,
  parseWorkspaceContext,
  resolveContainedWorkspaceFile,
  readFinalArtifactFile,
  resolveRunWorkspaceContext,
  safeWorkspaceRelativePath
} from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const url = new URL(request.url);
  try {
    const run = await getRunRepository().get(id);
    const workspace = await resolveRunWorkspaceContext(run, {
      context: parseWorkspaceContext(url.searchParams.get("context")),
      nodeId: url.searchParams.get("nodeId") ?? undefined
    });
    const relativePath = safeWorkspaceRelativePath(url.searchParams.get("path"));
    if (relativePath.length === 0) {
      return NextResponse.json({ error: "A file path is required." }, { status: 400 });
    }
    if (!workspace.exists) {
      return NextResponse.json({ error: "Workspace context does not exist.", workspace }, { status: 404 });
    }
    if (workspace.context === "final") {
      const content = await readFinalArtifactFile(run, relativePath);
      if (Buffer.byteLength(content, "utf8") > MAX_WORKSPACE_FILE_BYTES) {
        return NextResponse.json({ error: "File is too large to preview." }, { status: 413 });
      }
      return NextResponse.json({ workspace, path: relativePath, size: Buffer.byteLength(content, "utf8"), content });
    }
    // B-006 (CF-40): realpath containment — a symlink/junction inside the
    // workspace must not read outside it.
    const target = await resolveContainedWorkspaceFile(workspace.rootPath, relativePath);
    const fileStat = await stat(target);
    if (!fileStat.isFile()) {
      return NextResponse.json({ error: "Path is not a file." }, { status: 400 });
    }
    if (fileStat.size > MAX_WORKSPACE_FILE_BYTES) {
      return NextResponse.json(
        { error: `File is too large to preview (${fileStat.size} bytes).` },
        { status: 413 }
      );
    }
    const content = await readFile(target, "utf8");
    return NextResponse.json({ workspace, path: relativePath, size: fileStat.size, content });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

function workspaceErrorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof WorkspaceEscapeError) return NextResponse.json({ error: error.message }, { status: 403 });
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
}
