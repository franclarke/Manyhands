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
import { join } from "node:path";
import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";

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

    const threadDir = join(this.directory, threadId);
    await mkdir(threadDir, { recursive: true });

    const state = { checkpoint, metadata, config };
    const content = JSON.stringify(state, null, 2);

    const checkpointId = checkpoint.id;
    await writeFile(join(threadDir, `${checkpointId}.json`), content, "utf-8");
    await writeFile(join(threadDir, "latest.json"), content, "utf-8");

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

    const existing = await this.readPendingWrites(threadId, checkpointId);
    const merged: PersistedWrite[] = [
      ...existing.map(([writeTaskId, channel, value]) => ({ taskId: writeTaskId, channel, value })),
      ...writes.map(([channel, value]) => ({ taskId, channel: String(channel), value }))
    ];

    await mkdir(join(this.directory, threadId), { recursive: true });
    await writeFile(this.writesPath(threadId, checkpointId), JSON.stringify(merged, null, 2), "utf-8");
  }

  async deleteThread(threadId: string): Promise<void> {
    // Remove all checkpoints for the given thread.
    const { rm } = await import("node:fs/promises");
    const threadDir = join(this.directory, threadId);
    try {
      await rm(threadDir, { recursive: true, force: true });
    } catch {
      // Silently ignore if the thread directory doesn't exist
    }
  }
}
