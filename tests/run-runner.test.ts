import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  publishRunEvent,
  subscribeRunEvents,
  getRunEventHistory,
  clearRunEventHistory
} from "@/lib/server/runs/event-bus";
import {
  runExecutionPipeline,
  runPlanningPipeline
} from "@/lib/server/runs/runner";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";

const runIdBase = "test-run";

let tempDir: string;
let runsDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-runner-"));
  runsDir = path.join(tempDir, "runs");
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  // Anchor the runner's loadBenchmarkManifest at the actual repo root.
  process.env.MANYHANDS_REPO_ROOT = path.resolve(__dirname, "..");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_RUNS_DIR;
  delete process.env.MANYHANDS_REPO_ROOT;
  resetRunRepositoryForTests();
  clearRunEventHistory(`${runIdBase}-planning`);
  clearRunEventHistory(`${runIdBase}-execution`);
  await rm(tempDir, { recursive: true, force: true });
});

describe("RunRunner", () => {
  it("planning pipeline emits node.added events and transitions to needs_review", async () => {
    const runId = `${runIdBase}-planning`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      scenarioId: "passwordless-login",
      granularity: "balanced",
      model: "claude-opus-4.7",
      userPrompt: "",
      title: "test",
      status: "created",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z"
    });

    const events: string[] = [];
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      events.push(event.kind);
    });

    await runPlanningPipeline(runId, { intervalMs: 0 });
    unsubscribe();

    expect(events).toContain("node.added");
    expect(events.filter((kind) => kind === "node.added").length).toBeGreaterThan(0);
    expect(events.at(-1)).toBe("status.changed");
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("needs_review");
    expect(finalRun.planning).toBeDefined();
  });

  it("publishRunEvent stores history retrievable via getRunEventHistory", () => {
    const runId = "history-run";
    publishRunEvent(runId, { kind: "node.added", taskId: "t1", at: "2026-05-26T00:00:00.000Z" });
    publishRunEvent(runId, { kind: "heartbeat", at: "2026-05-26T00:00:01.000Z" });
    const history = getRunEventHistory(runId);
    expect(history.length).toBe(2);
    expect(history[0]?.kind).toBe("node.added");
    clearRunEventHistory(runId);
    expect(getRunEventHistory(runId)).toEqual([]);
  });

  it("execution pipeline emits agent.run.started/completed and transitions to completed", async () => {
    const runId = `${runIdBase}-execution`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      scenarioId: "passwordless-login",
      granularity: "balanced",
      model: "claude-opus-4.7",
      userPrompt: "",
      title: "test",
      status: "approved",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z"
    });

    const events: string[] = [];
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      events.push(event.kind);
    });

    await runExecutionPipeline(runId, { intervalMs: 0 });
    unsubscribe();

    expect(events).toContain("agent.run.started");
    expect(events).toContain("agent.run.completed");
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("completed");
  }, 30000);
});
