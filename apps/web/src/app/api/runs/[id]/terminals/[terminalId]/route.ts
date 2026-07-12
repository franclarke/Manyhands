import { NextResponse } from "next/server";
import { closeTerminalSessionForRun } from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; terminalId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, terminalId } = await context.params;
  // B-006 (CF-41): the terminal id is only a capability under its own run.
  if (!closeTerminalSessionForRun(id, terminalId)) {
    return NextResponse.json({ error: "Terminal session not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
