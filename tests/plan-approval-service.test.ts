import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendRunModelEvent,
  ensureRunModelEventLogForRun,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { processPlanApproval } from "@/lib/server/runs/plan-approval-service";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-plan-approval-"));
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

describe("processPlanApproval", () => {
  it("records the approve_plan decision resolution for manual and automatic approvals", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "needs_review" }));
    await appendRunModelEvent("run-approve", {
      actor: "system",
      at: "2026-06-16T00:00:01.000Z",
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["leaf-a"] }
      }
    });

    await processPlanApproval("run-approve", true);

    const events = await readRunModelEvents("run-approve");
    expect(events.at(-1)).toMatchObject({
      actor: "human",
      type: "decision.resolved",
      payload: {
        decisionId: "approve_plan",
        choice: { action: "approve" },
        actor: "human"
      }
    });
    await expect(repo.get("run-approve")).resolves.toMatchObject({ status: "approved" });
  });

  it("backfills a missing approve_plan resolution when an existing log predates the fix", async () => {
    const repo = getRunRepository();
    await repo.save(
      makeRun({
        status: "failed",
        failedDuring: "running",
        approvedAt: "2026-06-16T00:00:02.000Z"
      })
    );
    await appendRunModelEvent("run-approve", {
      actor: "system",
      at: "2026-06-16T00:00:01.000Z",
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["leaf-a"] }
      }
    });

    const events = await ensureRunModelEventLogForRun(await repo.get("run-approve"));

    expect(events.at(-1)).toMatchObject({
      at: "2026-06-16T00:00:02.000Z",
      actor: "human",
      type: "decision.resolved",
      payload: { decisionId: "approve_plan", choice: { action: "approve" } }
    });
  });
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-approve",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-flash",
    userPrompt: "Build feature",
    title: "Build feature",
    version: 0,
    status: "created",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    patches: [],
    ...overrides
  };
}
