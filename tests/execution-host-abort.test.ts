/**
 * INV-2 — the execution drive loop is abort-aware: when the run's AbortSignal
 * fires, the stream is cut between supersteps (the checkpoint of the last
 * completed superstep is already persisted by LangGraph) and the outcome is
 * `aborted`, never a bogus `failed`.
 */
import { describe, expect, it } from "vitest";
import { driveExecution, type ExecutionHost } from "@/lib/server/runs/execution-host";

function fakeHost(totalChunks: number, onPulled: (n: number) => void): ExecutionHost {
  let pulled = 0;
  let returned = false;
  const stream = {
    async *[Symbol.asyncIterator]() {
      while (pulled < totalChunks && !returned) {
        pulled += 1;
        onPulled(pulled);
        yield { step: pulled };
      }
    },
    return: async () => {
      returned = true;
      return { done: true, value: undefined };
    }
  };
  return {
    graph: {
      stream: async () => stream,
      getState: async () => ({ tasks: [], values: { status: "completed" } })
    },
    threadConfig: { configurable: { thread_id: "run-abort" } },
    taskGraph: {}
  } as unknown as ExecutionHost;
}

describe("driveExecution abort awareness", () => {
  it("cuts the stream and returns aborted when the signal fires mid-drive", async () => {
    const controller = new AbortController();
    let chunksSeen = 0;
    const host = fakeHost(100, (n) => {
      chunksSeen = n;
      if (n === 3) controller.abort();
    });

    const outcome = await driveExecution(host, null, controller.signal);
    expect(outcome).toEqual({ kind: "aborted" });
    // The loop stopped at the abort, not after draining all 100 supersteps.
    expect(chunksSeen).toBeLessThanOrEqual(4);
  });

  it("finishes normally when the signal never fires", async () => {
    const controller = new AbortController();
    const host = fakeHost(3, () => undefined);
    const outcome = await driveExecution(host, null, controller.signal);
    expect(outcome).toEqual({ kind: "finished", status: "completed" });
  });

  it("returns aborted when the signal was already fired before the drive", async () => {
    const controller = new AbortController();
    controller.abort();
    // Zero chunks: the post-loop signal check still reports aborted.
    const host = fakeHost(0, () => undefined);
    const outcome = await driveExecution(host, null, controller.signal);
    expect(outcome).toEqual({ kind: "aborted" });
  });
});
