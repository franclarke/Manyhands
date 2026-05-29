import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import { BatchScheduler } from "@manyhands/execution-core";

describe("BatchScheduler", () => {
  it("runs batches in order and collects results by taskId", async () => {
    const traceStore = new InMemoryTraceStore();
    const scheduler = new BatchScheduler({ traceStore });

    const results = await scheduler.runBatches({
      batches: [
        { id: "batch-1", taskIds: ["a", "b"] },
        { id: "batch-2", taskIds: ["c"] }
      ],
      runTask: async (taskId) => taskId.toUpperCase()
    });

    expect(results.get("a")).toBe("A");
    expect(results.get("c")).toBe("C");
    expect(traceStore.findByType("batch_started")).toHaveLength(2);
    expect(traceStore.findByType("batch_completed")).toHaveLength(2);
  });

  it("propagates a task failure and does not hang", async () => {
    const scheduler = new BatchScheduler({ traceStore: new InMemoryTraceStore() });

    await expect(
      scheduler.runBatches({
        batches: [{ id: "batch-1", taskIds: ["a", "b"] }],
        runTask: async (taskId) => {
          if (taskId === "a") throw new Error("task a blew up");
          return taskId;
        }
      })
    ).rejects.toThrow("task a blew up");
  });

  it("never exceeds maxParallel concurrent tasks within a batch", async () => {
    const scheduler = new BatchScheduler({ traceStore: new InMemoryTraceStore(), maxParallel: 2 });
    let active = 0;
    let peak = 0;

    await scheduler.runBatches({
      batches: [{ id: "batch-1", taskIds: ["a", "b", "c", "d"] }],
      runTask: async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
      }
    });

    expect(peak).toBeLessThanOrEqual(2);
  });

  it("completes a later batch only after the earlier batch finishes", async () => {
    const scheduler = new BatchScheduler({ traceStore: new InMemoryTraceStore() });
    const order: string[] = [];

    await scheduler.runBatches({
      batches: [
        { id: "batch-1", taskIds: ["a"] },
        { id: "batch-2", taskIds: ["b"] }
      ],
      runTask: async (taskId) => {
        order.push(`start-${taskId}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(`end-${taskId}`);
      }
    });

    expect(order).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });
});
