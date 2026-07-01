import { NextResponse } from "next/server";
import {
  RunNotFoundError,
  createTerminalSession,
  getRunRepository,
  parseWorkspaceContext
} from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be valid JSON." }, { status: 400 });
  }
  try {
    const run = await getRunRepository().get(id);
    const body = payload as { context?: unknown; nodeId?: unknown; cols?: unknown; rows?: unknown };
    const session = await createTerminalSession({
      run,
      context: parseWorkspaceContext(typeof body.context === "string" ? body.context : null),
      nodeId: typeof body.nodeId === "string" ? body.nodeId : undefined,
      cols: typeof body.cols === "number" ? body.cols : undefined,
      rows: typeof body.rows === "number" ? body.rows : undefined
    });
    return NextResponse.json({ session });
  } catch (error) {
    if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
