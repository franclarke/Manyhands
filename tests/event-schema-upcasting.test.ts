import { createHash } from "node:crypto";
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
  it("writes the integrity-evidence event shape as schema v4", () => {
    expect(CURRENT_EVENT_SCHEMA_VERSION).toBe(4);
  });
  it("is an identity at the current schema version", () => {
    const event = { eventId: "e", runId: "r", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "x" } };
    expect(upcastEventToCurrent(CURRENT_EVENT_SCHEMA_VERSION, event)).toEqual(event);
  });

  it("fails closed on a schema version newer than supported", () => {
    expect(() => upcastEventToCurrent(CURRENT_EVENT_SCHEMA_VERSION + 1, {})).toThrow();
  });

  it("upcasts the previous event shape and rejects versions without a registered path", () => {
    const v2 = { eventId: "e", type: "validation.completed", payload: { matrix: { outcome: "verified" } } };
    expect(upcastEventToCurrent(2, v2)).toEqual(v2);
    expect(() => upcastEventToCurrent(1, {})).toThrow();
  });

  it("loads a checksummed v2 journal through the registered upcaster", async () => {
    const store = new JsonlRunEventStore({ directory });
    const event = { eventId: "created-v2", runId: "run-v2-old", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "Build" } };
    const checksum = createHash("sha256").update(JSON.stringify(event)).digest("hex");
    await writeFile(store.eventLogPath("run-v2-old"), `${JSON.stringify({ schemaVersion: 2, event, checksum })}\n`, "utf8");
    expect((await store.load("run-v2-old")).map((entry) => entry.eventId)).toEqual(["created-v2"]);
  });

  it("reads a current-version log unchanged and treats a future-version record as corrupt", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "op-1", fencingToken: 1 };
    await store.advanceFence("run-up", authority);
    await store.appendFenced("run-up", 0, authority, [{ eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build" } }]);
    // The current-version record round-trips exactly.
    expect((await store.load("run-up")).map((event) => event.sequence)).toEqual([1]);
    expect(JSON.parse((await readFile(store.eventLogPath("run-up"), "utf8")).trim()).schemaVersion).toBe(4);

    const existing = (await readFile(store.eventLogPath("run-up"), "utf8")).trimEnd();
    const futureEnvelope = JSON.stringify({ schemaVersion: CURRENT_EVENT_SCHEMA_VERSION + 1, event: { eventId: "future", runId: "run-up", sequence: 2, occurredAt: at, type: "run.created", payload: { goal: "Build" } }, checksum: "deadbeef" });
    await writeFile(store.eventLogPath("run-up"), `${existing}\n${futureEnvelope}\n`, "utf8");
    await expect(store.load("run-up")).rejects.toBeInstanceOf(CorruptRunEventLogError);
  });
});
