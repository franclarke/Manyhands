import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_DECISION } from "@/app/api/runs/[id]/decisions/[decisionId]/route";
import { appendRunModelEvent, readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-decision-choice-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("POST /decisions/[decisionId] choice validation", () => {
  it("does not resolve a conflict decision without a resolutionId", async () => {
    await saveRunWithConflictDecision("run-conflict-choice");

    const response = await postDecision("run-conflict-choice", "resolve_conflict:root", {
      choice: { action: "approve" }
    });

    expect(response.status).toBe(400);
    const events = await readRunModelEvents("run-conflict-choice");
    expect(events.some((event) => event.type === "decision.resolved")).toBe(false);
    expect(events.some((event) => event.type === "conflict.resolved")).toBe(false);
  });

  it("resolves a conflict decision only when a concrete resolution is provided", async () => {
    await saveRunWithConflictDecision("run-conflict-resolution");

    const response = await postDecision("run-conflict-resolution", "resolve_conflict:root", {
      resolutionId: "manual-resolution-1"
    });

    expect(response.status).toBe(200);
    const events = await readRunModelEvents("run-conflict-resolution");
    expect(events.at(-2)).toMatchObject({
      type: "decision.resolved",
      payload: {
        decisionId: "resolve_conflict:root",
        choice: { resolutionId: "manual-resolution-1" }
      }
    });
    expect(events.at(-1)).toMatchObject({
      type: "conflict.resolved",
      payload: {
        conflictId: "conflict-root",
        by: "human",
        resolutionId: "manual-resolution-1"
      }
    });
  });
});

async function saveRunWithConflictDecision(runId: string): Promise<void> {
  await getRunRepository().save(makeRun(runId));
  await appendRunModelEvent(runId, {
    actor: "system",
    at: "2026-06-12T00:00:01.000Z",
    type: "conflict.detected",
    payload: {
      conflictId: "conflict-root",
      dimension: "textual",
      status: "detected",
      nodeIds: ["root"],
      files: ["src/index.ts"],
      autoResolvable: false,
      diagnosisRef: `diagnosis://runs/${runId}/integration/root`
    }
  });
  await appendRunModelEvent(runId, {
    actor: "system",
    at: "2026-06-12T00:00:02.000Z",
    type: "decision.raised",
    payload: {
      decisionId: "resolve_conflict:root",
      kind: "resolve_conflict",
      blocking: true,
      context: { nodeIds: ["root"], conflictId: "conflict-root" }
    }
  });
}

function postDecision(runId: string, decisionId: string, body: unknown): Promise<Response> {
  return POST_DECISION(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: runId, decisionId }) }
  );
}

function makeRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "Resolve a conflict",
    title: "Resolve a conflict",
    version: 0,
    status: "paused",
    pausedDuring: "running",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    patches: []
  } as RunRecord;
}
