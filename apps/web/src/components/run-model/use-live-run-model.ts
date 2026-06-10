"use client";

/**
 * Live run-model bridge.
 *
 * The real run workspace consumes `/api/runs/[id]/run-events`, an SSE stream of
 * native agent-first `RunEvent` envelopes. The legacy `/events` stream remains
 * available for rollback, but this path no longer adapts `StreamEvent`s and never
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import type { Run, RunEvent, RunModel } from "@/lib/run-model/types";

export interface LiveRunModel {
  model: RunModel;
  /** The native envelope (for the timeline / audit trail). */
  events: RunEvent[];
  connected: boolean;
  /** Number of native live events received after the initial cursor. */
  streamCount: number;
}

/** PURE core: initial persisted events + live native events -> reduced model. */
export function buildLiveRunModel(
  streamEvents: readonly RunEvent[],
  seed: Run,
  initialEvents: readonly RunEvent[] = []
): { model: RunModel; events: RunEvent[] } {
  const initialCursor = maxSeq(initialEvents);
  const liveEvents = streamEvents.filter((event) => event.seq > initialCursor);
  const events = [...initialEvents, ...liveEvents];
  const model = reduceRunEvents(createInitialRunModel(seed), events);
  return { model, events };
}

export function useLiveRunModel(seed: Run, initialEvents: readonly RunEvent[] = []): LiveRunModel {
  const [streamEvents, setStreamEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const bufferRef = useRef<RunEvent[]>([]);
  const initialCursor = useMemo(() => maxSeq(initialEvents), [initialEvents]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    bufferRef.current = [];
    setStreamEvents([]);
    const es = new EventSource(`/api/runs/${encodeURIComponent(seed.id)}/run-events?after=${initialCursor}`);
    es.onopen = () => setConnected(true);
    es.onmessage = (raw) => {
      try {
        const event = JSON.parse(raw.data) as RunEvent;
        bufferRef.current = [...bufferRef.current, event];
        setStreamEvents(bufferRef.current);
      } catch {
        // Ignore malformed frames.
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [seed.id, initialCursor]);

  const { model, events } = useMemo(
    () => buildLiveRunModel(streamEvents, seed, initialEvents),
    [streamEvents, seed, initialEvents]
  );
  return { model, events, connected, streamCount: streamEvents.length };
}

function maxSeq(events: readonly RunEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.seq), 0);
}
