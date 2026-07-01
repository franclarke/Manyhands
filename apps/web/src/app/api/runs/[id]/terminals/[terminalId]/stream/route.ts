import { NextResponse } from "next/server";
import { getTerminalSession } from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ terminalId: string }>;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { terminalId } = await context.params;
  const session = getTerminalSession(terminalId);
  if (session === null) {
    return NextResponse.json({ error: "Terminal session not found." }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = session.subscribe((chunk) => {
        controller.enqueue(encoder.encode(`event: output\ndata: ${JSON.stringify({ chunk })}\n\n`));
      });
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
      }, 15_000);
    },
    cancel() {
      if (unsubscribe !== null) unsubscribe();
      if (heartbeat !== null) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    }
  });
}
