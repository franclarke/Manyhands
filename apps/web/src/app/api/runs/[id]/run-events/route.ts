import type { RunEvent } from "@manyhands/run-coordinator";

import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import { readProductRunEvents } from "@/lib/server/daemon/productive-client";
import { daemonQueryErrorResponse } from "@/lib/server/daemon/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }>; }

const HEARTBEAT_MS = 15_000;
const POLL_MS = 250;

/** Pure BFF stream over durable daemon event pages. It never opens the journal. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const after = Math.max(readAfter(request.url), readLastEventId(request));
  try {
    await readProductRunEvents(id, after);
  } catch (error) {
    return daemonQueryErrorResponse(error);
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSentSequence = after;
      let lastHeartbeatAt = Date.now();
      const pump = async (): Promise<void> => {
        while (!cancelled) {
          try {
            const page = await readProductRunEvents(id, lastSentSequence);
            for (const event of page.events) {
              lastSentSequence = event.sequence;
              await waitForCapacity(controller);
              controller.enqueue(encoder.encode(serialize(event)));
            }
            if (Date.now() - lastHeartbeatAt >= HEARTBEAT_MS) {
              controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`));
              lastHeartbeatAt = Date.now();
            }
          } catch (error) {
            if (!cancelled) controller.error(error);
            return;
          }
          await delay(POLL_MS);
        }
      };
      controller.enqueue(encoder.encode(`: connected ${new Date().toISOString()}\n\n`));
      void pump();
    },
    cancel() {
      cancelled = true;
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

function serialize(event: RunEvent): string {
  const adapted = adaptCoordinatorEvent({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    payload: event.payload as Record<string, unknown>
  });
  return `id: ${event.sequence}\ndata: ${JSON.stringify(adapted)}\n\n`;
}

function readAfter(url: string): number {
  const raw = new URL(url).searchParams.get("afterSeq") ?? new URL(url).searchParams.get("after");
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readLastEventId(request: Request): number {
  const raw = request.headers.get("last-event-id");
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

async function waitForCapacity(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
  for (let checks = 0; controller.desiredSize !== null && controller.desiredSize <= 0 && checks < 200; checks += 1) {
    await delay(5);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
