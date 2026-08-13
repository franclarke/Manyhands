import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CorruptRunEventLogError,
  JsonlRunEventStore,
  LegacyRunRecordImporter,
  SequenceConflictError
} from "@manyhands/run-store";

const at = "2026-07-17T12:00:00.000Z";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("canonical run event source", () => {
  it("appends with sequence CAS and deduplicates a stable eventId", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "planning-1", fencingToken: 1 };
    await store.advanceFence("run-1", authority);

    const input = { eventId: "event-created", occurredAt: at, type: "run.created" as const, payload: { goal: "Build a notes app" } };
    const first = await store.appendFenced("run-1", 0, authority, [input]);
    const retried = await store.appendFenced("run-1", 0, authority, [input]);

    expect(first).toEqual(retried);
    expect(first[0]).toMatchObject({ runId: "run-1", sequence: 1, eventId: "event-created" });
    await expect(store.appendFenced("run-1", 0, authority, [{ ...input, eventId: "event-other" }]))
      .rejects.toBeInstanceOf(SequenceConflictError);
  });

  it("recovers an incomplete trailing line but rejects middle corruption", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "planning-1", fencingToken: 1 };
    await store.advanceFence("run-tail", authority);
    await store.appendFenced("run-tail", 0, authority, [{ eventId: "event-created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }]);

    await appendFile(store.eventLogPath("run-tail"), "{\"schemaVersion\":2", "utf8");
    expect((await store.inspect("run-tail")).status).toBe("degraded");
    await store.appendFenced("run-tail", 1, authority, [{ eventId: "event-graph", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } }]);
    expect((await store.load("run-tail")).map((event) => event.sequence)).toEqual([1, 2]);

    const lines = (await readFile(store.eventLogPath("run-tail"), "utf8")).trimEnd().split("\n");
    await writeFile(store.eventLogPath("run-tail"), `${lines[0]}\nnot-json\n${lines[1]}\n`, "utf8");
    await expect(store.load("run-tail")).rejects.toBeInstanceOf(CorruptRunEventLogError);
  });

  it("persists an append batch as one record so a torn write exposes none of its events", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "planning-1", fencingToken: 1 };
    await store.advanceFence("run-batch", authority);
    await store.appendFenced("run-batch", 0, authority, [
      { eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }
    ]);

    const batch = [
      { eventId: "graph", occurredAt: at, type: "graph.revision.proposed" as const, payload: { graphId: "graph-1", revision: 1 } },
      { eventId: "approved", occurredAt: at, type: "graph.revision.approved" as const, payload: { graphId: "graph-1", revision: 1 } }
    ];
    await store.appendFenced("run-batch", 1, authority, batch);

    const records = (await readFile(store.eventLogPath("run-batch"), "utf8")).trimEnd().split("\n");
    expect(records).toHaveLength(2);
    const durableBatch = JSON.parse(records[1]!) as { events?: unknown[] };
    expect(durableBatch.events).toHaveLength(2);

    const tornBatch = records[1]!.slice(0, Math.floor(records[1]!.length / 2));
    await writeFile(store.eventLogPath("run-batch"), `${records[0]}\n${tornBatch}`, "utf8");

    expect(await store.inspect("run-batch")).toMatchObject({
      status: "degraded",
      events: [{ eventId: "created", sequence: 1 }]
    });

    await store.appendFenced("run-batch", 1, authority, batch);
    expect((await store.load("run-batch")).map((event) => event.sequence)).toEqual([1, 2, 3]);
  });

  it("treats an unterminated final batch as degraded and replaces it on the next append", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "planning-1", fencingToken: 1 };
    await store.advanceFence("run-unterminated", authority);
    await store.appendFenced("run-unterminated", 0, authority, [
      { eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }
    ]);
    const graph = {
      eventId: "graph",
      occurredAt: at,
      type: "graph.revision.proposed" as const,
      payload: { graphId: "graph-1", revision: 1 }
    };
    await store.appendFenced("run-unterminated", 1, authority, [graph]);

    const withoutFinalDelimiter = (await readFile(store.eventLogPath("run-unterminated"), "utf8")).trimEnd();
    await writeFile(store.eventLogPath("run-unterminated"), withoutFinalDelimiter, "utf8");

    expect(await store.inspect("run-unterminated")).toMatchObject({
      status: "degraded",
      events: [{ eventId: "created", sequence: 1 }]
    });
    await store.appendFenced("run-unterminated", 1, authority, [graph]);
    expect((await store.load("run-unterminated")).map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("serializes concurrent CAS writers so only one wins a sequence", async () => {
    const store = new JsonlRunEventStore({ directory });
    const authority = { operationId: "planning-1", fencingToken: 1 };
    await store.advanceFence("run-race", authority);
    await store.appendFenced("run-race", 0, authority, [{ eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }]);

    const results = await Promise.allSettled([
      store.appendFenced("run-race", 1, authority, [{ eventId: "graph-a", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph-a", revision: 1 } }]),
      store.appendFenced("run-race", 1, authority, [{ eventId: "graph-b", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph-b", revision: 1 } }])
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await store.load("run-race")).toHaveLength(2);
  });

  it("requires an explicit, audited mapping for legacy records", () => {
    const importer = new LegacyRunRecordImporter();
    expect(() => importer.import({ record: { runId: "old" }, approvedBy: "", importedAt: at, map: () => ({ events: [], warnings: [] }) })).toThrow(/approving actor/i);

    const result = importer.import({
      record: { runId: "old", prompt: "Build notes" },
      approvedBy: "migration-operator",
      importedAt: at,
      map: () => ({
        events: [{ eventId: "legacy-created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }],
        warnings: ["Legacy status was not imported as an observed domain fact."]
      })
    });
    expect(result.audit).toMatchObject({ importerVersion: 1, approvedBy: "migration-operator", warnings: [expect.stringContaining("not imported")] });
    expect(result.audit.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps the productive persistence adapter independent from planning and execution packages", async () => {
    const manifest = JSON.parse(await readFile(path.resolve("packages/run-store/package.json"), "utf8")) as { dependencies: Record<string, string> };
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      "@manyhands/contracts",
      "@manyhands/run-coordinator",
      "@manyhands/shared",
      "zod"
    ]);
  });
});
