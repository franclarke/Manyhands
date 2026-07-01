import { NextResponse } from "next/server";
import { closeTerminalSession } from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ terminalId: string }>;
}

export async function DELETE(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { terminalId } = await context.params;
  closeTerminalSession(terminalId);
  return NextResponse.json({ ok: true });
}
