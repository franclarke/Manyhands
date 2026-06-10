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
    const filePath = join(this.directory, threadId, fileName);

    try {
      const content = await readFile(filePath, "utf-8");
      const parsed = JSON.parse(content) as {
        checkpoint: Checkpoint;
        metadata: CheckpointMetadata;
        config: RunnableConfig;
        parentConfig?: RunnableConfig;
      };
      const pendingWrites = await this.readPendingWrites(threadId, parsed.checkpoint.id);
      return {
        checkpoint: parsed.checkpoint,
        metadata: parsed.metadata,
        config: parsed.config,
        ...(pendingWrites.length > 0 ? { pendingWrites } : {}),
        ...(parsed.parentConfig !== undefined ? { parentConfig: parsed.parentConfig } : {})
      };
    } catch {
      return undefined;
    }
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

    const threadDir = join(this.directory, threadId);
    let files: string[];
    try {
      files = await readdir(threadDir);
    } catch {
      return;
    }

    const checkpointFiles = files
      .filter((f) => f.endsWith(".json") && f !== "latest.json")
      .sort()
      .reverse(); // Most recent first

    for (const file of checkpointFiles) {
      const filePath = join(threadDir, file);
      try {
        const content = await readFile(filePath, "utf-8");
        const parsed = JSON.parse(content) as {
          checkpoint: Checkpoint;
          metadata: CheckpointMetadata;
          config: RunnableConfig;
          parentConfig?: RunnableConfig;
        };
        yield {
          checkpoint: parsed.checkpoint,
          metadata: parsed.metadata,
          config: parsed.config,
          ...(parsed.parentConfig !== undefined ? { parentConfig: parsed.parentConfig } : {})
        };
      } catch {
        // Skip unreadable checkpoints
      }
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
