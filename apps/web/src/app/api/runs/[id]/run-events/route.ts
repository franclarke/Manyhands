import { NextResponse } from "next/server";
import { JsonlRunEventStore } from "@manyhands/run-store";
import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import { RunNotFoundError, getRunRepository } from "@/lib/server/runs";
import { resolveRunsDirectory } from "@/lib/server/runs/runs-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const HEARTBEAT_MS = 15_000;
const POLL_MS = 250;

/** Streams the canonical fenced V2 journal. No RunRecord backfill or ephemeral event bus participates. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const after = Math.max(readAfter(request.url), readLastEventId(request));
  const store = new JsonlRunEventStore({ directory: resolveRunsDirectory() });
  try {
    const run = await getRunRepository().get(id);
    if (run.architectureVersion?.planning !== "v2") {
      return NextResponse.json({ error: `Run ${id} must be imported into the V2 event journal before it can be streamed.` }, { status: 409 });
    }
    await store.load(id);
  } catch (error) {
    if (error instanceof RunNotFoundError) return NextResponse.json({ error: error.message }, { status: 404 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
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
            const events = await store.load(id);
            for (const event of events) {
              if (event.sequence <= lastSentSequence) continue;
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

function serialize(event: Awaited<ReturnType<JsonlRunEventStore["load"]>>[number]): string {
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
  const params = new URL(url).searchParams;
  const raw = params.get("afterSeq") ?? params.get("after");
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

async function waitForCapacity(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
  for (let checks = 0; controller.desiredSize !== null && controller.desiredSize <= 0 && checks < 200; checks += 1) {
    await delay(5);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
