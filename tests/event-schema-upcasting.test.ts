import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_EVENT_SCHEMA_VERSION,
  CorruptRunEventLogError,
  JsonlRunEventStore,
  upcastEventToCurrent
} from "@manyhands/run-store";

const at = "2026-07-17T12:00:00.000Z";
let directory: string;

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-upcast-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("event schema upcasting", () => {
  it("is an identity at the current schema version", () => {
    const event = { eventId: "e", runId: "r", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "x" } };
    expect(upcastEventToCurrent(CURRENT_EVENT_SCHEMA_VERSION, event)).toEqual(event);
  });

  it("fails closed on a schema version newer than supported", () => {
    expect(() => upcastEventToCurrent(CURRENT_EVENT_SCHEMA_VERSION + 1, {})).toThrow();
  });

  it("rejects an older version until an upcaster is registered", () => {
    expect(() => upcastEventToCurrent(CURRENT_EVENT_SCHEMA_VERSION - 1, {})).toThrow();
  });

  it("reads a current-version log unchanged and treats a future-version record as corrupt", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "op-1", fencingToken: 1 };
    await store.advanceFence("run-up", authority);
    await store.appendFenced("run-up", 0, authority, [{ eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build" } }]);
    // The current-version record round-trips exactly.
    expect((await store.load("run-up")).map((event) => event.sequence)).toEqual([1]);

    const existing = (await readFile(store.eventLogPath("run-up"), "utf8")).trimEnd();
    const futureEnvelope = JSON.stringify({ schemaVersion: CURRENT_EVENT_SCHEMA_VERSION + 1, event: { eventId: "future", runId: "run-up", sequence: 2, occurredAt: at, type: "run.created", payload: { goal: "Build" } }, checksum: "deadbeef" });
    await writeFile(store.eventLogPath("run-up"), `${existing}\n${futureEnvelope}\n`, "utf8");
    await expect(store.load("run-up")).rejects.toBeInstanceOf(CorruptRunEventLogError);
  });
});
