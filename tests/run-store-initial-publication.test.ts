import type * as NodeFs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const streamTracker = vi.hoisted(() => ({ calls: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();
  return {
    ...actual,
    createWriteStream: (...args: unknown[]) => {
      streamTracker.calls += 1;
      return Reflect.apply(actual.createWriteStream, actual, args);
    }
  };
});

import { JsonlRunEventStore } from "@manyhands/run-store";

let directory: string;

beforeEach(async () => {
  streamTracker.calls = 0;
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-store-initial-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("initial run journal publication", () => {
  it("publishes the identity batch atomically before later batches use streaming append", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "create-run", fencingToken: 1 };
    const occurredAt = "2026-08-20T12:00:00.000Z";
    await store.advanceFence("run-atomic", authority);

    await store.appendFenced("run-atomic", 0, authority, [{
      eventId: "run-created",
      occurredAt,
      type: "run.created",
      payload: { goal: "Build Viaje en Familia" }
    }]);

    expect(streamTracker.calls).toBe(0);
    expect((await store.load("run-atomic")).map((event) => event.type)).toEqual(["run.created"]);

    await store.appendFenced("run-atomic", 1, authority, [{
      eventId: "graph-proposed",
      occurredAt,
      type: "graph.revision.proposed",
      payload: { graphId: "graph:atomic", revision: 1 }
    }]);

    expect(streamTracker.calls).toBe(1);
  });
});
