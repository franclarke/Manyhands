import { NextResponse } from "next/server";
import { getTerminalSessionForRun } from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; terminalId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { id, terminalId } = await context.params;
  // B-006 (CF-41): the terminal id is only a capability under its own run.
  const session = getTerminalSessionForRun(id, terminalId);
  if (session === null) return NextResponse.json({ error: "Terminal session not found." }, { status: 404 });
  const payload = (await request.json().catch(() => null)) as { cols?: unknown; rows?: unknown } | null;
  const cols = typeof payload?.cols === "number" ? Math.max(20, Math.min(240, Math.round(payload.cols))) : 100;
  const rows = typeof payload?.rows === "number" ? Math.max(6, Math.min(80, Math.round(payload.rows))) : 28;
  session.resize(cols, rows);
  return NextResponse.json({ ok: true });
}
