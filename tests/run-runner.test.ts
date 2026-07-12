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
  buildFeatureRequestFromPrompt,
  type ExecutionEngine
} from "@/lib/server/runs/runner";
import { POST as POST_RUN } from "@/app/api/runs/[id]/run/route";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import { drainAllRunBackgroundTasksForTests } from "@/lib/server/runs/runner-state";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { AgentTaskContractSchema } from "@manyhands/contracts";
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
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 10,
    executorTimedOut: false
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for condition.");
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
  decomposition: { graph: { id: string; planId: string; repo: string; baseBranch: string; baseCommit: string; featureRequest: string; nodes: Record<string, unknown>; dependencies: unknown[]; rootId: string; createdAt: string }; contracts: unknown[] };
} {
  const contract = validContract(taskId);
  return {
    decomposition: {
      contracts: [contract],
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
            metadata: { authoredBy: "ai" },
            contract
          }
        },
        dependencies: [],
        rootId: taskId,
        createdAt: "2026-05-26T00:00:00.000Z"
      }
    }
  };
}

function validContract(taskId: string): unknown {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [`src/${taskId}.ts`] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${taskId}.ts`], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: [`src/${taskId}.ts`], testPaths: [], configPaths: [] }
  });
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
  // Drain fire-and-forget pipeline kicks (POST /run) BEFORE restoring the runs
  // dir so no late write leaks into the real .manyhands/runs.
  await drainAllRunBackgroundTasksForTests();
  delete process.env.MANYHANDS_RUNS_DIR;
  resetRunRepositoryForTests();
  clearRunEventHistory(`${runIdBase}-execution`);
  clearRunEventHistory(`${runIdBase}-live-start`);
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
      version: 0,
      status: "approved",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      planning: stubPlanningArtifact("leaf-a"),
      patches: []
    });

    const events: any[] = [];
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      events.push(event);
    });

    const engine = stubEngine({
      runId,
      status: "completed",
      leafResults: [successLeaf("leaf-a")],
      integrationResults: [
        {
          compositeTaskId: "composite-a",
          status: "success",
          childResults: [],
          repairAttempted: false,
        preMergeFindings: []
        }
      ],
      granularityVector: STUB_VECTOR,
      totalDurationMs: 0
    });
    await runExecutionPipeline(runId, { intervalMs: 0, engine });
    unsubscribe();

    const eventKinds = events.map(e => e.kind);
    expect(eventKinds).toContain("agent.run.started");
    expect(eventKinds).toContain("agent.run.completed");

    const startedEvents = events.filter(e => e.kind === "agent.run.started");
    const completedEvents = events.filter(e => e.kind === "agent.run.completed");

    expect(startedEvents.map(e => e.taskId)).toContain("leaf-a");
    expect(startedEvents.map(e => e.taskId)).toContain("composite-a");
    expect(completedEvents.map(e => e.taskId)).toContain("leaf-a");
    expect(completedEvents.map(e => e.taskId)).toContain("composite-a");
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("failed_artifact");
  }, 30000);

  it("streams agent start events from execution traces before the engine finishes", async () => {
    const runId = `${runIdBase}-live-start`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "gemini-2.5-pro",
      userPrompt: "Add a feature",
      title: "test",
      version: 0,
      status: "approved",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      planning: stubPlanningArtifact("leaf-a"),
      patches: []
    });

    const events: any[] = [];
    const unsubscribe = subscribeRunEvents(runId, (event) => {
      events.push(event);
    });
    const releaseEngine = deferred();
    let engineFinished = false;

    const engine: ExecutionEngine = {
      run: async (input) => {
        input.traceStore?.append({ type: "agent_started", actor: "system", taskId: "leaf-a", payload: {} });
        await releaseEngine.promise;
        engineFinished = true;
        return {
          runId,
          status: "completed",
          leafResults: [successLeaf("leaf-a")],
          integrationResults: [],
          granularityVector: STUB_VECTOR,
          totalDurationMs: 1
        };
      }
    };

    const pipeline = runExecutionPipeline(runId, { intervalMs: 0, engine });

    await waitFor(() => events.some((event) => event.kind === "agent.run.started" && event.taskId === "leaf-a"));
    expect(engineFinished).toBe(false);

    releaseEngine.resolve();
    await pipeline;
    unsubscribe();

    expect(events.filter((event) => event.kind === "agent.run.started" && event.taskId === "leaf-a")).toHaveLength(1);
    expect(events.some((event) => event.kind === "agent.run.completed" && event.taskId === "leaf-a")).toBe(true);
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("failed_artifact");
    expect(finalRun.executionTraces?.map((event) => event.type)).toEqual(["agent_started"]);
  }, 30000);

  it("run endpoint persists running before returning to the client", async () => {
    const runId = `${runIdBase}-route-run`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "gemini-2.5-pro",
      userPrompt: "Add a feature",
      title: "test",
      version: 0,
      status: "approved",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      planning: stubPlanningArtifact("leaf-a"),
      patches: []
    });

    const response = await POST_RUN(new Request("http://manyhands.test/api/runs/run/route", { method: "POST" }), {
      params: Promise.resolve({ id: runId })
    });
    const payload = (await response.json()) as { run: { status: string; startedAt?: string } };

    expect(response.status).toBe(200);
    expect(payload.run.status).toBe("running");
    expect(payload.run.startedAt).toBeDefined();
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
      version: 0,
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

  it("continues planning with a fallback title when the titler fails", async () => {
    const runId = `${runIdBase}-titler-fallback`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    const userPrompt = "Build a tiny calculator with buttons and keyboard input.";
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "claude-opus-4.7",
      userPrompt,
      title: userPrompt,
      version: 0,
      status: "created",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      patches: []
    });

    await runPlanningPipeline(runId, {
      intervalMs: 0,
      titler: async () => {
        throw new Error("titler timeout");
      }
    }).catch(() => undefined);

    const finalRun = await store.get(runId);
    expect(finalRun.title).toBe("Build a tiny calculator with buttons and keyboard input.");
    expect(finalRun.summary).toBe("Build a tiny calculator with buttons and keyboard input.");
    expect(finalRun.errorMessage).not.toContain("titler timeout");
  }, 30000);

  it("passes the selected Codex executor and model to the titler", async () => {
    const runId = `${runIdBase}-codex-titler-model`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "gpt-5.5",
      planningModel: "gpt-5.5",
      planningExecutorId: "codex-cli",
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
      userPrompt: "Build a tiny calculator.",
      title: "Build a tiny calculator.",
      version: 0,
      status: "created",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      patches: []
    });

    const selections: string[] = [];
    await runPlanningPipeline(runId, {
      intervalMs: 0,
      titler: async (input) => {
        selections.push(`${input.selection.executorId}/${input.model}`);
        return { title: "Calculator", summary: "Builds a tiny calculator." };
      }
    }).catch(() => undefined);

    expect(selections).toEqual(["codex-cli/gpt-5.5"]);
  }, 30000);

  it("passes the selected Claude planning model to the titler", async () => {
    const runId = `${runIdBase}-claude-titler-model`;
    const store = new JsonRunRecordStore({ directory: runsDir });
    await store.save({
      runId,
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "opus",
      planningModel: "opus",
      planningExecutorId: "claude-code-cli",
      userPrompt: "Build a tiny calculator.",
      title: "Build a tiny calculator.",
      version: 0,
      status: "created",
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      patches: []
    });

    const selections: string[] = [];
    await runPlanningPipeline(runId, {
      intervalMs: 0,
      titler: async (input) => {
        selections.push(`${input.selection.executorId}/${input.model}`);
        return { title: "Calculator", summary: "Builds a tiny calculator." };
      }
    }).catch(() => undefined);

    expect(selections).toEqual(["claude-code-cli/opus"]);
  }, 30000);

  it("builds feature request with a clean representative title when provided", () => {
    const mockWorkspace = {
      id: "ws-1",
      slug: "ws-1",
      name: "Workspace 1",
      repoPath: "/path/to/repo",
      allowedPaths: ["src/**/*"],
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z"
    };

    const prompt = "build a cool calculator app that parses strings and evaluates them";
    
    // Test with custom title
    const requestWithTitle = buildFeatureRequestFromPrompt(prompt, mockWorkspace, "Calculator App");
    expect(requestWithTitle.title).toBe("Calculator App");
    expect(requestWithTitle.description).toBe(prompt);

    // Test fallback (no custom title provided)
    const requestWithoutTitle = buildFeatureRequestFromPrompt(prompt, mockWorkspace);
    expect(requestWithoutTitle.title).toBe(prompt.slice(0, 120));
  });
});
