import type { RunEvent } from "./types";

export type RunEventStreamConnection = "connecting" | "connected" | "reconnecting" | "degraded" | "disconnected";

export interface RunEventSourceLike {
  onopen: (() => void) | null;
  onmessage: ((message: { data: string }) => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  close(): void;
}

export interface RunEventStreamScheduler {
  setTimeout(callback: () => void, delayMs: number, kind: "reconnect" | "watchdog"): unknown;
  clearTimeout(handle: unknown): void;
}

interface OpenRunEventStreamOptions {
  runId: string;
  initialCursor: number;
  initialEventIds: readonly string[];
  createEventSource(url: string): RunEventSourceLike;
  scheduler: RunEventStreamScheduler;
  heartbeatTimeoutMs?: number;
  onConnection(connection: RunEventStreamConnection): void;
  onEvent(event: RunEvent): void;
}

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

export function runEventStreamConnectionLabel(connection: RunEventStreamConnection): string {
  const labels: Record<RunEventStreamConnection, string> = {
    connecting: "Conectando actividad…",
    connected: "Sincronizado",
    reconnecting: "Reconectando actividad…",
    degraded: "Recuperando actualizaciones…",
    disconnected: "Sin conexión en vivo"
  };
  return labels[connection];
}

/**
 * Owns exactly one EventSource and one reconnect timer. Every replacement uses
 * the last event that the reducer accepted, so replay closes a gap without a
 * page reload and without duplicating already-folded facts.
 */
export function openRunEventStream(options: OpenRunEventStreamOptions): () => void {
  let source: RunEventSourceLike | null = null;
  let heartbeatListener: (() => void) | null = null;
  let reconnectHandle: unknown;
  let watchdogHandle: unknown;
  let reconnectAttempts = 0;
  let lastSeen = options.initialCursor;
  let disposed = false;
  const seen = new Set(options.initialEventIds);
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

  const clearTimer = (kind: "reconnect" | "watchdog"): void => {
    const handle = kind === "reconnect" ? reconnectHandle : watchdogHandle;
    if (handle === undefined) return;
    options.scheduler.clearTimeout(handle);
    if (kind === "reconnect") reconnectHandle = undefined;
    else watchdogHandle = undefined;
  };

  const releaseSource = (): void => {
    if (source === null) return;
    source.onopen = null;
    source.onmessage = null;
    source.onerror = null;
    if (heartbeatListener !== null) source.removeEventListener("heartbeat", heartbeatListener);
    source.close();
    source = null;
    heartbeatListener = null;
  };

  const reconnect = (state: "reconnecting" | "degraded", requestedDelay?: number): void => {
    if (disposed) return;
    releaseSource();
    clearTimer("watchdog");
    options.onConnection(state);
    if (reconnectHandle !== undefined) return;
    reconnectAttempts += 1;
    const delay = requestedDelay ?? Math.min(
      MAX_RECONNECT_DELAY_MS,
      500 * 2 ** Math.min(reconnectAttempts - 1, 4)
    );
    reconnectHandle = options.scheduler.setTimeout(() => {
      reconnectHandle = undefined;
      connect(false);
    }, delay, "reconnect");
  };

  const armWatchdog = (): void => {
    clearTimer("watchdog");
    watchdogHandle = options.scheduler.setTimeout(() => {
      watchdogHandle = undefined;
      reconnect("degraded", 0);
    }, heartbeatTimeoutMs, "watchdog");
  };

  const markHealthy = (): void => {
    if (disposed) return;
    reconnectAttempts = 0;
    options.onConnection("connected");
    armWatchdog();
  };

  function connect(initial: boolean): void {
    if (disposed) return;
    options.onConnection(initial ? "connecting" : "reconnecting");
    const current = options.createEventSource(
      `/api/runs/${encodeURIComponent(options.runId)}/run-events?afterSeq=${lastSeen}`
    );
    source = current;
    heartbeatListener = () => {
      if (source === current) markHealthy();
    };
    current.addEventListener("heartbeat", heartbeatListener);
    current.onopen = () => {
      if (source === current) markHealthy();
    };
    current.onmessage = (message) => {
      if (source !== current) return;
      let event: RunEvent;
      try {
        event = JSON.parse(message.data) as RunEvent;
      } catch {
        reconnect("degraded", 250);
        return;
      }
      if (!validEventIdentity(event)) {
        reconnect("degraded", 250);
        return;
      }
      markHealthy();
      if (seen.has(event.eventId) || event.seq <= lastSeen) return;
      if (event.seq !== lastSeen + 1) {
        reconnect("degraded", 250);
        return;
      }
      seen.add(event.eventId);
      lastSeen = event.seq;
      options.onEvent(event);
    };
    current.onerror = () => {
      if (source === current) reconnect("reconnecting");
    };
  }

  connect(true);
  return () => {
    disposed = true;
    clearTimer("reconnect");
    clearTimer("watchdog");
    releaseSource();
    options.onConnection("disconnected");
  };
}

function validEventIdentity(event: RunEvent): boolean {
  return typeof event === "object"
    && event !== null
    && typeof event.eventId === "string"
    && Number.isInteger(event.seq)
    && event.seq > 0;
}
