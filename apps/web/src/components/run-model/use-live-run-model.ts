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
import type { Run, RunControlStatus, RunEvent, RunModel } from "@/lib/run-model/types";

export interface LiveRunModel {
  model: RunModel;
  /** The native envelope (for the timeline / audit trail). */
  events: RunEvent[];
  connected: boolean;
  connection: "connecting" | "connected" | "reconnecting" | "degraded" | "disconnected";
  lastSeq: number;
  retryCount: number;
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

export function isTerminalRunStatus(status: RunControlStatus): boolean {
  return status === "completed" || status === "completed_with_accepted" || status === "failed" || status === "interrupted";
}

export function useLiveRunModel(
  seed: Run,
  initialEvents: readonly RunEvent[] = [],
  options?: { disabled?: boolean }
): LiveRunModel {
  const disabled = options?.disabled === true;
  const [streamEvents, setStreamEvents] = useState<RunEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<LiveRunModel["connection"]>("connecting");
  const [retryCount, setRetryCount] = useState(0);
  const bufferRef = useRef<RunEvent[]>([]);
  const initialCursor = useMemo(() => maxSeq(initialEvents), [initialEvents]);

  useEffect(() => {
    if (disabled) return;
    if (typeof window === "undefined") return;
    bufferRef.current = [];
    setStreamEvents([]);
    setConnection("connecting");
    setRetryCount(0);

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
    let recoveringGap = false;
    const seenEventIds = new Set(initialEvents.map((event) => event.eventId).filter((eventId): eventId is string => eventId !== undefined));
    let disposed = false;

    const cursor = (): number => Math.max(initialCursor, maxSeq(bufferRef.current));

    const connect = (after: number): void => {
      if (disposed) return;
      setConnection(attempts === 0 ? "connecting" : "reconnecting");
      es = new EventSource(`/api/runs/${encodeURIComponent(seed.id)}/run-events?afterSeq=${after}`);
      es.onopen = () => {
        attempts = 0;
        setConnected(true);
        setConnection("connected");
      };
      es.onmessage = (raw) => {
        try {
          const event = JSON.parse(raw.data) as RunEvent;
          if (hasRunEventGap(lastSeen, event.seq, recoveringGap)) {
            // Ask the durable reader for the missing delta before accepting a
            // non-contiguous frame. A repeated gap is visible, never silent.
            recoveringGap = true;
            es?.close();
            setConnection("degraded");
            connect(lastSeen);
            return;
          }
          if (event.eventId !== undefined && seenEventIds.has(event.eventId)) return;
          if (event.eventId !== undefined) seenEventIds.add(event.eventId);
          if (event.seq <= lastSeen) return;
          lastSeen = Math.max(lastSeen, event.seq);
          bufferRef.current = [...bufferRef.current, event];
          setStreamEvents(bufferRef.current);
        } catch {
          // Ignore malformed frames.
        }
      };
      es.onerror = () => {
        setConnected(false);
        setConnection("reconnecting");
        es?.close();
        attempts += 1;
        setRetryCount(attempts);
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
      setConnection("disconnected");
    };
  }, [disabled, seed.id, initialCursor, initialEvents]);

  const { model, events } = useMemo(
    () => buildLiveRunModel(streamEvents, seed, initialEvents),
    [streamEvents, seed, initialEvents]
  );
  return {
    model,
    events,
    connected: disabled || connected || isTerminalRunStatus(model.run.control.status),
    connection: disabled ? "connected" : connection,
    lastSeq: maxSeq(events),
    retryCount,
    streamCount: streamEvents.length
  };
}

function maxSeq(events: readonly RunEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.seq), 0);
}
