import type { TraceStore } from "@manyhands/trace-store";

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

    for (const batch of params.batches) {
      this.traceStore.append({
        type: "batch_started",
        actor: "system",
        payload: { batchId: batch.id, taskIds: batch.taskIds }
      });
      const start = this.now();

      await this.runWithConcurrency(batch.taskIds, async (taskId) => {
        results.set(taskId, await params.runTask(taskId));
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
    worker: (taskId: string) => Promise<void>
  ): Promise<void> {
    let cursor = 0;
    const runNext = async (): Promise<void> => {
      while (cursor < taskIds.length) {
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
