import { NextResponse } from "next/server";
import { getTerminalSession } from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ terminalId: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  const { terminalId } = await context.params;
  const session = getTerminalSession(terminalId);
  if (session === null) return NextResponse.json({ error: "Terminal session not found." }, { status: 404 });
  const payload = (await request.json().catch(() => null)) as { data?: unknown } | null;
  if (typeof payload?.data !== "string") {
    return NextResponse.json({ error: "data must be a string." }, { status: 400 });
  }
  session.write(payload.data);
  return NextResponse.json({ ok: true });
}
