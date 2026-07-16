/**
 * JsonFileCheckpointSaver — custom LangGraph checkpoint saver.
 *
 * Persists StateGraph checkpoints as JSON files on the local filesystem,
 * next to run records. Layout:
 *
 *   <directory>/<thread_id>/latest.json       — always the most recent state
 *   <directory>/<thread_id>/<checkpoint_id>.json — immutable per-checkpoint snapshot
 *
 * This keeps database dependencies to zero while enabling:
 *   - page-load restoration: read latest.json without replaying events
 *   - time-travel (forking): clone any <checkpoint_id>.json to a new thread
 *
 * Design: docs/design/langgraph-orchestrator-design.md §5
 */
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type {
  Checkpoint,
  CheckpointMetadata,
  CheckpointTuple,
  CheckpointListOptions,
  ChannelVersions,
  PendingWrite,
  CheckpointPendingWrite
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { open, readFile, mkdir, readdir, rename, rm } from "node:fs/promises";

interface PersistedWrite {
  taskId: string;
  channel: string;
  value: unknown;
}

interface PersistedCheckpointFile {
  checkpoint: Checkpoint;
  metadata: CheckpointMetadata;
  config: RunnableConfig;
  parentConfig?: RunnableConfig;
}

interface PendingWriteWaiter {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PendingWriteBatch {
  entries: Map<string, PersistedWrite>;
  waiters: PendingWriteWaiter[];
  flushing: boolean;
}

/**
 * Health of a thread's persisted checkpoints, used by the hosts to surface
 * corruption instead of silently re-entering from scratch (INV-3):
 *  - ok: latest.json is readable.
 *  - degraded: latest.json is corrupt but an older immutable checkpoint is
 *    valid — resuming uses that one and the host should warn.
 *  - lost: checkpoint files exist but NONE is readable.
 *  - missing: the thread was never checkpointed.
 */
export type ThreadCheckpointHealth =
  | { status: "missing" }
  | { status: "ok"; checkpointId: string }
  | { status: "degraded"; checkpointId: string; corrupted: string[] }
  | { status: "lost"; corrupted: string[] };

export class JsonFileCheckpointSaver extends BaseCheckpointSaver {
  private static readonly writeChains = new Map<string, Promise<unknown>>();
  private static readonly pendingWriteBatches = new Map<string, PendingWriteBatch>();
  private readonly directory: string;

  constructor(directory: string) {
    super();
    this.directory = directory;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.["thread_id"] as string | undefined;
    if (!threadId) return undefined;

    const checkpointId = config.configurable?.["checkpoint_id"] as string | undefined;
    const fileName = checkpointId ? `${checkpointId}.json` : "latest.json";

    const parsed = await this.readCheckpointFile(join(this.directory, threadId, fileName));
    if (parsed === "missing") return undefined;
    if (parsed !== "corrupt") return this.toTuple(threadId, parsed);

    // An explicitly requested checkpoint that is corrupt has no substitute.
    if (checkpointId !== undefined) return undefined;

    // latest.json is corrupt (torn write on crash, disk full): fall back to the
    // newest valid immutable checkpoint instead of silently restarting the
    // thread from scratch. inspectThread() reports this as "degraded".
    const fallback = await this.newestValidCheckpoint(threadId);
    return fallback === undefined ? undefined : this.toTuple(threadId, fallback.parsed);
  }

  /** Validate a thread's checkpoints without loading them into a graph. */
  async inspectThread(threadId: string): Promise<ThreadCheckpointHealth> {
    const latest = await this.readCheckpointFile(join(this.directory, threadId, "latest.json"));
    if (latest !== "missing" && latest !== "corrupt") {
      return { status: "ok", checkpointId: latest.checkpoint.id };
    }
    const files = await this.checkpointFileNames(threadId);
    if (latest === "missing" && files.length === 0) {
      return { status: "missing" };
    }
    const corrupted: string[] = latest === "corrupt" ? ["latest.json"] : [];
    for (const file of files) {
      const parsed = await this.readCheckpointFile(join(this.directory, threadId, file));
      if (parsed !== "missing" && parsed !== "corrupt") {
        return { status: "degraded", checkpointId: parsed.checkpoint.id, corrupted };
      }
      corrupted.push(file);
    }
    return { status: "lost", corrupted };
  }

  private async toTuple(threadId: string, parsed: PersistedCheckpointFile): Promise<CheckpointTuple> {
    const pendingWrites = await this.readPendingWrites(threadId, parsed.checkpoint.id);
    return {
      checkpoint: parsed.checkpoint,
      metadata: parsed.metadata,
      config: parsed.config,
      ...(pendingWrites.length > 0 ? { pendingWrites } : {}),
      ...(parsed.parentConfig !== undefined ? { parentConfig: parsed.parentConfig } : {})
    };
  }

  /**
   * Read and shape-check one checkpoint file. ENOENT is a legitimately missing
   * checkpoint ("missing"); any parse/shape/IO failure is "corrupt" — callers
   * decide whether to fall back or surface it.
   */
  private async readCheckpointFile(filePath: string): Promise<PersistedCheckpointFile | "missing" | "corrupt"> {
    let content: string;
    try {
      content = await readFile(filePath, "utf-8");
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "corrupt";
    }
    try {
      const parsed = JSON.parse(content) as Partial<PersistedCheckpointFile>;
      if (typeof parsed?.checkpoint?.id !== "string" || parsed.metadata === undefined || parsed.config === undefined) {
        return "corrupt";
      }
      return parsed as PersistedCheckpointFile;
    } catch {
      return "corrupt";
    }
  }

  private async checkpointFileNames(threadId: string): Promise<string[]> {
    try {
      const files = await readdir(join(this.directory, threadId));
      return files
        .filter((f) => f.endsWith(".json") && f !== "latest.json" && !f.endsWith(".writes.json"))
        .sort()
        .reverse(); // Most recent first
    } catch {
      return [];
    }
  }

  private async newestValidCheckpoint(
    threadId: string
  ): Promise<{ file: string; parsed: PersistedCheckpointFile } | undefined> {
    for (const file of await this.checkpointFileNames(threadId)) {
      const parsed = await this.readCheckpointFile(join(this.directory, threadId, file));
      if (parsed !== "missing" && parsed !== "corrupt") {
        return { file, parsed };
      }
    }
    return undefined;
  }

  private async readPendingWrites(threadId: string, checkpointId: string): Promise<CheckpointPendingWrite[]> {
    try {
      const content = await readFile(this.writesPath(threadId, checkpointId), "utf-8");
      const parsed = JSON.parse(content) as PersistedWrite[];
      return parsed.map((write) => [write.taskId, write.channel, write.value]);
    } catch {
      return [];
    }
  }

  private writesPath(threadId: string, checkpointId: string): string {
    return join(this.directory, threadId, `${checkpointId}.writes.json`);
  }

  async *list(
    config: RunnableConfig,
    _options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.["thread_id"] as string | undefined;
    if (!threadId) return;

    for (const file of await this.checkpointFileNames(threadId)) {
      const parsed = await this.readCheckpointFile(join(this.directory, threadId, file));
      if (parsed === "missing" || parsed === "corrupt") {
        continue; // Skip unreadable checkpoints
      }
      yield {
        checkpoint: parsed.checkpoint,
        metadata: parsed.metadata,
        config: parsed.config,
        ...(parsed.parentConfig !== undefined ? { parentConfig: parsed.parentConfig } : {})
      };
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions
  ): Promise<RunnableConfig> {
    const threadId = config.configurable?.["thread_id"] as string | undefined;
    if (!threadId) {
      throw new Error("JsonFileCheckpointSaver.put: missing thread_id in config.configurable");
    }

    const checkpointId = checkpoint.id;
    const threadDir = join(this.directory, threadId);
    await this.withWriteLock(`thread:${threadId}`, async () => {
      await mkdir(threadDir, { recursive: true });
      await cleanupTempFiles(threadDir);

      const state = { checkpoint, metadata, config };
      const content = JSON.stringify(state, null, 2);
      await atomicWriteText(join(threadDir, `${checkpointId}.json`), content);
      await atomicWriteText(join(threadDir, "latest.json"), content);
    });

    return {
      configurable: { thread_id: threadId, checkpoint_id: checkpointId }
    };
  }

  /**
   * Persist pending writes for the checkpoint's in-flight superstep. Required
   * for cross-process HITL resume: the interrupt marker and the outputs of
   * sibling parallel tasks that finished before the interrupt live here, so a
   * Command({ resume }) from a fresh process replays nothing.
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    const threadId = config.configurable?.["thread_id"] as string | undefined;
    const checkpointId = config.configurable?.["checkpoint_id"] as string | undefined;
    if (!threadId || !checkpointId) {
      throw new Error("JsonFileCheckpointSaver.putWrites: missing thread_id or checkpoint_id");
    }
    if (writes.length === 0) return;

    const batchKey = `${this.directory}\0${threadId}\0${checkpointId}`;
    let batch = JsonFileCheckpointSaver.pendingWriteBatches.get(batchKey);
    if (batch === undefined) {
      batch = { entries: new Map(), waiters: [], flushing: false };
      JsonFileCheckpointSaver.pendingWriteBatches.set(batchKey, batch);
    }
    for (const [channelValue, value] of writes) {
      const channel = String(channelValue);
      batch.entries.set(pendingWriteKey(taskId, channel), { taskId, channel, value });
    }

    const persisted = new Promise<void>((resolve, reject) => {
      batch!.waiters.push({ resolve, reject });
    });
    if (!batch.flushing) {
      batch.flushing = true;
      // Queue the flush in the thread write chain synchronously. This preserves
      // call order with put()/deleteThread(), while Promise.all callers in the
      // same turn coalesce before the lock callback starts. Calls arriving
      // during IO join the next iteration under the same lock.
      void this.flushPendingWriteBatch(batchKey, threadId, checkpointId, batch);
    }
    return persisted;
  }

  private async flushPendingWriteBatch(
    batchKey: string,
    threadId: string,
    checkpointId: string,
    batch: PendingWriteBatch
  ): Promise<void> {
    try {
      await this.withWriteLock(`thread:${threadId}`, async () => {
        const threadDir = join(this.directory, threadId);
        await mkdir(threadDir, { recursive: true });
        await cleanupTempFiles(threadDir);

        while (batch.entries.size > 0) {
          const pending = batch.entries;
          const waiters = batch.waiters;
          batch.entries = new Map();
          batch.waiters = [];

          const existing = await this.readPendingWrites(threadId, checkpointId);
          const merged = new Map<string, PersistedWrite>();
          for (const [writeTaskId, channel, value] of existing) {
            merged.set(pendingWriteKey(writeTaskId, channel), { taskId: writeTaskId, channel, value });
          }
          for (const [key, write] of pending) merged.set(key, write);

          try {
            await atomicWriteText(
              this.writesPath(threadId, checkpointId),
              JSON.stringify(Array.from(merged.values()), null, 2)
            );
            for (const waiter of waiters) waiter.resolve();
          } catch (error) {
            for (const waiter of waiters) waiter.reject(error);
            throw error;
          }
        }
      });
    } catch (error) {
      // Reject callers that joined while the failed disk operation was in
      // flight. No caller observes success before its batch reaches disk.
      for (const waiter of batch.waiters) waiter.reject(error);
      batch.entries.clear();
      batch.waiters = [];
    } finally {
      batch.flushing = false;
      // A caller can join after the write-lock operation resolves but before
      // this continuation runs. Re-arm instead of deleting that late batch.
      if (batch.entries.size > 0) {
        batch.flushing = true;
        void this.flushPendingWriteBatch(batchKey, threadId, checkpointId, batch);
        return;
      }
      if (JsonFileCheckpointSaver.pendingWriteBatches.get(batchKey) === batch) {
        JsonFileCheckpointSaver.pendingWriteBatches.delete(batchKey);
      }
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    const threadDir = join(this.directory, threadId);
    await this.withWriteLock(`thread:${threadId}`, async () => {
      await rm(threadDir, { recursive: true, force: true });
    });
  }

  private withWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const lockKey = `${this.directory}\0${key}`;
    const previous = JsonFileCheckpointSaver.writeChains.get(lockKey) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    const tail = next.catch(() => undefined);
    JsonFileCheckpointSaver.writeChains.set(lockKey, tail);
    return next.finally(() => {
      if (JsonFileCheckpointSaver.writeChains.get(lockKey) === tail) {
        JsonFileCheckpointSaver.writeChains.delete(lockKey);
      }
    });
  }
}

function pendingWriteKey(taskId: string, channel: string): string {
  return `${taskId}\0${channel}`;
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(content, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, filePath);
  } finally {
    await handle?.close().catch(() => undefined);
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function cleanupTempFiles(directory: string): Promise<void> {
  let files: string[];
  try {
    files = await readdir(directory);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((file) => file.endsWith(".tmp"))
      .map((file) => rm(join(directory, file), { force: true }).catch(() => undefined))
  );
}
