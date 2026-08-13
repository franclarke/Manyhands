import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import type { RunEvent } from "@/lib/run-model/types";
import { readProductRunEvents } from "@/lib/server/daemon/productive-client";

/** Historical UI adapter over the daemon's pure canonical-event query. */
export async function readCanonicalRunModelEvents(runId: string): Promise<RunEvent[]> {
  const page = await readProductRunEvents(runId, 0);
  return page.events.map((event) => adaptCoordinatorEvent({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    payload: event.payload as Record<string, unknown>
  }));
}
