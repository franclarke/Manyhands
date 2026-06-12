/**
 * INV-7 — SSE replay never loses nor duplicates events.
 *
 * Drives the REAL /api/runs/[id]/run-events handler over a persisted event
 * log: frames carry `id: <seq>`, reconnection with Last-Event-ID (or ?after=)
 * replays exactly the missing suffix, and folding [prefix + replayed suffix]
 * produces the same model as one uninterrupted stream.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as GET_RUN_EVENTS } from "@/app/api/runs/[id]/run-events/route";
import { appendRunModelEvent } from "@/lib/server/runs/run-model-event-log";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import type { Run, RunEvent } from "@/lib/run-model/types";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-sse-"));
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

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "running",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    patches: []
  };
}

function seedFor(runId: string): Run {
  return {
    id: runId,
    intent: "Add login",
    config: { granularity: "balanced", model: "gemini-2.5-pro" },
    createdAt: "2026-06-12T00:00:00.000Z"
  } as unknown as Run;
}

async function seedEvents(runId: string, count: number): Promise<void> {
  await getRunRepository().save(makeRun(runId));
  await appendRunModelEvent(runId, { actor: "system", at: new Date().toISOString(), type: "plan.started", payload: {} });
  for (let i = 1; i < count; i += 1) {
    await appendRunModelEvent(runId, {
      actor: "system",
      at: new Date().toISOString(),
      type: "plan.node.proposed",
      payload: { nodeId: `node-${i}`, parentId: null, title: `Node ${i}`, goal: `goal ${i}`, depth: 1, role: "leaf" as const }
    });
  }
}

/** Read SSE frames from the handler until `expected` data events arrive. */
async function readFrames(
  runId: string,
  options: { after?: number; lastEventId?: number; expected: number }
): Promise<Array<{ id: number; event: RunEvent }>> {
  const url = `http://mh.test/api/runs/${runId}/run-events${options.after !== undefined ? `?after=${options.after}` : ""}`;
  const headers = new Headers();
  if (options.lastEventId !== undefined) headers.set("Last-Event-ID", String(options.lastEventId));
  const response = await GET_RUN_EVENTS(new Request(url, { headers }), {
    params: Promise.resolve({ id: runId })
  });
  expect(response.status).toBe(200);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const frames: Array<{ id: number; event: RunEvent }> = [];
  while (frames.length < options.expected) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const idLine = frame.split("\n").find((line) => line.startsWith("id: "));
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (idLine !== undefined && dataLine !== undefined) {
        frames.push({ id: Number(idLine.slice(4)), event: JSON.parse(dataLine.slice(6)) as RunEvent });
      }
    }
  }
  await reader.cancel();
  return frames;
}

describe("run-events SSE replay (INV-7)", () => {
  it("frames carry id: <seq> and a fresh connection replays the full log", async () => {
    await seedEvents("run-sse-full", 5);
    const frames = await readFrames("run-sse-full", { expected: 5 });
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3, 4, 5]);
    for (const frame of frames) {
      expect(frame.event.seq).toBe(frame.id);
    }
  });

  it("Last-Event-ID resumes exactly after the last folded frame", async () => {
    await seedEvents("run-sse-lei", 6);
    const frames = await readFrames("run-sse-lei", { lastEventId: 4, expected: 2 });
    expect(frames.map((f) => f.id)).toEqual([5, 6]);
  });

  it("the higher of ?after= and Last-Event-ID wins", async () => {
    await seedEvents("run-sse-max", 6);
    const frames = await readFrames("run-sse-max", { after: 2, lastEventId: 5, expected: 1 });
    expect(frames.map((f) => f.id)).toEqual([6]);
  });

  it("INV-7: prefix + reconnect-replayed suffix folds to the same model as one uninterrupted stream", async () => {
    const runId = "run-sse-equiv";
    await seedEvents(runId, 8);

    const uninterrupted = await readFrames(runId, { expected: 8 });
    const prefix = await readFrames(runId, { expected: 3 }); // "connection dropped" after 3
    const suffix = await readFrames(runId, { lastEventId: 3, expected: 5 });

    const seed = seedFor(runId);
    const continuous = reduceRunEvents(createInitialRunModel(seed), uninterrupted.map((f) => f.event));
    const stitched = reduceRunEvents(
      createInitialRunModel(seed),
      [...prefix, ...suffix].map((f) => f.event)
    );

    expect([...prefix, ...suffix].map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stitched.cursor).toBe(continuous.cursor);
    expect(stitched.nodes.size).toBe(continuous.nodes.size);
    // Even a FULL overlap (replay from zero after a gap) folds identically —
    // the reducer is cursor-idempotent.
    const overlapped = reduceRunEvents(
      createInitialRunModel(seed),
      [...uninterrupted, ...uninterrupted].map((f) => f.event)
    );
    expect(overlapped.cursor).toBe(continuous.cursor);
    expect(overlapped.nodes.size).toBe(continuous.nodes.size);
  });
});
