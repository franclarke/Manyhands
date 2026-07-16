/**
 * U2 / INV-5 — a clarifying question during a replan is a GATE, not an abort.
 *
 * The suspended replan persists `pendingReplan` (resumable decomposer step
 * cache + accumulated answers) alongside the pending question. Answering
 * claims the gate atomically (INV-4), folds the answer, and re-enters the
 * replan; duplicates get the structured 409.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_ANSWER } from "@/app/api/runs/[id]/answer/route";
import { POST as POST_RESTART } from "@/app/api/runs/[id]/restart/route";
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { resumeReplanWithAnswer } from "@/lib/server/runs/replan-service";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-replan-gate-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  // Drain fire-and-forget pipeline kicks BEFORE restoring the runs dir so no
  // late write leaks into the real .manyhands/runs.
  await drainAllRunBackgroundTasksForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function suspendedReplanRun(runId: string): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "paused",
    pausedDuring: "running",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    patches: [],
    pendingQuestion: {
      nodeId: "replan-node-1",
      question: '[Replan de "task-7"] ¿REST o GraphQL?',
      options: ["REST", "GraphQL"]
    },
    pendingReplan: {
      taskId: "task-7",
      reason: "leaf failed irrecoverably",
      stepCache: { cursor: 3 },
      questionAnswers: { "earlier-node": "previous answer" }
    }
  };
}

describe("replan question gate", () => {
  it("resumeReplanWithAnswer consumes the gate, folds the answer, and re-enters running", async () => {
    await getRunRepository().save(suspendedReplanRun("run-replan-resume"));

    const saved = await resumeReplanWithAnswer("run-replan-resume", "replan-node-1", "REST");
    expect(saved.status).toBe("running");
    expect(saved.pendingQuestion).toBeUndefined();
    expect(saved.pendingReplan).toMatchObject({
      taskId: "task-7",
      questionAnswers: {
        "earlier-node": "previous answer",
        "replan-node-1": "REST"
      },
      resumeRequestedAt: expect.any(String)
    });
    const events = await readRunModelEvents("run-replan-resume");
    expect(
      events.some(
        (event) =>
          event.type === "decision.resolved" &&
          (event.payload as { decisionId?: string; choice?: { answer?: string } }).decisionId ===
            "clarify:replan-node-1" &&
          (event.payload as { choice?: { answer?: string } }).choice?.answer === "REST"
      )
    ).toBe(true);
    // The background replan re-entry fails fast in this fixture (no graph) and
    // is caught — the gate mechanics are what this test pins down.
  });

  it("duplicate answers: exactly one wins, the loser gets the structured conflict", async () => {
    await getRunRepository().save(suspendedReplanRun("run-replan-dup"));

    const attempts = await Promise.allSettled([
      resumeReplanWithAnswer("run-replan-dup", "replan-node-1", "REST"),
      resumeReplanWithAnswer("run-replan-dup", "replan-node-1", "GraphQL")
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const loser = attempts.find((a) => a.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason).toBeInstanceOf(RunMutationConflictError);
  });

  it("rejects when there is no suspended replan to resume", async () => {
    const run = suspendedReplanRun("run-replan-none");
    delete run.pendingReplan;
    await getRunRepository().save(run);
    await expect(
      resumeReplanWithAnswer("run-replan-none", "replan-node-1", "REST")
    ).rejects.toBeInstanceOf(RunMutationConflictError);
  });

  it("fences a stranded suspending lease without losing the durable resume intent", async () => {
    const run = suspendedReplanRun("run-replan-stranded-lease");
    run.mutationFence = 4;
    run.activeOperation = {
      operationId: "11111111-1111-4111-8111-111111111111",
      kind: "replan",
      fencingToken: 4,
      acquiredAt: "2026-06-12T00:00:00.000Z",
      heartbeatAt: "2026-06-12T00:00:00.000Z"
    };
    await getRunRepository().save(run);

    const saved = await resumeReplanWithAnswer(
      "run-replan-stranded-lease",
      "replan-node-1",
      "GraphQL"
    );

    expect(saved.activeOperation).toBeUndefined();
    expect(saved.mutationFence).toBe(5);
    expect(saved.pendingReplan).toMatchObject({
      questionAnswers: {
        "earlier-node": "previous answer",
        "replan-node-1": "GraphQL"
      },
      resumeRequestedAt: expect.any(String)
    });
  });

  it("the /answer route drives the replan gate (paused during running)", async () => {
    await getRunRepository().save(suspendedReplanRun("run-replan-route"));

    const response = await POST_ANSWER(
      new Request("http://mh.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "replan-node-1", answer: "GraphQL" })
      }),
      { params: Promise.resolve({ id: "run-replan-route" }) }
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { run: { status: string } };
    expect(body.run.status).toBe("running");
    const saved = await getRunRepository().get("run-replan-route");
    expect(saved.pendingReplan).toMatchObject({
      questionAnswers: expect.objectContaining({ "replan-node-1": "GraphQL" }),
      resumeRequestedAt: expect.any(String)
    });
    const events = await readRunModelEvents("run-replan-route");
    expect(
      events.some(
        (event) =>
          event.type === "decision.resolved" &&
          (event.payload as { decisionId?: string; choice?: { answer?: string } }).decisionId ===
            "clarify:replan-node-1" &&
          (event.payload as { choice?: { answer?: string } }).choice?.answer === "GraphQL"
      )
    ).toBe(true);
  });

  it("persists failed terminal truth when resumed replan preparation cannot load its graph", async () => {
    const run = suspendedReplanRun("run-replan-preparation-failure");
    await getRunRepository().save(run);

    const response = await POST_ANSWER(
      new Request("http://mh.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "replan-node-1", answer: "REST" })
      }),
      { params: Promise.resolve({ id: run.runId }) }
    );

    expect(response.status).toBe(200);
    await drainAllRunBackgroundTasksForTests();
    const failed = await getRunRepository().get(run.runId);
    expect(failed.status).toBe("failed");
    expect(failed.failedDuring).toBe("running");
    expect(failed.errorMessage).toContain("Cannot execute a run without a generated plan");
    expect(failed.activeOperation).toBeUndefined();
    const events = await readRunModelEvents(run.runId);
    expect(events.some((event) =>
      event.type === "run.status.changed" &&
      (event.payload as { status?: string }).status === "failed"
    )).toBe(true);
  });

  it("restart retries an answered replan after pre-CAS failure instead of executing the old plan", async () => {
    const run = suspendedReplanRun("run-replan-failed-restart");
    run.planning = planningWithTaskSeven();
    run.approvedAt = "2026-06-12T00:00:00.000Z";
    await getRunRepository().save(run);

    const answerResponse = await POST_ANSWER(
      new Request("http://mh.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "replan-node-1", answer: "REST" })
      }),
      { params: Promise.resolve({ id: run.runId }) }
    );
    expect(answerResponse.status, await answerResponse.clone().text()).toBe(200);
    await drainAllRunBackgroundTasksForTests();

    const firstFailure = await getRunRepository().get(run.runId);
    expect(firstFailure).toMatchObject({
      status: "failed",
      failedDuring: "running",
      pendingReplan: {
        taskId: "task-7",
        questionAnswers: expect.objectContaining({ "replan-node-1": "REST" }),
        resumeRequestedAt: expect.any(String)
      }
    });
    expect(firstFailure.errorMessage).toContain("Replanning requires a workspace");

    const restartResponse = await POST_RESTART(
      new Request("http://mh.test", { method: "POST" }),
      { params: Promise.resolve({ id: run.runId }) }
    );
    expect(restartResponse.status, await restartResponse.clone().text()).toBe(200);
    const body = (await restartResponse.json()) as { run: { status: string } };
    expect(body.run.status).toBe("running");
    await drainAllRunBackgroundTasksForTests();

    const retriedFailure = await getRunRepository().get(run.runId);
    expect(retriedFailure.status).toBe("failed");
    expect(retriedFailure.errorMessage).toContain("Replanning requires a workspace");
    expect(retriedFailure.pendingReplan).toMatchObject({
      taskId: "task-7",
      questionAnswers: expect.objectContaining({ "replan-node-1": "REST" }),
      resumeRequestedAt: firstFailure.pendingReplan?.resumeRequestedAt
    });
    const statuses = (await readRunModelEvents(run.runId))
      .filter((event) => event.type === "run.status.changed")
      .map((event) => (event.payload as { status?: string }).status);
    expect(statuses.filter((status) => status === "running")).toHaveLength(2);
    expect(statuses).not.toContain("approved");
  });

  it("restart re-dispatches an answered replan whose in-memory callback was lost", async () => {
    const run = suspendedReplanRun("run-replan-restart");
    run.status = "interrupted";
    run.interruptedDuring = "running";
    run.errorMessage = "interrupted: server restart";
    delete run.pausedDuring;
    delete run.pendingQuestion;
    run.pendingReplan = {
      ...run.pendingReplan!,
      questionAnswers: {
        ...run.pendingReplan!.questionAnswers,
        "replan-node-1": "REST"
      },
      resumeRequestedAt: "2026-06-12T00:00:05.000Z"
    };
    await getRunRepository().save(run);

    const response = await POST_RESTART(
      new Request("http://mh.test", { method: "POST" }),
      { params: Promise.resolve({ id: run.runId }) }
    );

    expect(response.status, await response.clone().text()).toBe(200);
    const body = (await response.json()) as { run: { status: string } };
    expect(body.run.status).toBe("running");
    const saved = await getRunRepository().get(run.runId);
    expect(saved.pendingReplan).toMatchObject({
      questionAnswers: expect.objectContaining({ "replan-node-1": "REST" }),
      resumeRequestedAt: "2026-06-12T00:00:05.000Z"
    });
  });

  it("restart restores an unanswered interrupted replan as a paused gate that can still be answered", async () => {
    const run = suspendedReplanRun("run-replan-unanswered-restart");
    run.status = "interrupted";
    run.interruptedDuring = "running";
    run.errorMessage = "interrupted: server restart";
    delete run.pausedDuring;
    await getRunRepository().save(run);

    const restartResponse = await POST_RESTART(
      new Request("http://mh.test", { method: "POST" }),
      { params: Promise.resolve({ id: run.runId }) }
    );

    expect(restartResponse.status, await restartResponse.clone().text()).toBe(200);
    const restored = await getRunRepository().get(run.runId);
    expect(restored.status).toBe("paused");
    expect(restored.pausedDuring).toBe("running");
    expect(restored.pendingQuestion).toEqual(run.pendingQuestion);
    expect(restored.pendingReplan).toEqual(run.pendingReplan);

    const answerResponse = await POST_ANSWER(
      new Request("http://mh.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nodeId: "replan-node-1", answer: "GraphQL" })
      }),
      { params: Promise.resolve({ id: run.runId }) }
    );

    expect(answerResponse.status, await answerResponse.clone().text()).toBe(200);
    const body = (await answerResponse.json()) as {
      run: { status: string; pendingQuestion?: unknown };
    };
    expect(body.run.status).toBe("running");
    expect(body.run.pendingQuestion).toBeUndefined();
    const answered = await getRunRepository().get(run.runId);
    expect(answered.pendingQuestion).toBeUndefined();
    expect(answered.pendingReplan).toMatchObject({
      questionAnswers: expect.objectContaining({ "replan-node-1": "GraphQL" }),
      resumeRequestedAt: expect.any(String)
    });
  });
});

function planningWithTaskSeven(): unknown {
  const createdAt = "2026-06-12T00:00:00.000Z";
  return {
    decomposition: {
      graph: {
        id: "graph-replan-restart",
        planId: "plan-replan-restart",
        repo: "missing-repo",
        baseBranch: "main",
        baseCommit: "base",
        featureRequest: "Add login",
        rootId: "root",
        createdAt,
        dependencies: [],
        nodes: {
          root: {
            id: "root",
            parentId: null,
            title: "Add login",
            goal: "Add login",
            status: "planned",
            kind: "root",
            depth: 0,
            granularity: "auto",
            childrenIds: ["task-7"],
            dependencies: []
          },
          "task-7": {
            id: "task-7",
            parentId: "root",
            title: "Implement API",
            goal: "Implement login API",
            status: "planned",
            kind: "leaf",
            depth: 1,
            granularity: "auto",
            childrenIds: [],
            dependencies: []
          }
        }
      },
      contracts: []
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { batches: [] },
    traces: [],
    summary: { mode: "balanced" }
  };
}
