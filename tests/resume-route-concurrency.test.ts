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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JsonFileCheckpointSaver,
  planningThreadId,
  type Checkpoint,
  type CheckpointMetadata
} from "@manyhands/orchestrator-graph";

const pipelineCalls = vi.hoisted(() => ({ planning: [] as string[], execution: [] as string[] }));
const restartResetControls = vi.hoisted(() => ({
  planningFailuresRemaining: 0,
  planningCalls: [] as string[],
  blockedRunId: undefined as string | undefined,
  blockedPlanningReset: undefined as Promise<void> | undefined
}));
const restartReleaseControls = vi.hoisted(() => ({
  runId: undefined as string | undefined,
  beforeRelease: undefined as (() => Promise<void>) | undefined
}));

// Route concurrency verifies that exactly one request claims a transition. The
// real pipelines are deliberately covered elsewhere; letting these background
// kicks invoke a CLI makes this route suite consume external state and lets a
// slow executor turn the loser into a misleading 409.
vi.mock("@/lib/server/runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/runs")>();
  return {
    ...actual,
    runPlanningPipeline: async (runId: string): Promise<void> => {
      pipelineCalls.planning.push(runId);
    },
    resumePlanningPipeline: async (runId: string): Promise<void> => {
      pipelineCalls.planning.push(runId);
    },
    runExecutionPipeline: async (runId: string): Promise<void> => {
      pipelineCalls.execution.push(runId);
    },
    resumeExecutionPipeline: async (runId: string): Promise<void> => {
      pipelineCalls.execution.push(runId);
    },
    resetPlanningThread: async (runId: string): Promise<void> => {
      restartResetControls.planningCalls.push(runId);
      if (restartResetControls.blockedRunId === runId) {
        await restartResetControls.blockedPlanningReset;
      }
      if (restartResetControls.planningFailuresRemaining > 0) {
        restartResetControls.planningFailuresRemaining -= 1;
        throw new Error("planning checkpoint is locked");
      }
      await actual.resetPlanningThread(runId);
    }
  };
});
vi.mock("@/lib/server/runs/run-operation-lease", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/runs/run-operation-lease")>();
  return {
    ...actual,
    releaseRunOperation: async (...args: Parameters<typeof actual.releaseRunOperation>) => {
      if (restartReleaseControls.runId === args[0] && restartReleaseControls.beforeRelease !== undefined) {
        const beforeRelease = restartReleaseControls.beforeRelease;
        restartReleaseControls.beforeRelease = undefined;
        await beforeRelease();
      }
      return actual.releaseRunOperation(...args);
    }
  };
});
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
import { claimRunOperation } from "@/lib/server/runs/run-operation-lease";

let tempDir: string;
let previousRunsDir: string | undefined;
const activeRunIds = new Set<string>();

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-resume-conc-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  pipelineCalls.planning.length = 0;
  pipelineCalls.execution.length = 0;
  restartResetControls.planningFailuresRemaining = 0;
  restartResetControls.planningCalls.length = 0;
  restartResetControls.blockedRunId = undefined;
  restartResetControls.blockedPlanningReset = undefined;
  restartReleaseControls.runId = undefined;
  restartReleaseControls.beforeRelease = undefined;
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

async function putCheckpoint(threadId: string, id: string): Promise<JsonFileCheckpointSaver> {
  const saver = new JsonFileCheckpointSaver(path.join(process.env.MANYHANDS_RUNS_DIR!, "checkpoints"));
  const checkpoint = {
    v: 1,
    id,
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {}
  } as unknown as Checkpoint;
  const metadata: CheckpointMetadata = { source: "input", step: 0, parents: {} };
  await saver.put({ configurable: { thread_id: threadId } }, checkpoint, metadata, {});
  return saver;
}

