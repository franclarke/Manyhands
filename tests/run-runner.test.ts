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
  runPlanningPipeline,
  type ExecutionEngine
} from "@/lib/server/runs/runner";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { AgentExecutionResult, GranularityVector, RunExecutionResult } from "@manyhands/execution-core";

/** Deterministic execution engine double: returns a canned successful run. */
function stubEngine(result: RunExecutionResult): ExecutionEngine {
  return { run: async () => result };
}

function successLeaf(taskId: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "BASE",
    currentHead: `${taskId}_SHA`,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [`src/${taskId}.ts`],
    commitSha: `${taskId}_SHA`,
    scopeCheck: { passed: true, violations: [] },
    executorExitCode: 0,
    executorDurationMs: 10,
    executorTimedOut: false
  };
}

const STUB_VECTOR: GranularityVector = {
  depth: 1,
  leafCount: 1,
  compositeCount: 1,
  avgLeafDepth: 1,
  maxLeafDepth: 1,
  dependencyCount: 0,
  avgAcceptanceCriteriaPerLeaf: 0,
  integrationSuccessRate: 1,
  leafSuccessRate: 1,
  conflictRate: 0,
  totalDurationMs: 0,
  linesChanged: 0,
  unexpectedCommitCount: 0,
  scopeViolationCount: 0
};

const runIdBase = "test-run";

/**
 * Minimal planning artifact stub: a single-leaf TaskGraph wrapped in the
 * shape `resolveExecutionGraph()` expects (`{ decomposition: { graph } }`).
 * The execution pipeline only needs the graph; tests inject a stub engine
 * so the contents are never exercised by a real RunExecutor.
 */
function stubPlanningArtifact(taskId: string): {
  decomposition: { graph: { id: string; planId: string; repo: string; baseBranch: string; baseCommit: string; featureRequest: string; nodes: Record<string, unknown>; dependencies: unknown[]; rootId: string; createdAt: string } };
} {
  return {
    decomposition: {
      graph: {
        id: "g1",
        planId: "p1",
        repo: "stub",
        baseBranch: "main",
        baseCommit: "0".repeat(40),
        featureRequest: "stub",
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
        },
        dependencies: [],
        rootId: taskId,
        createdAt: "2026-05-26T00:00:00.000Z"
      }
    }
  };
}

let tempDir: string;
let runsDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-runner-"));
  runsDir = path.join(tempDir, "runs");
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_RUNS_DIR;
  resetRunRepositoryForTests();
  clearRunEventHistory(`${runIdBase}-execution`);
  await rm(tempDir, { recursive: true, force: true });
});

describe("RunRunner", () => {
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
      granularity: "balanced",
      model: "claude-opus-4.7",
      userPrompt: "Add a feature",
      title: "test",
      status: "approved",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      planning: stubPlanningArtifact("leaf-a"),
      patches: []
    });

    const events: string[] = [];
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      events.push(event.kind);
    });

    const engine = stubEngine({
      runId,
      status: "completed",
      leafResults: [successLeaf("leaf-a")],
      integrationResults: [],
      granularityVector: STUB_VECTOR,
      totalDurationMs: 0
    });
    await runExecutionPipeline(runId, { intervalMs: 0, engine });
    unsubscribe();

    expect(events).toContain("agent.run.started");
    expect(events).toContain("agent.run.completed");
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("completed");
  }, 30000);

  it("applies an injected titler to the run record during planning", async () => {
    const runId = `${runIdBase}-titler`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "claude-opus-4.7",
      userPrompt: "Construí una mini-app de hábitos con persistencia local.",
      title: "Construí una mini-app de hábitos con persistencia local.",
      status: "created",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      patches: []
    });

    const events: string[] = [];
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      events.push(event.kind);
    });

    // The titler runs first and persists synchronously. Decomposition then fails
    // (no Gemini / no workspace in the test env) and the run ends `failed`, but
    // the title/summary were already written — that is what we assert.
    await runPlanningPipeline(runId, {
      intervalMs: 0,
      titler: async () => ({ title: "Habit counter", summary: "Mini-app de hábitos con persistencia local." })
    }).catch(() => undefined);
    unsubscribe();

    const finalRun = await store.get(runId);
    expect(finalRun.title).toBe("Habit counter");
    expect(finalRun.summary).toBe("Mini-app de hábitos con persistencia local.");
    expect(events).toContain("title.updated");
  }, 30000);
});
