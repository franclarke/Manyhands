"use client";

/**
 * Live run-model bridge.
 *
 * The run workspace consumes `/api/runs/[id]/run-events`, an SSE stream of
 * native agent-first `RunEvent` envelopes with monotonic `seq` ids. Reconnects
 * are owned here (backoff + jitter + cursor resume + gap-triggered full
 * replay); the cursor-idempotent reducer absorbs any duplicate frames.
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

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function hasRunEventGap(lastSeenSeq: number, eventSeq: number, refetchedAfterGap: boolean): boolean {
  return !refetchedAfterGap && eventSeq > lastSeenSeq + 1;
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

    // Manual reconnection (INV-7): the browser's auto-retry has a fixed cadence
    // and no gap awareness. We close on error and reopen with exponential
    // backoff + jitter, carrying the highest folded seq as `?after=` — the
    // server replays the persisted log from there, so nothing is lost. A
    // non-contiguous seq (truncated/rotated log) triggers ONE full replay from
    // zero; the cursor-idempotent reducer absorbs the duplicates.
    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let lastSeen = initialCursor;
    let refetchedAfterGap = false;
    let disposed = false;

    const cursor = (): number => Math.max(initialCursor, maxSeq(bufferRef.current));

    const connect = (after: number): void => {
      if (disposed) return;
      es = new EventSource(`/api/runs/${encodeURIComponent(seed.id)}/run-events?after=${after}`);
      es.onopen = () => {
        attempts = 0;
        setConnected(true);
      };
      es.onmessage = (raw) => {
        try {
          const event = JSON.parse(raw.data) as RunEvent;
          if (hasRunEventGap(lastSeen, event.seq, refetchedAfterGap)) {
            // Gap: the log no longer covers our cursor. Full replay once.
            refetchedAfterGap = true;
            es?.close();
            bufferRef.current = [];
            lastSeen = 0;
            connect(0);
            return;
          }
          lastSeen = Math.max(lastSeen, event.seq);
          bufferRef.current = [...bufferRef.current, event];
          setStreamEvents(bufferRef.current);
        } catch {
          // Ignore malformed frames.
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        attempts += 1;
        const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempts, 5));
        const delay = backoff / 2 + Math.random() * (backoff / 2); // jitter
        retryTimer = setTimeout(() => connect(cursor()), delay);
      };
    };

    connect(initialCursor);
    return () => {
      disposed = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      es?.close();
    };
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
