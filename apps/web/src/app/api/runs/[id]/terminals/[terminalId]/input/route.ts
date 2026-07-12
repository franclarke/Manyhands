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
  const payload = (await request.json().catch(() => null)) as { data?: unknown } | null;
  if (typeof payload?.data !== "string") {
    return NextResponse.json({ error: "data must be a string." }, { status: 400 });
  }
  session.write(payload.data);
  return NextResponse.json({ ok: true });
}
