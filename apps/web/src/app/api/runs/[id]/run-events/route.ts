import { NextResponse } from "next/server";
import {
  RunNotFoundError,
  ensureRunModelEventLogForRun,
  getRunRepository,
  hasRunModelEventLog,
  readRunModelEventBatch,
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
  let initial;

  try {
    const run = await getRunRepository().get(id);
    // Legacy/first-load records need one projection; normal reconnects read
    // only the delta from the durable JSONL stream.
    if (!(await hasRunModelEventLog(id))) await ensureRunModelEventLogForRun(run);
    initial = await readRunModelEventBatch(id, after, readBatchLimit(request.url));
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
      async function write(event: RunEvent): Promise<void> {
        if (event.seq <= lastSentSeq) return;
        lastSentSeq = event.seq;
        await waitForCapacity(controller);
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
        void write(event);
      });

      let batch = initial;
      while (true) {
        for (const event of batch.events) await write(event);
        if (batch.status === "degraded") writeComment(controller, "degraded");
        if (!batch.hasMore) break;
        batch = await readRunModelEventBatch(id, batch.nextCursor, readBatchLimit(request.url));
      }

      replaying = false;
      for (const event of bufferedLive.sort((left, right) => left.seq - right.seq)) await write(event);
      writeComment(controller, "connected");
      heartbeat = setInterval(() => {
        writeComment(controller, "heartbeat");
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

  function writeComment(controller: ReadableStreamDefaultController<Uint8Array>, label: string): void {
    try {
      controller.enqueue(encoder.encode(`: ${label} ${new Date().toISOString()}\n\n`));
    } catch {
      // controller closed; ignore
    }
  }
}

function readAfter(url: string): number {
  const params = new URL(url).searchParams;
  const raw = params.get("afterSeq") ?? params.get("after");
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readBatchLimit(url: string): number {
  const value = Number(new URL(url).searchParams.get("limit") ?? "250");
  return Number.isFinite(value) ? Math.max(1, Math.min(Math.floor(value), 1_000)) : 250;
}

async function waitForCapacity(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
  // Web streams expose desiredSize rather than Node's drain event. Yielding at
  // a bounded cadence prevents an unbounded producer loop for a slow client.
  for (let checks = 0; controller.desiredSize !== null && controller.desiredSize <= 0 && checks < 200; checks += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function readLastEventId(request: Request): number {
  const raw = request.headers.get("last-event-id");
  if (raw === null) return 0;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
