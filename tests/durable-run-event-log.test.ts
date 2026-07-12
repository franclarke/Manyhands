import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRunModelEvent,
  ensureRunModelEventLogForRun,
  inspectRunModelEventLog,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-durable-events-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = tempDir;
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe("B-018 durable run event log", () => {
  it("preserves the valid prefix, repairs a trailing partial line, and continues with the next sequence", async () => {
    const runId = "run-tail";
    await appendRunModelEvent(runId, { actor: "system", type: "plan.started", payload: {} });
    await appendFile(path.join(tempDir, `${runId}.events.jsonl`), "{\"seq\":2", "utf8");

    expect((await inspectRunModelEventLog(runId)).status).toBe("degraded");
    expect((await readRunModelEvents(runId)).map((event) => event.seq)).toEqual([1]);
    const appended = await appendRunModelEvent(runId, { actor: "system", type: "plan.completed", payload: {} });
    expect(appended.seq).toBe(2);
    expect((await readRunModelEvents(runId)).map((event) => event.seq)).toEqual([1, 2]);
  });

  it("does not append over a checksum-corrupt middle record", async () => {
    const runId = "run-corrupt";
    await appendRunModelEvent(runId, { actor: "system", type: "plan.started", payload: {} });
    await appendRunModelEvent(runId, { actor: "system", type: "plan.completed", payload: {} });
    const file = path.join(tempDir, `${runId}.events.jsonl`);
    const lines = (await readFile(file, "utf8")).trim().split("\n");
    const damaged = JSON.parse(lines[1]!) as Record<string, unknown>;
    damaged.checksum = "bad";
    await writeFile(file, `${lines[0]}\n${JSON.stringify(damaged)}\n`, "utf8");

    const inspected = await inspectRunModelEventLog(runId);
    expect(inspected.status).toBe("corrupt");
    expect(inspected.events.map((event) => event.seq)).toEqual([1]);
    await expect(appendRunModelEvent(runId, { actor: "system", type: "plan.started", payload: {} })).rejects.toThrow(
      /corrupt/i
    );
  });

  it("deduplicates by eventId and serializes concurrent appends", async () => {
    const runId = "run-idempotent";
    const first = await appendRunModelEvent(runId, {
      eventId: "event-once",
      actor: "system",
      type: "plan.started",
      payload: {}
    });
    const duplicate = await appendRunModelEvent(runId, {
      eventId: "event-once",
      actor: "system",
      type: "plan.started",
      payload: {}
    });
    expect(duplicate.seq).toBe(first.seq);

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        appendRunModelEvent(runId, {
          eventId: `event-${index}`,
          actor: "system",
          type: "plan.node.proposed",
          payload: { nodeId: `n-${index}`, parentId: null, title: "n", goal: "g", depth: 1, role: "leaf" }
        })
      )
    );
    const events = await readRunModelEvents(runId);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 13 }, (_, index) => index + 1));
    expect(new Set(events.map((event) => event.eventId)).size).toBe(13);
  });

  it("reads legacy flat JSONL records", async () => {
    const runId = "run-legacy";
    await writeFile(
      path.join(tempDir, `${runId}.events.jsonl`),
      `${JSON.stringify({ seq: 1, at: "2026-07-12T00:00:00.000Z", runId, actor: "system", type: "plan.started", payload: {} })}\n`,
      "utf8"
    );
    const inspected = await inspectRunModelEventLog(runId);
    expect(inspected.status).toBe("ok");
    expect(inspected.events[0]).toMatchObject({ seq: 1, type: "plan.started" });
  });

  it("reconciles a required approval fact saved before its event append exactly once", async () => {
    const runId = "run-outbox";
    await appendRunModelEvent(runId, {
      actor: "system",
      type: "decision.raised",
      payload: { decisionId: "approve_plan", kind: "approve_plan", blocking: true, context: { nodeIds: ["root"] } }
    });
    const run: RunRecord = {
      runId,
      workspaceId: "ws",
      granularity: "balanced",
      model: "claude-sonnet",
      userPrompt: "test",
      title: "test",
      version: 4,
      status: "approved",
      createdAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:01.000Z",
      approvedAt: "2026-07-12T00:00:01.000Z",
      patches: []
    };
    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);
    const resolutions = (await readRunModelEvents(runId)).filter((event) => event.type === "decision.resolved");
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({ decisionId: "approve_plan" });
  });
});
