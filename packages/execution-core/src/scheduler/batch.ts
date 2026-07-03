import type { TraceStore } from "@manyhands/trace-store";

import { execLog } from "../logging/log";

export interface ExecutionBatchInput {
  id: string;
  taskIds: string[];
}

export interface BatchSchedulerDeps {
  traceStore: TraceStore;
  /** Hard cap on concurrent task execution (D9, default 3). */
  maxParallel?: number;
  now?: () => number;
}

export interface RunBatchesParams<T> {
  /** Batches in execution order; produced by scheduler.scheduleTasks. */
  batches: ExecutionBatchInput[];
  /** Runs a single task (leaf) and resolves with its result. */
  runTask: (taskId: string) => Promise<T>;
  /** Run-level cancellation: stop scheduling further batches/tasks when aborted. */
  signal?: AbortSignal;
  /** Awaited before each batch (pause hold); resolves to continue. */
  onBatchBoundary?: () => Promise<void>;
}

/**
 * Executes pre-grouped batches in order, running each batch's tasks with a
 * bounded concurrency pool capped at maxParallel (D9). Batches run
 * sequentially because later batches depend on earlier ones being resolved;
 * emits batch_started / batch_completed trace events.
 */
export class BatchScheduler {
  private readonly traceStore: TraceStore;
  private readonly maxParallel: number;
  private readonly now: () => number;

  constructor(deps: BatchSchedulerDeps) {
    this.traceStore = deps.traceStore;
    this.maxParallel = Math.max(1, deps.maxParallel ?? 3);
    this.now = deps.now ?? (() => Date.now());
  }

  async runBatches<T>(params: RunBatchesParams<T>): Promise<Map<string, T>> {
    const results = new Map<string, T>();

    const totalBatches = params.batches.length;
    for (const [index, batch] of params.batches.entries()) {
      // Batch boundary: hold here while paused, then stop if cancelled. Lets the
      // in-flight batch drain (pause) and prevents starting new work (cancel).
      await params.onBatchBoundary?.();
      if (params.signal?.aborted === true) {
        break;
      }

      execLog("batch", "batch started", {
        batch: `${index + 1}/${totalBatches}`,
        id: batch.id,
        tasks: batch.taskIds,
        concurrency: Math.min(this.maxParallel, batch.taskIds.length)
      });
      this.traceStore.append({
        type: "batch_started",
        actor: "system",
        payload: { batchId: batch.id, taskIds: batch.taskIds }
      });
      const start = this.now();

      await this.runWithConcurrency(
        batch.taskIds,
        async (taskId) => {
          results.set(taskId, await params.runTask(taskId));
        },
        params.signal
      );

      execLog("batch", "batch completed", {
        batch: `${index + 1}/${totalBatches}`,
        id: batch.id,
        tasks: batch.taskIds.length,
        durationMs: this.now() - start
      });
      this.traceStore.append({
        type: "batch_completed",
        actor: "system",
        payload: { batchId: batch.id, taskIds: batch.taskIds, durationMs: this.now() - start }
      });
    }

    return results;
  }

  private async runWithConcurrency(
    taskIds: string[],
    worker: (taskId: string) => Promise<void>,
    signal?: AbortSignal
  ): Promise<void> {
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < taskIds.length) {
        if (signal?.aborted === true) {
          return;
        }
        const index = cursor;
        cursor += 1;
        const taskId = taskIds[index];
        if (taskId !== undefined) {
          await worker(taskId);
        }
      }
    };

    const poolSize = Math.min(this.maxParallel, taskIds.length);
    await Promise.all(Array.from({ length: poolSize }, () => runNext()));
  }
}
