import { describe, expect, it } from "vitest";

import {
  openRunEventStream,
  runEventStreamConnectionLabel,
  type RunEventSourceLike,
  type RunEventStreamConnection,
  type RunEventStreamScheduler
} from "@/lib/run-model/live-event-stream";
import type { RunEvent } from "@/lib/run-model/types";

describe("live run EventSource", () => {
  it("explains connection recovery in operator language", () => {
    expect(runEventStreamConnectionLabel("connecting")).toBe("Conectando actividad…");
    expect(runEventStreamConnectionLabel("reconnecting")).toBe("Reconectando actividad…");
    expect(runEventStreamConnectionLabel("degraded")).toBe("Recuperando actualizaciones…");
    expect(runEventStreamConnectionLabel("connected")).toBe("Sincronizado");
  });

  it("reconnects once from the last folded sequence and delivers the missing suffix without a reload", () => {
    const sources: FakeEventSource[] = [];
    const scheduler = new FakeScheduler();
    const connections: RunEventStreamConnection[] = [];
    const received: RunEvent[] = [];
    const stop = openRunEventStream({
      runId: "run:live",
      initialCursor: 4,
      initialEventIds: ["event-4"],
      createEventSource(url) {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
      scheduler,
      heartbeatTimeoutMs: 45_000,
      onConnection: (connection) => connections.push(connection),
      onEvent: (event) => received.push(event)
    });

    expect(sources.map((source) => source.url)).toEqual([
      "/api/runs/run%3Alive/run-events?afterSeq=4"
    ]);
    sources[0]?.open();
    sources[0]?.message(event(5));
    expect(received.map((entry) => entry.seq)).toEqual([5]);

    sources[0]?.fail();
    expect(sources[0]?.closed).toBe(true);
    expect(scheduler.pending("reconnect")).toHaveLength(1);
    scheduler.runNext("reconnect");

    expect(sources.map((source) => source.url)).toEqual([
      "/api/runs/run%3Alive/run-events?afterSeq=4",
      "/api/runs/run%3Alive/run-events?afterSeq=5"
    ]);
    sources[1]?.open();
    sources[1]?.message(event(6));

    expect(received.map((entry) => entry.seq)).toEqual([5, 6]);
    expect(connections).toContain("reconnecting");
    expect(connections.at(-1)).toBe("connected");
    stop();
  });

  it("reconnects a silently stale stream after its observable heartbeat expires", () => {
    const sources: FakeEventSource[] = [];
    const scheduler = new FakeScheduler();
    const connections: RunEventStreamConnection[] = [];
    const stop = openRunEventStream({
      runId: "run:stale",
      initialCursor: 2,
      initialEventIds: [],
      createEventSource(url) {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
      scheduler,
      heartbeatTimeoutMs: 1_000,
      onConnection: (connection) => connections.push(connection),
      onEvent: () => undefined
    });

    sources[0]?.open();
    expect(scheduler.pending("watchdog")).toHaveLength(1);
    scheduler.runNext("watchdog");

    expect(sources[0]?.closed).toBe(true);
    expect(connections.at(-1)).toBe("degraded");
    expect(scheduler.pending("reconnect")).toHaveLength(1);
    scheduler.runNext("reconnect");
    expect(sources).toHaveLength(2);
    expect(sources[1]?.url).toContain("afterSeq=2");
    stop();
  });

  it("treats a sequence gap as recoverable and never opens duplicate reconnects", () => {
    const sources: FakeEventSource[] = [];
    const scheduler = new FakeScheduler();
    const connections: RunEventStreamConnection[] = [];
    const stop = openRunEventStream({
      runId: "run:gap",
      initialCursor: 7,
      initialEventIds: [],
      createEventSource(url) {
        const source = new FakeEventSource(url);
        sources.push(source);
        return source;
      },
      scheduler,
      onConnection: (connection) => connections.push(connection),
      onEvent: () => undefined
    });

    sources[0]?.open();
    sources[0]?.message(event(9));
    sources[0]?.fail();

    expect(connections).toContain("degraded");
    expect(scheduler.pending("reconnect")).toHaveLength(1);
    scheduler.runNext("reconnect");
    expect(sources).toHaveLength(2);
    expect(sources[1]?.url).toContain("afterSeq=7");
    stop();
  });
});

function event(seq: number): RunEvent {
  return {
    eventId: `event-${seq}`,
    seq,
    at: "2026-08-21T00:00:00.000Z",
    runId: "run:live",
    actor: "system",
    type: "readiness.observed",
    payload: {}
  };
}

class FakeEventSource implements RunEventSourceLike {
  onopen: (() => void) | null = null;
  onmessage: ((message: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  constructor(readonly url: string) {}

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  message(value: RunEvent): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }

  fail(): void {
    this.onerror?.();
  }
}

class FakeScheduler implements RunEventStreamScheduler {
  private nextId = 0;
  private tasks = new Map<number, { callback: () => void; kind: "reconnect" | "watchdog" }>();

  setTimeout(callback: () => void, _delayMs: number, kind: "reconnect" | "watchdog"): number {
    const id = ++this.nextId;
    this.tasks.set(id, { callback, kind });
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle === "number") this.tasks.delete(handle);
  }

  pending(kind: "reconnect" | "watchdog"): Array<() => void> {
    return [...this.tasks.values()].filter((task) => task.kind === kind).map((task) => task.callback);
  }

  runNext(kind: "reconnect" | "watchdog"): void {
    const found = [...this.tasks].find(([, task]) => task.kind === kind);
    if (found === undefined) throw new Error(`No ${kind} timer is pending.`);
    const [id, task] = found;
    this.tasks.delete(id);
    task.callback();
  }
}
