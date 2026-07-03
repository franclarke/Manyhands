/**
 * U4 — agent-status evidence ref (`status://runs/{id}/node/{nodeId}`).
 *
 * The artifacts API surfaces the agent's MH_STATUS reports + the routed
 * executor + the classified failure for a node, so the focus panel can show
 * what the agent is doing (live) and why it failed (post-mortem).
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as GET_ARTIFACTS } from "@/app/api/runs/[id]/artifacts/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-status-ref-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(runId: string, overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "running",
    createdAt: "2026-06-12T00:00:00.000Z",
    updatedAt: "2026-06-12T00:00:00.000Z",
    patches: [],
    ...overrides
  };
}

async function getArtifact(runId: string, ref: string): Promise<Response> {
  return GET_ARTIFACTS(new Request(`http://mh.test/api/runs/${runId}/artifacts?ref=${encodeURIComponent(ref)}`), {
    params: Promise.resolve({ id: runId })
  });
}

describe("status:// artifact ref", () => {
  it("renders MH_STATUS updates, executor routing, and the classified failure", async () => {
    const runId = "run-status-rich";
    await getRunRepository().save(
      makeRun(runId, {
        executionTraces: [
          {
            id: "trace-1",
            type: "executor_routed",
            actor: "system",
            taskId: "task-1",
            payload: { executorId: "gemini", tier: "standard" },
            timestamp: "2026-06-12T00:01:00.000Z"
          },
          {
            id: "trace-2",
            type: "agent_status",
            actor: "agent",
            taskId: "task-1",
            payload: { message: "Escribiendo el modelo de datos…" },
            timestamp: "2026-06-12T00:02:00.000Z"
          },
          {
            id: "trace-3",
            type: "agent_status",
            actor: "agent",
            taskId: "other-task",
            payload: { message: "no es de este nodo" },
            timestamp: "2026-06-12T00:02:30.000Z"
          }
        ] as never,
        execution: {
          runId,
          status: "failed",
          leafResults: [
            {
              taskId: "task-1",
              status: "validation_failed",
              executorExitCode: 1,
              executorDurationMs: 10,
              changedFiles: [],
              diff: "",
              failureKind: "timeout",
              failureHint: "El executor superó el timeout configurado."
            }
          ],
          integrationResults: [],
          totalDurationMs: 10,
          granularityVector: {}
        } as never
      })
    );

    const response = await getArtifact(runId, `status://runs/${runId}/node/task-1`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; content: string; title: string };
    expect(body.kind).toBe("log");
    expect(body.content).toContain("Escribiendo el modelo de datos…");
    expect(body.content).toContain("gemini");
    expect(body.content).toContain("failure: timeout");
    expect(body.content).not.toContain("no es de este nodo");
  });

  it("404s for a node with no traces and no result", async () => {
    const runId = "run-status-empty";
    await getRunRepository().save(makeRun(runId));
    const response = await getArtifact(runId, `status://runs/${runId}/node/ghost-task`);
    expect(response.status).toBe(404);
  });
});
