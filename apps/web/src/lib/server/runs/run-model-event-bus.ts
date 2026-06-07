import { EventEmitter } from "node:events";
import type { RunEvent } from "@/lib/run-model/types";

type Listener = (event: RunEvent) => void;

interface BusState {
  emitter: EventEmitter;
}

const buses = new Map<string, BusState>();

function getBus(runId: string): BusState {
  let state = buses.get(runId);
  if (state === undefined) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    state = { emitter };
    buses.set(runId, state);
  }
  return state;
}

export function publishRunModelBusEvent(runId: string, event: RunEvent): void {
  getBus(runId).emitter.emit("event", event);
}

export function subscribeRunModelEvents(runId: string, listener: Listener): () => void {
  const state = getBus(runId);
  state.emitter.on("event", listener);
  return () => {
    state.emitter.off("event", listener);
    if (state.emitter.listenerCount("event") === 0) {
      buses.delete(runId);
    }
  };
}

export function serializeRunModelForSse(event: RunEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
