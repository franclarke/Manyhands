import type { RunEvent } from "./types";

export interface CoordinatorEventEnvelope {
  eventId: string;
  runId: string;
  sequence: number;
  occurredAt: string;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Convert the canonical coordinator envelope to the client envelope without
 * translating event names or inventing state. The reducer is responsible for
 * projecting domain facts into the UI model.
 */
export function adaptCoordinatorEvent(event: CoordinatorEventEnvelope): RunEvent {
  return {
    eventId: event.eventId,
    seq: event.sequence,
    at: event.occurredAt,
    runId: event.runId,
    actor: "system",
    type: event.type,
    payload: structuredClone(event.payload)
  };
}
