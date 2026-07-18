"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { buildRunModel } from "@/lib/run-model/reducer";
import type { RunEvent, RunModel, RunSeed } from "@/lib/run-model/types";

export interface LiveRunModel {
  model: RunModel;
  events: RunEvent[];
  connected: boolean;
  connection: "connecting" | "connected" | "reconnecting" | "degraded" | "disconnected";
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
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let attempts = 0;
    let lastSeen = initialCursor;
    const seen = new Set(initialEvents.map((event) => event.eventId));

    const connect = (): void => {
      if (disposed) return;
      setConnection(attempts === 0 ? "connecting" : "reconnecting");
      source = new EventSource(`/api/runs/${encodeURIComponent(seed.id)}/run-events?afterSeq=${lastSeen}`);
      source.onopen = () => {
        attempts = 0;
        setConnection("connected");
      };
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as RunEvent;
          if (seen.has(event.eventId) || event.seq <= lastSeen) return;
          if (event.seq !== lastSeen + 1) {
            setConnection("degraded");
            source?.close();
            timer = setTimeout(connect, 250);
            return;
          }
          seen.add(event.eventId);
          lastSeen = event.seq;
          buffer.current = [...buffer.current, event];
          setStreamEvents(buffer.current);
        } catch {
          setConnection("degraded");
        }
      };
      source.onerror = () => {
        source?.close();
        attempts += 1;
        setConnection("reconnecting");
        const delay = Math.min(30_000, 500 * 2 ** Math.min(attempts, 6));
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      if (timer !== undefined) clearTimeout(timer);
      setConnection("disconnected");
    };
  }, [disabled, initialCursor, initialEvents, seed.id]);

  const current = useMemo(() => buildLiveRunModel(streamEvents, seed, initialEvents), [initialEvents, seed, streamEvents]);
  return {
    ...current,
    connected: disabled || connection === "connected" || ["completed", "failed", "interrupted"].includes(current.model.run.lifecycle),
    connection,
    lastSeq: maxSeq(current.events)
  };
}

function maxSeq(events: readonly RunEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, event.seq), 0);
}
