/**
 * INV-2 — the execution drive loop is abort-aware: when the run's AbortSignal
 * fires, the stream is cut between supersteps (the checkpoint of the last
 * completed superstep is already persisted by LangGraph) and the outcome is
 * `aborted`, never a bogus `failed`.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { driveExecution, type ExecutionHost } from "@/lib/server/runs/execution-host";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-exec-host-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function fakeHost(totalChunks: number, onPulled: (n: number) => void, runId = "run-abort"): ExecutionHost {
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
    threadConfig: { configurable: { thread_id: runId } },
    taskGraph: {}
  } as unknown as ExecutionHost;
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-abort",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "created",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    patches: [],
    ...overrides
  };
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

  it("holds between stream chunks while the run is plain-paused", async () => {
    const runId = "run-drive-paused";
    await getRunRepository().save(makeRun({ runId, status: "paused", pausedDuring: "running" }));
    const pulled: number[] = [];
    const host = fakeHost(2, (n) => pulled.push(n), runId);

    const drive = driveExecution(host, null);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(pulled).toEqual([1]);

    await getRunRepository().update(runId, (current) => {
      const next = { ...current, status: "running" as const };
      delete next.pausedDuring;
      return next;
    });

    const outcome = await drive;
    expect(pulled).toEqual([1, 2]);
    expect(outcome).toEqual({ kind: "finished", status: "completed" });
  });
});