async function waitForCondition(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for restart reset seam");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
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
    await drainAllRunBackgroundTasksForTests();
    expect(pipelineCalls.planning).toEqual(["run-restart"]);
  });

  it("restart: a losing concurrent request never receives authority to delete checkpoints", async () => {
    const runId = "run-restart-fenced-reset";
    await getRunRepository().save(
      makeRun({ runId, status: "failed", failedDuring: "generating" })
    );
    const saver = await putCheckpoint(planningThreadId(runId), "old-planning-checkpoint");
    let releaseReset!: () => void;
    restartResetControls.blockedRunId = runId;
    restartResetControls.blockedPlanningReset = new Promise<void>((resolve) => {
      releaseReset = resolve;
    });

    const winner = post(POST_RESTART, runId, {});
    await waitForCondition(() => restartResetControls.planningCalls.includes(runId));

    const firstHeartbeat = (await getRunRepository().get(runId)).activeOperation?.heartbeatAt;
    await new Promise((resolve) => setTimeout(resolve, 4_200));
    await waitForCondition(async () =>
      (await getRunRepository().get(runId)).activeOperation?.heartbeatAt !== firstHeartbeat
    );
    await expect(
      claimRunOperation(runId, "planning", {
        expectedStatuses: ["failed"],
        allowTakeover: true,
        takeoverStaleAfterMs: 1_000
      })
    ).rejects.toThrow(/fresh heartbeat/);

    // The winner holds the durable operation lease while its external reset is
    // blocked. A second process/request must lose before entering that reset.
    const loser = await post(POST_RESTART, runId, {});
    expect(loser.status).toBe(409);
    expect(restartResetControls.planningCalls.filter((id) => id === runId)).toHaveLength(1);

    releaseReset();
    const winnerResponse = await winner;
    expect(winnerResponse.status).toBe(200);
    await putCheckpoint(planningThreadId(runId), "winner-new-checkpoint");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(restartResetControls.planningCalls.filter((id) => id === runId)).toHaveLength(1);
    expect(
      (await saver.getTuple({ configurable: { thread_id: planningThreadId(runId) } }))?.checkpoint.id
    ).toBe("winner-new-checkpoint");
    expect((await getRunRepository().get(runId)).activeOperation).toBeUndefined();
  });

  it("restart: fresh planning discards the old patch log and advances the semantic revision", async () => {
    const runId = "run-restart-fresh-plan";
    await getRunRepository().save(
      makeRun({
        runId,
        status: "failed",
        failedDuring: "generating",
        planning: {},
        planGraphStorage: { version: 1, mode: "immutable_base_patch_log" },
        planRevision: 3,
        approvedAt: "2026-06-11T00:01:00.000Z",
        approvedPlanRevision: 3,
        patches: [
          {
            id: "stale-title",
            createdAt: "2026-06-11T00:00:30.000Z",
            actor: "human",
            type: "NODE_RENAMED",
            taskId: "old-node",
            title: "Stale title"
          }
        ],
        execution: { stale: true },
        executionTraces: [],
        nodeReviews: {},
        validation: { status: "passed", ranAt: "2026-06-11T00:02:00.000Z" },
        completedAt: "2026-06-11T00:03:00.000Z",
        finalPatch: "stale patch",
        finalApplicationStatus: "applied",
        finalBranchName: "manyhands/stale",
        finalCommitSha: "a".repeat(40),
        appliedToRepoPath: "C:/repos/stale",
        appliedAt: "2026-06-11T00:03:00.000Z",
        exportedPatchPath: "C:/exports/stale.patch",
        finalApplicationMessage: "stale delivery",
        finalArtifactManifest: {
          version: 1,
          manifestId: "33333333-3333-4333-8333-333333333333",
          runId,
          sourceTargetFingerprint: "stale-fingerprint",
          sourceBranch: "main",
          sourceBaseSha: "b".repeat(40),
          executionBaseSha: "b".repeat(40),
          finalSha: "a".repeat(40),
          finalRef: "manyhands/stale",
          addedFiles: ["src/stale.ts"],
          modifiedFiles: [],
          deletedFiles: [],
          patch: "stale patch",
          validationCommands: [{ command: "pnpm", args: ["test"] }],
          validationResults: [{ passed: true, output: "ok", exitCode: 0 }],
          verificationDisposition: "verified",
          omittedTasks: [],
          acceptedFailures: [],
          acceptedConflicts: [],
          repairEvidence: [],
          artifactDisposition: "ready",
          deliveryDisposition: "delivered",
          createdAt: "2026-06-11T00:03:00.000Z"
        },
        executionOutcome: "succeeded",
        artifactOutcome: "ready",
        deliveryOutcome: "delivered",
        baseCommit: "b".repeat(40),
        integrationCommitSha: "a".repeat(40)
      })
    );
    const saver = await putCheckpoint(runId, "execution-stale");
    await putCheckpoint(planningThreadId(runId), "planning-stale");

    const response = await post(POST_RESTART, runId, {});

    expect(response.status).toBe(200);
    const run = await getRunRepository().get(runId);
    expect(run.status).toBe("generating");
    expect(run.planRevision).toBe(4);
    expect(run.patches).toEqual([]);
    expect(run.planGraphStorage).toBeUndefined();
    expect(run.approvedAt).toBeUndefined();
    expect(run.approvedPlanRevision).toBeUndefined();
    expect(run.execution).toBeUndefined();
    expect(run.executionTraces).toBeUndefined();
    expect(run.nodeReviews).toBeUndefined();
    expect(run.validation).toBeUndefined();
    expect(run.completedAt).toBeUndefined();
    expect(run.finalPatch).toBeUndefined();
    expect(run.finalApplicationStatus).toBeUndefined();
    expect(run.finalBranchName).toBeUndefined();
    expect(run.finalCommitSha).toBeUndefined();
    expect(run.appliedToRepoPath).toBeUndefined();
    expect(run.appliedAt).toBeUndefined();
    expect(run.exportedPatchPath).toBeUndefined();
    expect(run.finalApplicationMessage).toBeUndefined();
    expect(run.finalArtifactManifest).toBeUndefined();
    expect(run.executionOutcome).toBeUndefined();
    expect(run.artifactOutcome).toBeUndefined();
    expect(run.deliveryOutcome).toBeUndefined();
    expect(run.baseCommit).toBeUndefined();
    expect(run.integrationCommitSha).toBeUndefined();
    expect(await saver.getTuple({ configurable: { thread_id: runId } })).toBeUndefined();
    expect(
      await saver.getTuple({ configurable: { thread_id: planningThreadId(runId) } })
    ).toBeUndefined();
    await drainAllRunBackgroundTasksForTests();
    expect(pipelineCalls.planning).toContain(runId);
  });

  it("restart: a pause that wins after the fresh-plan CAS suppresses dispatch until resume", async () => {
    const runId = "run-restart-post-cas-pause";
    await getRunRepository().save(
      makeRun({ runId, status: "failed", failedDuring: "generating", planRevision: 2 })
    );
    let pauseResponse: Response | undefined;
    restartReleaseControls.runId = runId;
    restartReleaseControls.beforeRelease = async () => {
      pauseResponse = await post(POST_PAUSE, runId, {});
    };

    const restartResponse = await post(POST_RESTART, runId, {});

    expect(restartResponse.status).toBe(200);
    expect(pauseResponse?.status).toBe(200);
    expect(((await restartResponse.json()) as { run: { status: string } }).run.status).toBe("paused");
    const pausedAfterRestart = await getRunRepository().get(runId);
    expect(pausedAfterRestart).toMatchObject({
      status: "paused",
      pausedDuring: "generating"
    });
    expect(pausedAfterRestart.activeOperation).toBeUndefined();
    expect(pipelineCalls.planning).not.toContain(runId);
    const statusesBeforeResume = (await readRunModelEvents(runId))
      .filter((event) => event.type === "run.status.changed")
      .map((event) => (event.payload as { status?: string }).status);
    expect(statusesBeforeResume.slice(-2)).toEqual(["generating", "paused"]);

    const resumeResponse = await post(POST_RESUME, runId, {});

    expect(resumeResponse.status).toBe(200);
    await drainAllRunBackgroundTasksForTests();
    expect(pipelineCalls.planning.filter((id) => id === runId)).toEqual([runId]);
  });

  it("restart: a checkpoint reset failure stays failed and a retry cleans both threads and artifacts", async () => {
    const runId = "run-restart-reset-retry";
    await getRunRepository().save(
      makeRun({
        runId,
        status: "failed",
        failedDuring: "generating",
        errorMessage: "old planning failure",
        planRevision: 2,
        planning: {},
        execution: { stale: true },
        finalPatch: "stale patch",
        finalArtifactManifest: {
          version: 1,
          manifestId: "44444444-4444-4444-8444-444444444444",
          runId,
          sourceTargetFingerprint: "stale-fingerprint",
          sourceBranch: "main",
          sourceBaseSha: "b".repeat(40),
          executionBaseSha: "b".repeat(40),
          finalSha: "a".repeat(40),
          addedFiles: [],
          modifiedFiles: ["src/stale.ts"],
          deletedFiles: [],
          patch: "stale patch",
          validationCommands: [],
          validationResults: [],
          verificationDisposition: "verified",
          omittedTasks: [],
          acceptedFailures: [],
          acceptedConflicts: [],
          repairEvidence: [],
          artifactDisposition: "ready",
          deliveryDisposition: "needs_delivery",
          createdAt: "2026-06-11T00:03:00.000Z"
        },
        executionOutcome: "succeeded",
        artifactOutcome: "ready",
        deliveryOutcome: "needs_delivery"
      })
    );
    const saver = await putCheckpoint(runId, "execution-before-reset-retry");
    await putCheckpoint(planningThreadId(runId), "planning-before-reset-retry");
    restartResetControls.planningFailuresRemaining = 1;

    const failedReset = await post(POST_RESTART, runId, {});

    expect(failedReset.status).toBe(500);
    expect(await failedReset.json()).toMatchObject({
      error: expect.stringContaining("El run sigue siendo reiniciable")
    });
    const stillFailed = await getRunRepository().get(runId);
    expect(stillFailed.status).toBe("failed");
    expect(stillFailed.errorMessage).toContain("planning checkpoint is locked");
    expect(stillFailed.finalArtifactManifest?.manifestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(
      await saver.getTuple({ configurable: { thread_id: planningThreadId(runId) } })
    ).toBeDefined();
    // allSettled waits for the independent execution reset even when planning
    // reset fails; the retry remains safe because both deletes are idempotent.
    expect(await saver.getTuple({ configurable: { thread_id: runId } })).toBeUndefined();
    expect(pipelineCalls.planning).not.toContain(runId);

    const retried = await post(POST_RESTART, runId, {});

    expect(retried.status).toBe(200);
    const restarted = await getRunRepository().get(runId);
    expect(restarted.status).toBe("generating");
    expect(restarted.planRevision).toBe(3);
    expect(restarted.execution).toBeUndefined();
    expect(restarted.finalPatch).toBeUndefined();
    expect(restarted.finalArtifactManifest).toBeUndefined();
    expect(restarted.executionOutcome).toBeUndefined();
    expect(restarted.artifactOutcome).toBeUndefined();
    expect(restarted.deliveryOutcome).toBeUndefined();
    expect(
      await saver.getTuple({ configurable: { thread_id: planningThreadId(runId) } })
    ).toBeUndefined();
    expect(await saver.getTuple({ configurable: { thread_id: runId } })).toBeUndefined();
    await drainAllRunBackgroundTasksForTests();
    expect(pipelineCalls.planning).toContain(runId);
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

  it("restart: a fresh cross-process operation owner cannot be fenced by a non-fresh restart", async () => {
    const runId = "run-restart-fresh-operation";
    const heartbeatAt = new Date().toISOString();
    await getRunRepository().save(
      makeRun({
        runId,
        status: "failed",
        failedDuring: "running",
        planning: {},
        mutationFence: 4,
        activeOperation: {
          operationId: "55555555-5555-4555-8555-555555555555",
          kind: "execution",
          fencingToken: 4,
          acquiredAt: heartbeatAt,
          heartbeatAt
        }
      })
    );

    const response = await post(POST_RESTART, runId, {});

    expect(response.status).toBe(409);
    expect(await getRunRepository().get(runId)).toMatchObject({
      status: "failed",
      activeOperation: {
        operationId: "55555555-5555-4555-8555-555555555555",
        fencingToken: 4
      }
    });
    expect(pipelineCalls.execution).not.toContain(runId);
  });

  it("restart: a stale cross-process operation is fenced before execution is re-dispatched", async () => {
    const runId = "run-restart-stale-operation";
    await getRunRepository().save(
      makeRun({
        runId,
        status: "failed",
        failedDuring: "running",
        planning: {},
        executionStartedAt: "2026-07-16T10:00:00.000Z",
        mutationFence: 7,
        activeOperation: {
          operationId: "66666666-6666-4666-8666-666666666666",
          kind: "execution",
          fencingToken: 7,
          acquiredAt: "2020-01-01T00:00:00.000Z",
          heartbeatAt: "2020-01-01T00:00:00.000Z"
        }
      })
    );

    const response = await post(POST_RESTART, runId, {});

    expect(response.status).toBe(200);
    const restarted = await getRunRepository().get(runId);
    expect(restarted.status).toBe("approved");
    expect(restarted.activeOperation).toBeUndefined();
    expect(restarted.mutationFence).toBeGreaterThan(7);
    expect(restarted.executionStartedAt).toBe("2026-07-16T10:00:00.000Z");
    await drainAllRunBackgroundTasksForTests();
    expect(pipelineCalls.execution).toContain(runId);
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
