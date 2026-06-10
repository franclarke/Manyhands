/**
 * Tests for JsonFileCheckpointSaver.
 *
 * Verifies that the checkpointer can:
 * - write and read a full checkpoint round-trip
 * - write latest.json for fast page-load restoration
 * - list checkpoints in reverse chronological order
 * - handle missing threads gracefully (return undefined)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JsonFileCheckpointSaver } from "./checkpointer.js";
import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

function makeCheckpoint(id: string): Checkpoint {
  return {
    v: 1,
    id,
    ts: new Date().toISOString(),
    channel_values: { status: "planning", runId: "test-run" },
    channel_versions: {},
    versions_seen: {},
    pending_sends: []
  };
}

function makeMetadata(): CheckpointMetadata {
  return {
    source: "loop",
    step: 1,
    writes: null,
    parents: {}
  };
}

function makeConfig(threadId: string, checkpointId?: string): RunnableConfig {
  return {
    configurable: {
      thread_id: threadId,
      ...(checkpointId !== undefined ? { checkpoint_id: checkpointId } : {})
    }
  };
}

describe("JsonFileCheckpointSaver", () => {
  let tmpDir: string;
  let saver: JsonFileCheckpointSaver;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "mh-checkpoint-test-"));
    saver = new JsonFileCheckpointSaver(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined for a non-existent thread", async () => {
    const result = await saver.getTuple(makeConfig("nonexistent"));
    expect(result).toBeUndefined();
  });

  it("writes and reads a checkpoint (latest)", async () => {
    const checkpoint = makeCheckpoint("cp-001");
    const metadata = makeMetadata();
    const config = makeConfig("thread-1");

    const returnedConfig = await saver.put(config, checkpoint, metadata);

    expect(returnedConfig.configurable?.["thread_id"]).toBe("thread-1");
    expect(returnedConfig.configurable?.["checkpoint_id"]).toBe("cp-001");

    // Read back as "latest" (no checkpoint_id in config)
    const tuple = await saver.getTuple(makeConfig("thread-1"));
    expect(tuple).toBeDefined();
    expect(tuple!.checkpoint.id).toBe("cp-001");
    expect(tuple!.metadata.step).toBe(1);
  });

  it("reads a specific checkpoint by ID", async () => {
    const cp1 = makeCheckpoint("cp-001");
    const cp2 = makeCheckpoint("cp-002");
    const config = makeConfig("thread-2");

    await saver.put(config, cp1, makeMetadata());
    await saver.put(config, cp2, makeMetadata());

    // Read specific checkpoint
    const tuple = await saver.getTuple(makeConfig("thread-2", "cp-001"));
    expect(tuple).toBeDefined();
    expect(tuple!.checkpoint.id).toBe("cp-001");
  });

  it("latest.json always reflects the most recent checkpoint", async () => {
    const config = makeConfig("thread-3");
    await saver.put(config, makeCheckpoint("cp-001"), makeMetadata());
    await saver.put(config, makeCheckpoint("cp-002"), makeMetadata());
    await saver.put(config, makeCheckpoint("cp-003"), makeMetadata());

    const latest = await saver.getTuple(makeConfig("thread-3"));
    expect(latest!.checkpoint.id).toBe("cp-003");
  });

  it("lists checkpoints in reverse chronological order", async () => {
    const config = makeConfig("thread-4");
    await saver.put(config, makeCheckpoint("cp-aaa"), makeMetadata());
    await saver.put(config, makeCheckpoint("cp-bbb"), makeMetadata());
    await saver.put(config, makeCheckpoint("cp-ccc"), makeMetadata());

    const tuples: string[] = [];
    for await (const tuple of saver.list(makeConfig("thread-4"))) {
      tuples.push(tuple.checkpoint.id);
    }

    // Should be in reverse order (most recent first)
    expect(tuples).toHaveLength(3);
    expect(tuples[0]).toBe("cp-ccc");
    expect(tuples[1]).toBe("cp-bbb");
    expect(tuples[2]).toBe("cp-aaa");
  });

  it("returns empty list for non-existent thread", async () => {
    const tuples: unknown[] = [];
    for await (const tuple of saver.list(makeConfig("nonexistent"))) {
      tuples.push(tuple);
    }
    expect(tuples).toHaveLength(0);
  });

  it("stores and preserves channel_values", async () => {
    const checkpoint = makeCheckpoint("cp-data");
    checkpoint.channel_values = {
      status: "running",
      runId: "run-123",
      leafResults: [{ taskId: "task-1", status: "success" }]
    };

    await saver.put(makeConfig("thread-5"), checkpoint, makeMetadata());
    const tuple = await saver.getTuple(makeConfig("thread-5"));

    expect(tuple!.checkpoint.channel_values["status"]).toBe("running");
    expect(tuple!.checkpoint.channel_values["runId"]).toBe("run-123");
  });
});
