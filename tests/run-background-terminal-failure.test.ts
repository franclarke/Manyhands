import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { foldRun } from "@manyhands/run-coordinator";
import { JsonlRunEventStore } from "@manyhands/run-store";
import {
  drainAllRunBackgroundTasksForTests,
  startRunBackgroundTask
} from "@/lib/server/runs/runner-state";
import { markRunFailedAfterBackgroundTask } from "@/lib/server/runs/v2/background-failure";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-background-failure-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  resetRunRepositoryForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true });
});

async function seedPlanningRun(runId: string): Promise<void> {
  await getRunRepository().save(makeRunRecordV2({ runId, lifecycle: "planning" }));
  const events = new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR });
  const authority = await events.claimAuthority(runId, `${runId}:seed`, 0);
  await events.appendFenced(runId, 0, authority, [{
    eventId: `${runId}:created`,
    occurredAt: "2026-07-30T00:00:00.000Z",
    type: "run.created",
    payload: { goal: "Build the requested feature" }
  }]);
}

describe("background task terminal lifecycle", () => {
  it("persists a terminal failure when an executor task exits without a result", async () => {
    const runId = "run-executor-exit";
    await seedPlanningRun(runId);

    startRunBackgroundTask(
      runId,
      "executor-v2",
      async () => { throw new Error("executor exited without a candidate"); },
      (error) => markRunFailedAfterBackgroundTask(runId, error, "execution")
    );

    await drainAllRunBackgroundTasksForTests();

    const state = foldRun(await new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR }).load(runId));
    expect(state.lifecycle).toBe("failed");
    expect(state.failureReason).toContain("executor exited without a candidate");
  });

  it("leaves a genuine pending decision waiting for operator input", async () => {
    const runId = "run-pending-decision";
    await seedPlanningRun(runId);
    const events = new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR });
    const authority = await events.claimAuthority(runId, `${runId}:decision`, 1);
    await events.appendFenced(runId, 1, authority, [{
      eventId: `${runId}:decision`,
      occurredAt: "2026-07-30T00:00:01.000Z",
      type: "decision.raised",
      payload: {
        decision: {
          id: "decision-operator-input",
          kind: "clarify_goal",
          question: "Which persistence policy should be used?",
          options: [
            { id: "json", label: "JSON" },
            { id: "sqlite", label: "SQLite" }
          ],
          affectedNodeIds: ["node-root"],
          evidenceRefs: ["work-question:persistence"],
          impact: "architecture"
        }
      }
    }]);

    startRunBackgroundTask(
      runId,
      "planner-after-decision",
      async () => { throw new Error("planner stopped while decision was pending"); },
      (error) => markRunFailedAfterBackgroundTask(runId, error, "domain")
    );

    await drainAllRunBackgroundTasksForTests();

    const state = foldRun(await events.load(runId));
    expect(state.lifecycle).toBe("planning");
    expect(state.decisions["decision-operator-input"]?.status).toBe("pending");
    expect((await events.load(runId)).some((event) => event.type === "run.failed")).toBe(false);
  });

  it("does not take over a fresh operation when a stale handler reports failure", async () => {
    const runId = "run-fresh-operation";
    await seedPlanningRun(runId);
    const events = new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR });
    const operationId = "00000000-0000-0000-0000-000000000027";
    const authority = await events.claimAuthority(runId, operationId, 1);
    await getRunRepository().update(runId, (current) => ({
      ...current,
      mutationFence: authority.fencingToken,
      activeOperation: {
        operationId,
        kind: "planning",
        fencingToken: authority.fencingToken,
        acquiredAt: "2026-07-30T00:00:02.000Z",
        heartbeatAt: new Date().toISOString()
      }
    }));

    await markRunFailedAfterBackgroundTask(runId, new Error("late stale handler"), "domain");

    const state = foldRun(await events.load(runId));
    expect(state.lifecycle).toBe("planning");
    expect((await events.load(runId)).some((event) => event.type === "run.failed")).toBe(false);
  });

  it("retries a transient failure while persisting the terminal state", async () => {
    const runId = "run-terminal-retry";
    await seedPlanningRun(runId);
    let attempts = 0;

    startRunBackgroundTask(
      runId,
      "executor-v2",
      async () => { throw new Error("executor process exited"); },
      async (error) => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary event-store lock");
        await markRunFailedAfterBackgroundTask(runId, error, "execution");
      }
    );

    await drainAllRunBackgroundTasksForTests();

    const state = foldRun(await new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR }).load(runId));
    expect(attempts).toBe(2);
    expect(state.lifecycle).toBe("failed");
  });

  it("reclaims authority when the failed operation released its lease first", async () => {
    const runId = "run-released-operation";
    await seedPlanningRun(runId);

    await markRunFailedAfterBackgroundTask(
      runId,
      new Error("executor failed before handler ran"),
      "execution",
      { operationId: "00000000-0000-0000-0000-000000000028", fencingToken: 1 }
    );

    const state = foldRun(await new JsonlRunEventStore({ directory: process.env.MANYHANDS_RUNS_DIR }).load(runId));
    expect(state.lifecycle).toBe("failed");
    expect((await getRunRepository().get(runId)).projection.lifecycle).toBe("failed");
  });
});
