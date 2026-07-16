import { NextResponse } from "next/server";
import { inspectCapabilities } from "@/lib/server/providers/capability-service";
import { getWorkspaceRepository, WorkspaceNotFoundError } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId");
    const workspace = workspaceId !== null && workspaceId.length > 0
      ? await getWorkspaceRepository().get(workspaceId)
      : null;
    return NextResponse.json(await inspectCapabilities(workspace));
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
