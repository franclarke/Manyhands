import { EventEmitter } from "node:events";
import type { RunEvent } from "@/lib/run-model/types";
import { globalSingleton } from "../global-singleton";

type Listener = (event: RunEvent) => void;

interface BusState {
  emitter: EventEmitter;
}

// On globalThis: publishers (pipelines) and the SSE subscriber live in
// different Next route bundles; a module-level map is one-per-bundle.
const buses = globalSingleton("run-model-event-bus", () => new Map<string, BusState>());

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
  // `id:` carries the monotonic seq so the browser's EventSource resumes with
  // a Last-Event-ID header after any drop — replay picks up exactly there.
  return `id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`;
}
