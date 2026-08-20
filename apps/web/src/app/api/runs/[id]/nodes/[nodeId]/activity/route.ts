import { readNodeActivity, type NodeActivityEntry } from "@/lib/server/daemon/productive-client";
import { daemonQueryErrorResponse } from "@/lib/server/daemon/route-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string; nodeId: string }>; }

const HEARTBEAT_MS = 15_000;
const POLL_MS = 500;

/**
 * The agent's own output for one node, as it happens.
 *
 * A node used to render as a spinner with no content: the chunks were recorded
 * but nothing read them back. This streams them, resuming from `after` so a
 * reconnecting reader is not shown what it already has.
 */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id, nodeId } = await context.params;
  const after = Math.max(readAfter(request.url), readLastEventId(request));
  try {
    await readNodeActivity(id, nodeId, after);
  } catch (error) {
    return daemonQueryErrorResponse(error);
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastIndex = after;
      let lastHeartbeatAt = Date.now();
      const pump = async (): Promise<void> => {
        while (!cancelled) {
          try {
            const page = await readNodeActivity(id, nodeId, lastIndex);
            for (const entry of page.entries) {
              lastIndex = entry.index;
              controller.enqueue(encoder.encode(serialize(entry)));
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

function serialize(entry: NodeActivityEntry): string {
  return `id: ${entry.index}\ndata: ${JSON.stringify(entry)}\n\n`;
}

function readAfter(url: string): number {
  const raw = new URL(url).searchParams.get("after");
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function readLastEventId(request: Request): number {
  const raw = request.headers.get("last-event-id");
  const value = raw === null ? 0 : Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
