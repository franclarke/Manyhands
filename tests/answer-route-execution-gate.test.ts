/**
 * Execution gates at the HTTP seam — the postmortem regression suite.
 *
 * The stuck run: the chat composer 409'd (POST /answer only knew planning
 * pauses) and the gate card 400'd (it posted { action: "approve" } to a
 * clarify decision). Both paths now resolve through the shared
 * execution-gate-service: same answers accepted everywhere, invalid answers
 * get an actionable 400 listing the gate's options, duplicates 409.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_ANSWER } from "@/app/api/runs/[id]/answer/route";
import { POST as POST_DECISION } from "@/app/api/runs/[id]/decisions/[decisionId]/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { appendRunModelEvent } from "@/lib/server/runs/run-model-event-log";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-exec-gate-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  // Drain fire-and-forget pipeline kicks BEFORE restoring the runs dir: a kick
  // that outlives the env override resolves the REAL .manyhands/runs and leaks
  // test runs into the app (they showed up in the sidebar).
  await drainAllRunBackgroundTasksForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

const CONFLICT_OPTIONS = ["Aceptar conflicto y continuar", "Abortar run"];

function makeGatedRun(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Build counter",
    title: "Build counter",
    version: 0,
    status: "paused",
    pausedDuring: "running",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    patches: [],
    pendingDecision: {
      gate: "merge_conflict",
      gateId: "merge_conflict:build-ui:abc12345",
      taskId: "build-ui",
      integrationStatus: "validation_failed"
    },
    pendingQuestion: {
      nodeId: "build-ui",
      question: "La integración falló. ¿Cómo querés continuar?",
      options: CONFLICT_OPTIONS
    },
    ...overrides
  } as RunRecord;
}

function postAnswer(runId: string, body: unknown): Promise<Response> {
  return POST_ANSWER(
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

/** Seed the run-model event log with the gate decision persistExecutionPause publishes. */
async function raiseGateDecision(runId: string, taskId: string): Promise<void> {
  await appendRunModelEvent(runId, {
    actor: "system",
    at: "2026-06-12T00:00:01.000Z",
    type: "decision.raised",
    payload: {
      decisionId: `clarify:${taskId}`,
      kind: "clarify",
      blocking: true,
      context: {
        nodeIds: [taskId],
        question: "La integración falló. ¿Cómo querés continuar?",
        options: CONFLICT_OPTIONS,
        gate: "merge_conflict"
      }
    }
  });
}

describe("POST /answer with an execution gate", () => {
  it("resolves the gate with a valid option label and resumes the run", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-answer"));
    const response = await postAnswer("run-gate-answer", {
      nodeId: "build-ui",
      answer: "Aceptar conflicto y continuar"
    });
    expect(response.status).toBe(200);

    const run = await getRunRepository().get("run-gate-answer");
    expect(run.status).toBe("running");
    expect(run.pendingDecision).toBeUndefined();
    expect(run.pendingQuestion).toBeUndefined();
  });

  it("rejects an invalid answer with a 400 that lists the valid options", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-invalid"));
    const response = await postAnswer("run-gate-invalid", {
      nodeId: "build-ui",
      answer: "dale nomás"
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Aceptar conflicto y continuar");
    expect(body.error).toContain("Abortar run");

    // The gate survives an invalid answer.
    const run = await getRunRepository().get("run-gate-invalid");
    expect(run.pendingDecision?.gateId).toBe("merge_conflict:build-ui:abc12345");
  });

  it("rejects the leaf-only replan answer for a merge gate", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-invalid-replan"));
    const response = await postAnswer("run-gate-invalid-replan", {
      nodeId: "build-ui",
      answer: "Re-planificar subárbol"
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain(
      'Valid options: "Reintentar integración", "Aceptar conflicto y continuar", "Abortar run".'
    );

    const run = await getRunRepository().get("run-gate-invalid-replan");
    expect(run.status).toBe("paused");
    expect(run.pendingDecision?.gateId).toBe("merge_conflict:build-ui:abc12345");
  });

  it("rejects a nodeId that does not match the pending gate", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-mismatch"));
    const response = await postAnswer("run-gate-mismatch", {
      nodeId: "some-other-node",
      answer: "Aceptar conflicto y continuar"
    });
    expect(response.status).toBe(400);
  });

  it("rejects a stale expectedVersion without consuming the execution gate", async () => {
    const saved = await getRunRepository().save(makeGatedRun("run-gate-stale-version"));
    const response = await postAnswer("run-gate-stale-version", {
      nodeId: "build-ui",
      answer: "Aceptar conflicto y continuar",
      expectedVersion: saved.version + 1
    });

    expect(response.status).toBe(409);
    const run = await getRunRepository().get("run-gate-stale-version");
    expect(run.status).toBe("paused");
    expect(run.pendingDecision?.gateId).toBe("merge_conflict:build-ui:abc12345");
  });

  it("double submit: one 200, one structured 409", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-dup"));
    const [first, second] = await Promise.all([
      postAnswer("run-gate-dup", { nodeId: "build-ui", answer: "Aceptar conflicto y continuar" }),
      postAnswer("run-gate-dup", { nodeId: "build-ui", answer: "Aceptar conflicto y continuar" })
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
  });

  it("routes the replan option out-of-band for a leaf gate", async () => {
    await getRunRepository().save(
      makeGatedRun("run-gate-replan", {
        pendingDecision: {
          gate: "leaf_validation_failed",
          gateId: "leaf_validation_failed:task-1:abc12345",
          taskId: "task-1",
          validationOutput: "tests failed"
        },
        pendingQuestion: {
          nodeId: "task-1",
          question: "La validación falló. ¿Cómo querés continuar?",
          options: ["Reintentar reparación", "Re-planificar subárbol", "Aceptar fallo y continuar", "Abortar run"]
        }
      })
    );
    const response = await postAnswer("run-gate-replan", {
      nodeId: "task-1",
      answer: "Re-planificar subárbol"
    });
    expect(response.status).toBe(200);
    const run = await getRunRepository().get("run-gate-replan");
    expect(run.pendingDecision).toBeUndefined();
  });
});

describe("POST /decisions/[decisionId] with an execution gate (regression after service extraction)", () => {
  it("resolves the gate with { answer: <option label> }", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-decision"));
    await raiseGateDecision("run-gate-decision", "build-ui");

    const response = await postDecision("run-gate-decision", "clarify:build-ui", {
      answer: "Aceptar conflicto y continuar"
    });
    expect(response.status).toBe(200);

    const run = await getRunRepository().get("run-gate-decision");
    expect(run.status).toBe("running");
    expect(run.pendingDecision).toBeUndefined();
  });

  it("still 400s a generic approve action against a clarify gate, with an actionable error", async () => {
    await getRunRepository().save(makeGatedRun("run-gate-approve"));
    await raiseGateDecision("run-gate-approve", "build-ui");

    const response = await postDecision("run-gate-approve", "clarify:build-ui", {
      choice: { action: "approve" }
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error.length).toBeGreaterThan(0);
  });
});
