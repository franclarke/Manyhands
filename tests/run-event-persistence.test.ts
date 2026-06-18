import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as POST_RUN } from "@/app/api/runs/[id]/run/route";
import {
  appendRunEventBestEffort,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import {
  drainAllRunBackgroundTasksForTests,
  drainRunBackgroundTasks
} from "@/lib/server/runs/runner-state";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let runsDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-events-"));
  runsDir = path.join(tempDir, "runs");
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  vi.restoreAllMocks();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("durable run events", () => {
  it("fails a start request when the critical status event cannot be appended", async () => {
    const runId = "run-critical-event";
    await getRunRepository().save(makeRun({ runId }));
    await mkdir(path.join(runsDir, `${runId}.events.jsonl`), { recursive: true });

    const response = await postRun(runId);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/EISDIR|illegal operation|directory/i);
  });

  it("logs and suppresses explicitly best-effort event append failures", async () => {
    const runId = "run-best-effort-event";
    await mkdir(path.join(runsDir, `${runId}.events.jsonl`), { recursive: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await appendRunEventBestEffort(runId, {
      actor: "system",
      at: "2026-06-11T00:00:00.000Z",
      type: "plan.started",
      payload: {}
    });

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("best-effort append failed"));
  });

  it("drains a route-started background pipeline before temp cleanup", async () => {
    const runId = "run-background-drain";
    await getRunRepository().save(makeRun({ runId }));

    const response = await postRun(runId);
    expect(response.status).toBe(200);

    await drainRunBackgroundTasks(runId);

    const events = await readRunModelEvents(runId);
    expect(events.some((event) => event.type === "run.status.changed")).toBe(true);
    await expect(rm(runsDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });
});

function postRun(runId: string): Promise<Response> {
  return POST_RUN(new Request(`http://manyhands.test/api/runs/${runId}/run`, { method: "POST" }), {
    params: Promise.resolve({ id: runId })
  });
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-event",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "approved",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    planning: planningArtifact("leaf-a"),
    patches: [],
    ...overrides
  };
}

function planningArtifact(taskId: string) {
  return {
    decomposition: {
      graph: {
        id: "g1",
        planId: "p1",
        repo: "stub",
        baseBranch: "main",
        baseCommit: "0".repeat(40),
        featureRequest: "stub",
        rootId: taskId,
        createdAt: "2026-06-11T00:00:00.000Z",
        dependencies: [],
        nodes: {
          [taskId]: {
            id: taskId,
            kind: "leaf",
            parentId: null,
            title: taskId,
            goal: taskId,
            status: "planned",
            granularity: "auto",
            depth: 0,
            childrenIds: [],
            dependencies: [],
            metadata: { authoredBy: "ai" }
          }
        }
      }
    }
  };
}
