/**
 * Minimal run store — a thin subscribable holder around the pure reducer.
 *
 * PR 04 of the implementation plan. NOT connected to UI, SSE, or backend (that
 * is later PRs). It exists so a fixture player (PR 06) or the SSE adapter (PR 11)
 * can push events and notify listeners, while all state transitions stay in the
 * pure reducer. Emits only when an event actually changes the model.
 */
import { reduceRunEvent } from "./reducer";
import type { RunEvent, RunModel } from "./types";

export interface RunStore {
  getSnapshot(): RunModel;
  apply(event: RunEvent): void;
  applyMany(events: readonly RunEvent[]): void;
  subscribe(listener: () => void): () => void;
}

export function createRunStore(initial: RunModel): RunStore {
  let model = initial;
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => model,
    apply(event) {
      const next = reduceRunEvent(model, event);
      if (next !== model) {
        model = next;
        emit();
      }
    },
    applyMany(events) {
      let changed = false;
      for (const event of events) {
        const next = reduceRunEvent(model, event);
        if (next !== model) {
          model = next;
          changed = true;
        }
      }
      if (changed) emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}
