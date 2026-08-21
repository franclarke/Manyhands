"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildRunModel } from "@/lib/run-model/reducer";
import {
  openRunEventStream,
  type RunEventSourceLike,
  type RunEventStreamConnection,
  type RunEventStreamScheduler
} from "@/lib/run-model/live-event-stream";
import type { RunEvent, RunModel, RunSeed } from "@/lib/run-model/types";

export interface LiveRunModel {
  model: RunModel;
  events: RunEvent[];
  connected: boolean;
  connection: RunEventStreamConnection;
  lastSeq: number;
}

export function buildLiveRunModel(
  streamEvents: readonly RunEvent[],
  seed: RunSeed,
  initialEvents: readonly RunEvent[] = []
): { model: RunModel; events: RunEvent[] } {
  const initialCursor = maxSeq(initialEvents);
  const events = [...initialEvents, ...streamEvents.filter((event) => event.seq > initialCursor)];
  return { model: buildRunModel(seed, events), events };
}

export function useLiveRunModel(
  seed: RunSeed,
  initialEvents: readonly RunEvent[] = [],
  options: { disabled?: boolean } = {}
): LiveRunModel {
  const disabled = options.disabled === true;
  const [streamEvents, setStreamEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<LiveRunModel["connection"]>(disabled ? "connected" : "connecting");
  const buffer = useRef<RunEvent[]>([]);
  const initialCursor = useMemo(() => maxSeq(initialEvents), [initialEvents]);

  useEffect(() => {
    if (disabled || typeof window === "undefined") return;
    return openRunEventStream({
      runId: seed.id,
      initialCursor,
      initialEventIds: initialEvents.map((event) => event.eventId),
      createEventSource: (url) => new EventSource(url) as unknown as RunEventSourceLike,
      scheduler: browserScheduler,
      onConnection: setConnection,
      onEvent(event) {
        buffer.current = [...buffer.current, event];
        setStreamEvents(buffer.current);
      }
    });
  }, [disabled, initialCursor, initialEvents, seed.id]);

  const current = useMemo(() => buildLiveRunModel(streamEvents, seed, initialEvents), [initialEvents, seed, streamEvents]);
  return {
    ...current,
    connected: disabled || connection === "connected" || ["completed", "failed", "interrupted"].includes(current.model.run.lifecycle),
    connection,
    lastSeq: maxSeq(current.events)
  };
}

const browserScheduler: RunEventStreamScheduler = {
  setTimeout(callback, delayMs) {
    return window.setTimeout(callback, delayMs);
  },
  clearTimeout(handle) {
    window.clearTimeout(handle as number);
  }
};

function maxSeq(events: readonly RunEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, event.seq), 0);
}
