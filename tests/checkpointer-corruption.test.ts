/**
 * INV-3 — corrupt checkpoints are DETECTED, never silently treated as "no
 * checkpoint". A torn latest.json (crash mid-write, disk full) degrades to the
 * newest valid immutable checkpoint; only when every file is unreadable does
 * the thread count as lost.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileCheckpointSaver, type Checkpoint, type CheckpointMetadata } from "@manyhands/orchestrator-graph";

let tempDir: string;
let saver: JsonFileCheckpointSaver;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-ckpt-"));
  saver = new JsonFileCheckpointSaver(tempDir);
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function makeCheckpoint(id: string): Checkpoint {
  return {
    v: 1,
    id,
    ts: new Date().toISOString(),
    channel_values: { marker: id },
    channel_versions: {},
    versions_seen: {}
  } as unknown as Checkpoint;
}

const metadata: CheckpointMetadata = { source: "input", step: 0, parents: {} };

async function putCheckpoint(threadId: string, id: string): Promise<void> {
  await saver.put({ configurable: { thread_id: threadId } }, makeCheckpoint(id), metadata, {});
}

function latestPath(threadId: string): string {
  return path.join(tempDir, threadId, "latest.json");
}

describe("JsonFileCheckpointSaver corruption handling", () => {
  it("inspectThread: missing / ok / degraded / lost", async () => {
    expect(await saver.inspectThread("t-missing")).toEqual({ status: "missing" });

    await putCheckpoint("t-ok", "chk-1");
    expect(await saver.inspectThread("t-ok")).toEqual({ status: "ok", checkpointId: "chk-1" });

    await putCheckpoint("t-degraded", "chk-1");
    await putCheckpoint("t-degraded", "chk-2");
    await writeFile(latestPath("t-degraded"), "{ torn write", "utf-8");
    expect(await saver.inspectThread("t-degraded")).toEqual({
      status: "degraded",
      checkpointId: "chk-2",
      corrupted: ["latest.json"]
    });

    await putCheckpoint("t-lost", "chk-1");
    await writeFile(latestPath("t-lost"), "{ torn", "utf-8");
    await writeFile(path.join(tempDir, "t-lost", "chk-1.json"), "also broken", "utf-8");
    const lost = await saver.inspectThread("t-lost");
    expect(lost.status).toBe("lost");
    expect((lost as { corrupted: string[] }).corrupted).toEqual(["latest.json", "chk-1.json"]);
  });

  it("getTuple falls back to the newest valid checkpoint when latest.json is corrupt", async () => {
    await putCheckpoint("t-fallback", "chk-1");
    await putCheckpoint("t-fallback", "chk-2");
    await writeFile(latestPath("t-fallback"), "%%% not json %%%", "utf-8");

    const tuple = await saver.getTuple({ configurable: { thread_id: "t-fallback" } });
    expect(tuple).toBeDefined();
    expect(tuple?.checkpoint.id).toBe("chk-2");
  });

  it("getTuple for an explicitly requested corrupt checkpoint returns undefined (no substitute)", async () => {
    await putCheckpoint("t-explicit", "chk-1");
    await writeFile(path.join(tempDir, "t-explicit", "chk-1.json"), "broken", "utf-8");
    const tuple = await saver.getTuple({
      configurable: { thread_id: "t-explicit", checkpoint_id: "chk-1" }
    });
    expect(tuple).toBeUndefined();
  });

  it("getTuple returns undefined when every checkpoint is unreadable", async () => {
    await putCheckpoint("t-all-broken", "chk-1");
    await writeFile(latestPath("t-all-broken"), "x", "utf-8");
    await writeFile(path.join(tempDir, "t-all-broken", "chk-1.json"), "y", "utf-8");
    expect(await saver.getTuple({ configurable: { thread_id: "t-all-broken" } })).toBeUndefined();
  });

  it("list() skips corrupt files and never parses .writes.json as a checkpoint", async () => {
    await putCheckpoint("t-list", "chk-1");
    await putCheckpoint("t-list", "chk-2");
    await saver.putWrites(
      { configurable: { thread_id: "t-list", checkpoint_id: "chk-2" } },
      [["channel", { value: 1 }]],
      "task-1"
    );
    await writeFile(path.join(tempDir, "t-list", "chk-1.json"), "broken", "utf-8");

    const listed: string[] = [];
    for await (const tuple of saver.list({ configurable: { thread_id: "t-list" } })) {
      listed.push(tuple.checkpoint.id);
    }
    expect(listed).toEqual(["chk-2"]);
  });
});
