/**
 * INV-4 at the HTTP seam — duplicate HITL decisions against the real route
 * handlers. The winner gets 200 and consumes the gate; every loser gets a
 * structured 409 (RunMutationConflictError → { conflict }) without re-running
 * anything. Background pipeline kicks fail fast (no provisioned repo) and are
 * swallowed by the routes' fire-and-forget catch.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RESUME } from "@/app/api/runs/[id]/resume/route";
import { POST as POST_ANSWER } from "@/app/api/runs/[id]/answer/route";
import { POST as POST_RESTART } from "@/app/api/runs/[id]/restart/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-resume-conc-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  // Give fire-and-forget pipeline kicks a beat to fail fast before the temp
  // dir disappears (their writes are best-effort and caught either way).
  await new Promise((resolve) => setTimeout(resolve, 50));
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
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

// Each test uses its own runId: fire-and-forget pipeline kicks from a previous
// test can linger in the process-local runner-state for the same id.
function post(handler: typeof POST_RESUME, runId: string, body: unknown): Promise<Response> {
  return handler(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

describe("duplicate HITL decisions at the route seam", () => {
  it("resume: one 200, one structured 409 for the same gate decision", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-gate",
        status: "paused",
        pausedDuring: "running",
        pendingDecision: {
          gate: "leaf_validation_failed",
          gateId: "leaf_validation_failed:task-1:abc12345",
          taskId: "task-1",
          validationOutput: "tests failed"
        },
        pendingQuestion: { nodeId: "task-1", question: "¿Cómo continuar?", options: ["Reintentar", "Abortar"] }
      })
    );

    const [first, second] = await Promise.all([
      post(POST_RESUME, "run-gate", { action: "retry_repair" }),
      post(POST_RESUME, "run-gate", { action: "retry_repair" })
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const loser = first.status === 409 ? first : second;
    const body = (await loser.json()) as { error: string; conflict?: { currentStatus: string } };
    expect(body.conflict?.currentStatus).toBe("running");
  });

  it("resume: a stale gateId cannot resolve a re-minted gate", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-stale-gate",
        status: "paused",
        pausedDuring: "running",
        pendingDecision: {
          gate: "leaf_validation_failed",
          gateId: "leaf_validation_failed:task-1:fresh001",
          taskId: "task-1"
        }
      })
    );
    const response = await post(POST_RESUME, "run-stale-gate", {
      action: "retry_repair",
      gateId: "leaf_validation_failed:task-1:stale999"
    });
    expect(response.status).toBe(409);
    // The gate survives untouched for the holder of the fresh id.
    const run = await getRunRepository().get("run-stale-gate");
    expect(run.pendingDecision?.gateId).toBe("leaf_validation_failed:task-1:fresh001");
  });

  it("answer: duplicate planning answers — one 200, one 409, single stored answer", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-answer",
        status: "paused",
        pausedDuring: "generating",
        pendingQuestion: { nodeId: "node-7", question: "¿REST o GraphQL?", options: ["REST", "GraphQL"] }
      })
    );
    const [first, second] = await Promise.all([
      post(POST_ANSWER, "run-answer", { nodeId: "node-7", answer: "REST" }),
      post(POST_ANSWER, "run-answer", { nodeId: "node-7", answer: "GraphQL" })
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const run = await getRunRepository().get("run-answer");
    expect(run.pendingQuestion).toBeUndefined();
    expect(Object.keys(run.questionAnswers ?? {})).toEqual(["node-7"]);
  });

  it("answer: stale expectedVersion is rejected with 409", async () => {
    const saved = await getRunRepository().save(
      makeRun({
        runId: "run-stale-version",
        status: "paused",
        pausedDuring: "generating",
        pendingQuestion: { nodeId: "node-7", question: "¿REST o GraphQL?", options: ["REST", "GraphQL"] }
      })
    );
    const response = await post(POST_ANSWER, "run-stale-version", {
      nodeId: "node-7",
      answer: "REST",
      expectedVersion: saved.version + 7
    });
    expect(response.status).toBe(409);
  });

  it("restart: duplicate restarts — exactly one claims the run", async () => {
    await getRunRepository().save(makeRun({ runId: "run-restart", status: "failed", failedDuring: "generating" }));
    const [first, second] = await Promise.all([
      post(POST_RESTART, "run-restart", {}),
      post(POST_RESTART, "run-restart", {})
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });
});
