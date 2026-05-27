import { EventEmitter } from "node:events";
import type { RunEvent } from "./events";

type Listener = (event: RunEvent) => void;

interface BusState {
  emitter: EventEmitter;
  history: RunEvent[];
}

const HISTORY_LIMIT = 2000;
const buses = new Map<string, BusState>();

function getBus(runId: string): BusState {
  let state = buses.get(runId);
  if (state === undefined) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(50);
    state = { emitter, history: [] };
    buses.set(runId, state);
  }
  return state;
}

export function publishRunEvent(runId: string, event: RunEvent): void {
  const state = getBus(runId);
  state.history.push(event);
  if (state.history.length > HISTORY_LIMIT) {
    state.history.shift();
  }
  state.emitter.emit("event", event);
}

export function getRunEventHistory(runId: string): RunEvent[] {
  return buses.get(runId)?.history.slice() ?? [];
}

export function clearRunEventHistory(runId: string): void {
  const state = buses.get(runId);
  if (state !== undefined) {
    state.history = [];
  }
}

export function subscribeRunEvents(runId: string, listener: Listener): () => void {
  const state = getBus(runId);
  state.emitter.on("event", listener);
  return () => {
    state.emitter.off("event", listener);
    if (state.emitter.listenerCount("event") === 0 && state.history.length === 0) {
      buses.delete(runId);
    }
  };
}

export function hasActiveSubscribersForTests(runId: string): boolean {
  return buses.has(runId);
}
