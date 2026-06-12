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
import { RunMutationConflictError } from "@/lib/server/runs/errors";
import { resumeReplanWithAnswer } from "@/lib/server/runs/replan-service";
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
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await new Promise((resolve) => setTimeout(resolve, 50));
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
    expect(saved.pendingReplan).toBeUndefined();
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
    const saved = await getRunRepository().get("run-replan-route");
    expect(saved.status).toBe("running");
    expect(saved.pendingReplan).toBeUndefined();
  });
});
