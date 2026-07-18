import { JsonlRunEventStore } from "@manyhands/run-store";
import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import type { RunEvent } from "@/lib/run-model/types";
import { resolveRunsDirectory } from "../runs-directory";

/** Read model envelopes exclusively from the canonical V2 journal. */
export async function readCanonicalRunModelEvents(runId: string): Promise<RunEvent[]> {
  const events = await new JsonlRunEventStore({ directory: resolveRunsDirectory() }).load(runId);
  return events.map((event) => adaptCoordinatorEvent({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    payload: event.payload as Record<string, unknown>
  }));
}
