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
  PendingWrite
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import { join } from "node:path";
import { writeFile, readFile, mkdir, readdir } from "node:fs/promises";

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
      return {
        checkpoint: parsed.checkpoint,
        metadata: parsed.metadata,
        config: parsed.config,
        ...(parsed.parentConfig !== undefined ? { parentConfig: parsed.parentConfig } : {})
      };
    } catch {
      return undefined;
    }
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

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    // Pending writes are ephemeral; we don't need to persist them separately
    // since the full checkpoint is written on each put() call.
    void config;
    void writes;
    void taskId;
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
