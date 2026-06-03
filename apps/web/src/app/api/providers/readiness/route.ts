import { NextResponse } from "next/server";

import { inspectGeminiReadiness } from "@/lib/server/providers/readiness";
import { getWorkspaceRepository, WorkspaceNotFoundError } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get("workspaceId");
    const workspace =
      workspaceId !== null && workspaceId.length > 0
        ? await getWorkspaceRepository().get(workspaceId)
        : null;
    const gemini = await inspectGeminiReadiness(workspace);
    return NextResponse.json({ providers: [gemini] });
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
