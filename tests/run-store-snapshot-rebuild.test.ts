import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";

const at = "2026-07-17T12:00:00.000Z";
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "manyhands-run-snapshot-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("discardable run snapshots", () => {
  it("rebuilds corrupt and stale snapshots from the canonical event log", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const authority = { operationId: "planning-1", fencingToken: 1 };
    await events.advanceFence("run-1", authority);
    await events.appendFenced("run-1", 0, authority, [{ eventId: "created", occurredAt: at, type: "run.created", payload: { goal: "Build notes" } }]);

    const first = await snapshots.loadOrRebuild("run-1", authority);
    expect(first).toMatchObject({ lifecycle: "planning", sequence: 1 });
    await writeFile(snapshots.snapshotPath("run-1"), "{broken", "utf8");
    expect(await snapshots.loadOrRebuild("run-1", authority)).toMatchObject({ lifecycle: "planning", sequence: 1 });

    await events.appendFenced("run-1", 1, authority, [{ eventId: "graph", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } }]);
    const rebuilt = await snapshots.loadOrRebuild("run-1", authority);
    expect(rebuilt).toMatchObject({ lifecycle: "needs_approval", sequence: 2, graphRevision: 1 });
    expect(JSON.parse(await readFile(snapshots.snapshotPath("run-1"), "utf8"))).toMatchObject({ eventSequence: 2, lastEventId: "graph" });

    const successor = { operationId: "planning-2", fencingToken: 2 };
    await events.advanceFence("run-1", successor);
    await snapshots.loadOrRebuild("run-1", successor);
    expect(JSON.parse(await readFile(snapshots.snapshotPath("run-1"), "utf8"))).toMatchObject(successor);
  });
});
