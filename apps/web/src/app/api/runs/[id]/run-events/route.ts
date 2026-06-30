import { NextResponse } from "next/server";
import {
  RunNotFoundError,
  ensureRunModelEventLogForRun,
  getRunRepository,
  readRunModelEvents,
  serializeRunModelForSse,
  subscribeRunModelEvents
} from "@/lib/server/runs";
import type { RunEvent } from "@/lib/run-model/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const HEARTBEAT_MS = 15_000;

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  // Resume cursor: the explicit ?after= param or the browser's Last-Event-ID
  // (set automatically on reconnect from the `id:` field of the last frame).
  // The higher one wins — both mean "I already folded everything up to here".
  const after = Math.max(readAfter(request.url), readLastEventId(request));
  let history: RunEvent[];

  try {
    const run = await getRunRepository().get(id);
    history = await ensureRunModelEventLogForRun(run);
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
    async start(controller) {
      let lastSentSeq = after;
      function write(event: RunEvent): void {
        if (event.seq <= lastSentSeq) return;
        lastSentSeq = event.seq;
        try {
          controller.enqueue(encoder.encode(serializeRunModelForSse(event)));
        } catch {
          // controller closed; ignore
        }
      }

      const bufferedLive: RunEvent[] = [];
      let replaying = true;
      unsubscribe = subscribeRunModelEvents(id, (event) => {
        if (replaying) {
          bufferedLive.push(event);
          return;
        }
        write(event);
      });

      for (const event of history) write(event);
      const latest = await readRunModelEvents(id);
      for (const event of latest) write(event);

      replaying = false;
      for (const event of bufferedLive.sort((left, right) => left.seq - right.seq)) write(event);
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
        } catch {
          // controller closed; ignore
        }
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

function readAfter(url: string): number {
  const raw = new URL(url).searchParams.get("after");
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readLastEventId(request: Request): number {
  const raw = request.headers.get("last-event-id");
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
