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
import { compileGraphRevision } from "@manyhands/decomposer";
import type { RunEventInput } from "@manyhands/run-coordinator";
import { JsonlRunEventStore } from "@manyhands/run-store";
import { GET as GET_RUN_EVENTS } from "@/app/api/runs/[id]/run-events/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { buildRunModel } from "@/lib/run-model/reducer";
import type { RunEvent, RunSeed } from "@/lib/run-model/types";
import type { RunRecord } from "@/lib/server/runs/schema";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

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
  return makeRunRecordV2({ runId });
}

function seedFor(runId: string): RunSeed {
  return {
    id: runId,
    title: "Add login",
    goal: "Add login",
    lifecycle: "planning",
    eventSequence: 0
  };
}

async function seedEvents(runId: string, count: number): Promise<void> {
  await getRunRepository().save(makeRun(runId));
  const snapshot = bookingSnapshot();
  const breakdown = bookingBreakdown();
  const compiled = compileGraphRevision({ breakdown, repositorySnapshot: snapshot }, compilerDependencies);
  const decisionId = `approve-plan:${compiled.graph.graphId}:r${compiled.graph.revision}`;
  const at = "2026-07-17T12:00:00.000Z";
  const inputs: RunEventInput[] = [
    { eventId: "run-created", occurredAt: at, type: "run.created", payload: { goal: "Add login" } },
    { eventId: "repository-inspected", occurredAt: at, type: "repository.inspected", payload: { snapshotId: snapshot.snapshotId, disposition: snapshot.inspectionDisposition, snapshot: snapshot as unknown as Record<string, unknown> } },
    { eventId: "planning-completed", occurredAt: at, type: "planning.completed", payload: { breakdownId: breakdown.breakdownId, breakdown: breakdown as unknown as Record<string, unknown> } },
    { eventId: "graph-compiled", occurredAt: at, type: "graph.compiled", payload: { graphId: compiled.graph.graphId, revision: compiled.graph.revision, graph: compiled.graph as unknown as Record<string, unknown>, contracts: compiled.contracts as unknown as Array<Record<string, unknown>>, review: compiled.review as unknown as Record<string, unknown>, trace: compiled.trace as unknown as Record<string, unknown> } },
    { eventId: "critic-recorded", occurredAt: at, type: "planning.critic_recorded", payload: { critic: "completeness", findings: [] } },
    { eventId: "revision-proposed", occurredAt: at, type: "graph.revision.proposed", payload: { graphId: compiled.graph.graphId, revision: compiled.graph.revision } },
    { eventId: decisionId, occurredAt: at, type: "decision.raised", payload: { decision: { id: decisionId, kind: "approve_plan", question: "Approve?", options: [{ id: "approve", label: "Approve" }, { id: "request_changes", label: "Request changes" }], affectedNodeIds: [compiled.graph.rootId], evidenceRefs: ["graph-compiled"], impact: "acceptance" } } },
    { eventId: `${decisionId}:resolved`, occurredAt: at, type: "decision.resolved", payload: { decisionId, optionId: "approve" } }
  ];
  const store = new JsonlRunEventStore({ ...(process.env.MANYHANDS_RUNS_DIR ? { directory: process.env.MANYHANDS_RUNS_DIR } : {}) });
  const authority = { operationId: "11111111-1111-4111-8111-111111111111", fencingToken: 1 };
  await store.advanceFence(runId, authority);
  await store.appendFenced(runId, 0, authority, inputs.slice(0, count));
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

async function readFirstChunk(
  runId: string,
  options: { after?: number; timeoutMs?: number } = {}
): Promise<string> {
  const url = `http://mh.test/api/runs/${runId}/run-events${options.after !== undefined ? `?after=${options.after}` : ""}`;
  const response = await GET_RUN_EVENTS(new Request(url), {
    params: Promise.resolve({ id: runId })
  });
  expect(response.status).toBe(200);

  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const timeoutMs = options.timeoutMs ?? 500;
  try {
    const read = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`SSE did not produce an initial chunk within ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
    return new TextDecoder().decode(read.value);
  } finally {
    await reader.cancel();
  }
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

  it("flushes an initial comment when the cursor is already at the latest event", async () => {
    await seedEvents("run-sse-caught-up", 3);

    const firstChunk = await readFirstChunk("run-sse-caught-up", { after: 3 });

    expect(firstChunk).toContain(": connected ");
    expect(firstChunk).not.toContain("data: ");
  });

  it("INV-7: prefix + reconnect-replayed suffix folds to the same model as one uninterrupted stream", async () => {
    const runId = "run-sse-equiv";
    await seedEvents(runId, 8);

    const uninterrupted = await readFrames(runId, { expected: 8 });
    const prefix = await readFrames(runId, { expected: 3 }); // "connection dropped" after 3
    const suffix = await readFrames(runId, { lastEventId: 3, expected: 5 });

    const seed = seedFor(runId);
    const continuous = buildRunModel(seed, uninterrupted.map((f) => f.event));
    const stitched = buildRunModel(seed, [...prefix, ...suffix].map((f) => f.event));

    expect([...prefix, ...suffix].map((f) => f.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(stitched.run.eventSequence).toBe(continuous.run.eventSequence);
    expect(stitched.nodes).toEqual(continuous.nodes);
    // Even a FULL overlap (replay from zero after a gap) folds identically —
    // the reducer is cursor-idempotent.
    const overlapped = buildRunModel(seed, [...uninterrupted, ...uninterrupted].map((f) => f.event));
    expect(overlapped.run.eventSequence).toBe(continuous.run.eventSequence);
    expect(overlapped.nodes).toEqual(continuous.nodes);
  });
});
