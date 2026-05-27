import { NextResponse } from "next/server";
import {
  RunNotFoundError,
  getRunEventHistory,
  getRunRepository,
  serializeForSse,
  subscribeRunEvents,
  type RunEvent
} from "@/lib/server/runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const HEARTBEAT_MS = 15_000;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  try {
    await getRunRepository().get(id);
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      function write(event: RunEvent): void {
        try {
          controller.enqueue(encoder.encode(serializeForSse(event)));
        } catch {
          // controller closed; ignore
        }
      }

      // Replay boundary + historical events from the in-process bus so reconnects
      // (and late subscribers) catch up on the live progressive state.
      write({ kind: "replay.start", at: new Date().toISOString() });
      for (const historical of getRunEventHistory(id)) {
        write(historical);
      }
      write({ kind: "replay.end", at: new Date().toISOString() });

      unsubscribe = subscribeRunEvents(id, (event) => write(event));
      heartbeat = setInterval(() => {
        write({ kind: "heartbeat", at: new Date().toISOString() });
      }, HEARTBEAT_MS);
    },
    cancel() {
      if (heartbeat !== null) clearInterval(heartbeat);
      if (unsubscribe !== null) unsubscribe();
    }
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    }
  });
}
