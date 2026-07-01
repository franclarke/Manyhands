import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  RunNotFoundError,
  getRunRepository,
  parseWorkspaceContext,
  resolveRunWorkspaceContext,
  resolveWorkspacePath,
  safeWorkspaceRelativePath
} from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface WorkspaceTreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size?: number;
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
    if (!workspace.exists) {
      return NextResponse.json({ workspace, path: relativePath, entries: [] });
    }
    const target = resolveWorkspacePath(workspace.rootPath, relativePath);
    const targetStat = await stat(target);
    if (!targetStat.isDirectory()) {
      return NextResponse.json({ error: "Path is not a directory." }, { status: 400 });
    }
    const entries = await readEntries(target, relativePath);
    return NextResponse.json({ workspace, path: relativePath, entries });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

async function readEntries(target: string, relativePath: string): Promise<WorkspaceTreeEntry[]> {
  const entries = await readdir(target, { withFileTypes: true });
  const out: WorkspaceTreeEntry[] = [];
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".next" || entry.name === "dist") continue;
    const childRelative = relativePath.length > 0 ? `${relativePath}/${entry.name}` : entry.name;
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const childStat = entry.isFile() ? await stat(path.join(target, entry.name)).catch(() => null) : null;
    out.push({
      name: entry.name,
      path: childRelative,
      kind: entry.isDirectory() ? "directory" : "file",
      ...(childStat !== null ? { size: childStat.size } : {})
    });
  }
  return out.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function workspaceErrorResponse(error: unknown): NextResponse {
  if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
}
