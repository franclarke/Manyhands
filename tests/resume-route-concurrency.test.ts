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
import { POST as POST_PAUSE } from "@/app/api/runs/[id]/pause/route";
import { POST as POST_RESUME } from "@/app/api/runs/[id]/resume/route";
import { POST as POST_ANSWER } from "@/app/api/runs/[id]/answer/route";
import { POST as POST_DECISION } from "@/app/api/runs/[id]/decisions/[decisionId]/route";
import { POST as POST_RESTART } from "@/app/api/runs/[id]/restart/route";
import { POST as POST_FORK } from "@/app/api/runs/[id]/fork/route";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import {
  drainAllRunBackgroundTasksForTests,
  markRunnerActive,
  markRunnerInactive
} from "@/lib/server/runs/runner-state";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;
const activeRunIds = new Set<string>();

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-resume-conc-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  for (const runId of activeRunIds) {
    markRunnerInactive(runId);
  }
  activeRunIds.clear();
  // Drain fire-and-forget pipeline kicks BEFORE restoring the runs dir: a kick
  // that outlives the env override resolves the REAL .manyhands/runs and leaks
  // test runs into the app (they showed up in the sidebar).
  await drainAllRunBackgroundTasksForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
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
type RoutePost = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;

function post(handler: RoutePost, runId: string, body: unknown): Promise<Response> {
  return handler(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}

function postFork(runId: string, body: unknown): Promise<Response> {
  return POST_FORK(
    new Request("http://mh.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: runId }) }
  );
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

describe("duplicate HITL decisions at the route seam", () => {
  it("pause: claims a running run atomically and records pausedDuring", async () => {
    const saved = await getRunRepository().save(makeRun({ runId: "run-pause", status: "running" }));
    const response = await post(POST_PAUSE, "run-pause", { expectedVersion: saved.version });
    const body = (await response.json()) as { run: { status: string; pausedDuring?: string } };

    expect(response.status).toBe(200);
    expect(body.run.status).toBe("paused");
    expect(body.run.pausedDuring).toBe("running");
  });

  it("pause: stale expectedVersion is rejected with 409", async () => {
    const saved = await getRunRepository().save(makeRun({ runId: "run-pause-stale", status: "generating" }));
    const response = await post(POST_PAUSE, "run-pause-stale", { expectedVersion: saved.version + 1 });

    expect(response.status).toBe(409);
    const run = await getRunRepository().get("run-pause-stale");
    expect(run.status).toBe("generating");
  });

  it("pause: terminal runs are rejected without mutation", async () => {
    await getRunRepository().save(makeRun({ runId: "run-pause-terminal", status: "completed" }));
    const response = await post(POST_PAUSE, "run-pause-terminal", {});

    expect(response.status).toBe(409);
    const run = await getRunRepository().get("run-pause-terminal");
    expect(run.status).toBe("completed");
    expect(run.pausedDuring).toBeUndefined();
  });

  it("resume: non-paused runs are rejected before mutation", async () => {
    await getRunRepository().save(makeRun({ runId: "run-resume-invalid", status: "running" }));
    const response = await post(POST_RESUME, "run-resume-invalid", {});

    expect(response.status).toBe(409);
    expect((await getRunRepository().get("run-resume-invalid")).status).toBe("running");
  });

  it("resume: plain pause consumes once and duplicate request gets 409", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-plain-resume",
        status: "paused",
        pausedDuring: "running",
        planning: { decomposition: { graph: { rootId: "root", nodes: {}, dependencies: [] } } }
      })
    );

    const [first, second] = await Promise.all([
      post(POST_RESUME, "run-plain-resume", {}),
      post(POST_RESUME, "run-plain-resume", {})
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const body = (await winner.json()) as { run: { status: string; pausedDuring?: string } };
    expect(body.run.status).toBe("running");
    expect(body.run.pausedDuring).toBeUndefined();
  });

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

    const events = await readRunModelEvents("run-gate");
    expect(
      events.some(
        (event) =>
          event.type === "decision.resolved" &&
          (event.payload as { decisionId?: string; choice?: { answer?: string } }).decisionId === "clarify:task-1" &&
          (event.payload as { choice?: { answer?: string } }).choice?.answer === "retry_repair"
      )
    ).toBe(true);
  });

  it("resume: gate decisions are rejected while a runner is already active", async () => {
    const runId = "run-gate-active-runner";
    await getRunRepository().save(
      makeRun({
        runId,
        status: "paused",
        pausedDuring: "running",
        pendingDecision: {
          gate: "leaf_validation_failed",
          gateId: "leaf_validation_failed:task-1:active01",
          taskId: "task-1",
          validationOutput: "tests failed"
        },
        pendingQuestion: { nodeId: "task-1", question: "Continuar?", options: ["Reintentar", "Abortar"] }
      })
    );
    markRunnerActive(runId);
    activeRunIds.add(runId);

    const response = await post(POST_RESUME, runId, { action: "retry_repair" });

    expect(response.status).toBe(409);
    const run = await getRunRepository().get(runId);
    expect(run.status).toBe("paused");
    expect(run.pendingDecision?.gateId).toBe("leaf_validation_failed:task-1:active01");
  });

  it("resume: rejects leaf-only replan action for a merge gate", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-merge-replan-invalid",
        status: "paused",
        pausedDuring: "running",
        pendingDecision: {
          gate: "merge_conflict",
          gateId: "merge_conflict:root:abc12345",
          taskId: "root",
          integrationStatus: "cherry_pick_conflict"
        },
        pendingQuestion: {
          nodeId: "root",
          question: "La integración falló. ¿Cómo continuar?",
          options: ["Reintentar integración", "Aceptar conflicto y continuar", "Abortar run"]
        }
      })
    );

    const response = await post(POST_RESUME, "run-merge-replan-invalid", { action: "replan_subtree" });

    expect(response.status).toBe(400);
    const run = await getRunRepository().get("run-merge-replan-invalid");
    expect(run.status).toBe("paused");
    expect(run.pendingDecision?.gateId).toBe("merge_conflict:root:abc12345");
  });

  it("resume: rejects leaf-only retry action for a merge gate", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-merge-retry-invalid",
        status: "paused",
        pausedDuring: "running",
        pendingDecision: {
          gate: "merge_conflict",
          gateId: "merge_conflict:root:retry01",
          taskId: "root",
          integrationStatus: "cherry_pick_conflict"
        },
        pendingQuestion: {
          nodeId: "root",
          question: "La integraciÃ³n fallÃ³. Â¿CÃ³mo continuar?",
          options: ["Reintentar integraciÃ³n", "Aceptar conflicto y continuar", "Abortar run"]
        }
      })
    );

    const response = await post(POST_RESUME, "run-merge-retry-invalid", { action: "retry_repair" });

    expect(response.status).toBe(400);
    const run = await getRunRepository().get("run-merge-retry-invalid");
    expect(run.status).toBe("paused");
    expect(run.pendingDecision?.gateId).toBe("merge_conflict:root:retry01");
    expect(await readRunModelEvents("run-merge-retry-invalid")).toHaveLength(0);
  });

  it("resume: stale expectedVersion cannot consume an execution gate", async () => {
    const saved = await getRunRepository().save(
      makeRun({
        runId: "run-gate-stale-version",
        status: "paused",
        pausedDuring: "running",
        pendingDecision: {
          gate: "leaf_validation_failed",
          gateId: "leaf_validation_failed:task-1:version1",
          taskId: "task-1",
          validationOutput: "tests failed"
        }
      })
    );

    const response = await post(POST_RESUME, "run-gate-stale-version", {
      action: "retry_repair",
      expectedVersion: saved.version + 1
    });

    expect(response.status).toBe(409);
    const run = await getRunRepository().get("run-gate-stale-version");
    expect(run.status).toBe("paused");
    expect(run.pendingDecision?.gateId).toBe("leaf_validation_failed:task-1:version1");
    expect(await readRunModelEvents("run-gate-stale-version")).toHaveLength(0);
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

  it("answer: an interrupted planning question can be resumed without restarting the run", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-interrupted-answer",
        status: "interrupted",
        pausedDuring: "generating",
        interruptedDuring: "generating",
        pendingQuestion: { nodeId: "node-7", question: "Continuar?", options: ["Reintentar", "Abortar"] }
      })
    );

    const response = await post(POST_ANSWER, "run-interrupted-answer", {
      nodeId: "node-7",
      answer: "Reintentar"
    });

    expect(response.status).toBe(200);
    const run = await getRunRepository().get("run-interrupted-answer");
    expect(run.status).toBe("generating");
    expect(run.pendingQuestion).toBeUndefined();
    expect(run.questionAnswers?.["node-7"]).toBe("Reintentar");
  });

  it("decision: an interrupted planning question option can be resolved from the gate card", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-interrupted-decision",
        status: "interrupted",
        pausedDuring: "generating",
        interruptedDuring: "generating",
        pendingQuestion: { nodeId: "node-7", question: "Continuar?", options: ["Reintentar", "Abortar"] }
      })
    );

    const response = await postDecision("run-interrupted-decision", "clarify:node-7", {
      answer: "Reintentar"
    });

    expect(response.status).toBe(200);
    const run = await getRunRepository().get("run-interrupted-decision");
    expect(run.status).toBe("generating");
    expect(run.pendingQuestion).toBeUndefined();
    expect(run.questionAnswers?.["node-7"]).toBe("Reintentar");
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
    await getRunRepository().save(
      makeRun({
        runId: "run-restart",
        status: "failed",
        failedDuring: "generating",
        pausedDuring: "generating",
        pendingQuestion: { nodeId: "stale-node", question: "Stale?", options: ["yes", "no"] }
      })
    );
    const [first, second] = await Promise.all([
      post(POST_RESTART, "run-restart", {}),
      post(POST_RESTART, "run-restart", {})
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const run = await getRunRepository().get("run-restart");
    expect(run.pendingQuestion).toBeUndefined();
    expect(run.pausedDuring).toBeUndefined();
    const events = await readRunModelEvents("run-restart");
    expect(
      events.some(
        (event) =>
          event.type === "run.status.changed" &&
          (event.payload as { status?: string }).status === "generating"
      )
    ).toBe(true);
  });

  it("restart: backfills medium reasoning effort for fixed Codex runs", async () => {
    await getRunRepository().save(
      makeRun({
        runId: "run-restart-codex-effort",
        status: "failed",
        failedDuring: "generating",
        model: "gpt-5.5",
        planningModel: "gpt-5.5",
        planningExecutorId: "codex-cli",
        defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
        defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.5" },
        executionConfig: { routing: "fixed" }
      })
    );

    const response = await post(POST_RESTART, "run-restart-codex-effort", {});

    expect(response.status).toBe(200);
    const run = await getRunRepository().get("run-restart-codex-effort");
    expect(run.executionConfig).toMatchObject({ routing: "fixed", reasoningEffort: "medium" });
  });

  it("restart: active runner is rejected before the restartable state is consumed", async () => {
    const runId = "run-restart-active";
    await getRunRepository().save(makeRun({ runId, status: "failed", failedDuring: "running" }));
    markRunnerActive(runId);
    activeRunIds.add(runId);

    const response = await post(POST_RESTART, runId, {});

    expect(response.status).toBe(409);
    expect((await getRunRepository().get(runId)).status).toBe("failed");
  });

  it("fork: active runner is rejected before cloning a moving run", async () => {
    const runId = "run-fork-active";
    await getRunRepository().save(makeRun({ runId, status: "approved" }));
    markRunnerActive(runId);
    activeRunIds.add(runId);

    const response = await postFork(runId, {});

    expect(response.status).toBe(409);
    await expect(getRunRepository().get(runId)).resolves.toMatchObject({ status: "approved" });
  });
});
