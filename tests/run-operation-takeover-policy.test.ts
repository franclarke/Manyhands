import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pipelineKicks = vi.hoisted(() => ({
  execution: [] as string[],
  planning: [] as string[]
}));

vi.mock("@/lib/server/runs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/runs")>();
  return {
    ...actual,
    runExecutionPipeline: async (runId: string): Promise<void> => {
      pipelineKicks.execution.push(runId);
    },
    runPlanningPipeline: async (runId: string): Promise<void> => {
      pipelineKicks.planning.push(runId);
    },
    resumePlanningPipeline: async (runId: string): Promise<void> => {
      pipelineKicks.planning.push(runId);
    }
  };
});

import { POST as POST_ANSWER } from "@/app/api/runs/[id]/answer/route";
import { POST as POST_RESUME } from "@/app/api/runs/[id]/resume/route";
import { POST as POST_RUN } from "@/app/api/runs/[id]/run/route";
import { clearExecutionPause } from "@/lib/server/runs/execution-host";
import {
  resumeExecutionPipeline,
  runExecutionPipeline
} from "@/lib/server/runs/execution-pipeline";
import { DEFAULT_STALE_MS } from "@/lib/server/runs/interrupted";
import {
  resumePlanningPipeline,
  runPlanningPipeline
} from "@/lib/server/runs/planning-pipeline";
import type { RunOperationKind, RunRecord } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import {
  drainAllRunBackgroundTasksForTests
} from "@/lib/server/runs/runner-state";
import { AgentTaskContractSchema } from "@manyhands/contracts";
import { JsonFileCheckpointSaver, planningThreadId } from "@manyhands/orchestrator-graph";

let tempDir: string;
let runsDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-operation-takeover-"));
  runsDir = path.join(tempDir, "runs");
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  pipelineKicks.execution.length = 0;
  pipelineKicks.planning.length = 0;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  await drainAllRunBackgroundTasksForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("pipeline operation takeover policy", () => {
  it("planning start does not fence a fresh owner", async () => {
    const runId = "takeover-planning-start";
    const operation = activeOperation("planning", false);
    await getRunRepository().save(makeRun({
      runId,
      status: "created",
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));
    const titler = vi.fn(async () => ({ title: "Should not run", summary: "Should not run" }));

    await runPlanningPipeline(runId, { titler });

    expect(titler).not.toHaveBeenCalled();
    await expectOwnerToSurvive(runId, operation);
  });

  it("planning resume does not fence a fresh owner", async () => {
    const runId = "takeover-planning-resume";
    const operation = activeOperation("planning", false);
    await getRunRepository().save(makeRun({
      runId,
      status: "paused",
      pausedDuring: "generating",
      pendingQuestion: { nodeId: "question", question: "REST?", options: ["REST", "GraphQL"] },
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));
    await seedPlanningCheckpoint(runId);

    await resumePlanningPipeline(runId, { answer: "REST" });

    await expectOwnerToSurvive(runId, operation);
  });

  it("execution start and resume do not fence a fresh owner", async () => {
    const startId = "takeover-execution-start";
    const startOperation = activeOperation("execution", false);
    const engine = { run: vi.fn() };
    await getRunRepository().save(makeRun({
      runId: startId,
      status: "approved",
      mutationFence: startOperation.fencingToken,
      activeOperation: startOperation
    }));

    await runExecutionPipeline(startId, { engine });

    expect(engine.run).not.toHaveBeenCalled();
    await expectOwnerToSurvive(startId, startOperation);

    const resumeId = "takeover-execution-resume";
    const resumeOperation = activeOperation("execution", false);
    await getRunRepository().save(makeRun({
      runId: resumeId,
      status: "paused",
      pausedDuring: "running",
      mutationFence: resumeOperation.fencingToken,
      activeOperation: resumeOperation
    }));

    await resumeExecutionPipeline(resumeId, { action: "retry_repair" }, { engine });

    expect(engine.run).not.toHaveBeenCalled();
    await expectOwnerToSurvive(resumeId, resumeOperation);
  });
});

describe("HTTP start and resume guards", () => {
  it("start rejects a fresh durable owner before returning 200 or scheduling a duplicate", async () => {
    const runId = "start-fresh-owner";
    const operation = activeOperation("execution", false);
    await getRunRepository().save(makeRun({
      runId,
      status: "approved",
      planning: validPlanning(),
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));

    const response = await postWithoutBody(POST_RUN, runId);

    expect(response.status).toBe(409);
    expect(pipelineKicks.execution).toEqual([]);
    await expectOwnerToSurvive(runId, operation);
    await expect(getRunRepository().get(runId)).resolves.toMatchObject({ status: "approved" });
  });

  it("start permits a stale owner and schedules the fenced recovery pipeline", async () => {
    const runId = "start-stale-owner";
    const operation = activeOperation("execution", true);
    await getRunRepository().save(makeRun({
      runId,
      status: "approved",
      planning: validPlanning(),
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));

    const response = await postWithoutBody(POST_RUN, runId);
    await drainAllRunBackgroundTasksForTests();

    expect(response.status).toBe(200);
    expect(pipelineKicks.execution).toEqual([runId]);
    await expect(getRunRepository().get(runId)).resolves.toMatchObject({ status: "running" });
  });

  it("planning answer rejects a fresh owner but permits a stale recovery owner", async () => {
    const freshId = "answer-fresh-owner";
    const freshOperation = activeOperation("planning", false);
    await getRunRepository().save(questionRun(freshId, freshOperation));

    const rejected = await postJson(POST_ANSWER, freshId, { nodeId: "question", answer: "REST" });

    expect(rejected.status).toBe(409);
    expect(pipelineKicks.planning).toEqual([]);
    await expectOwnerToSurvive(freshId, freshOperation);
    await expect(getRunRepository().get(freshId)).resolves.toMatchObject({
      status: "paused",
      pendingQuestion: { nodeId: "question" }
    });

    const staleId = "answer-stale-owner";
    const staleOperation = activeOperation("planning", true);
    await getRunRepository().save(questionRun(staleId, staleOperation));

    const accepted = await postJson(POST_ANSWER, staleId, { nodeId: "question", answer: "REST" });
    await drainAllRunBackgroundTasksForTests();

    expect(accepted.status).toBe(200);
    expect(pipelineKicks.planning).toEqual([staleId]);
    await expect(getRunRepository().get(staleId)).resolves.toMatchObject({ status: "generating" });
  });

  it("plain unpause wakes a fresh durable owner without scheduling a competing pipeline", async () => {
    const runId = "plain-resume-fresh-owner";
    const operation = activeOperation("execution", false);
    await getRunRepository().save(makeRun({
      runId,
      status: "paused",
      pausedDuring: "running",
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));

    const response = await postJson(POST_RESUME, runId, {});
    await drainAllRunBackgroundTasksForTests();

    expect(response.status).toBe(200);
    expect(pipelineKicks.execution).toEqual([]);
    await expect(getRunRepository().get(runId)).resolves.toMatchObject({
      status: "running",
      activeOperation: { operationId: operation.operationId, fencingToken: operation.fencingToken }
    });
  });

  it("plain unpause cannot mutate a paused source while a fork owns its snapshot", async () => {
    const runId = "plain-resume-fork-owner";
    const operation = activeOperation("fork", false);
    await getRunRepository().save(makeRun({
      runId,
      status: "paused",
      pausedDuring: "running",
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));

    const response = await postJson(POST_RESUME, runId, {});

    expect(response.status).toBe(409);
    expect(pipelineKicks.execution).toEqual([]);
    await expectOwnerToSurvive(runId, operation);
    await expect(getRunRepository().get(runId)).resolves.toMatchObject({
      status: "paused",
      pausedDuring: "running"
    });
  });

  it("plain unpause schedules recovery only when the durable owner is stale", async () => {
    const runId = "plain-resume-stale-owner";
    const operation = activeOperation("execution", true);
    await getRunRepository().save(makeRun({
      runId,
      status: "paused",
      pausedDuring: "running",
      mutationFence: operation.fencingToken,
      activeOperation: operation
    }));

    const response = await postJson(POST_RESUME, runId, {});
    await drainAllRunBackgroundTasksForTests();

    expect(response.status).toBe(200);
    expect(pipelineKicks.execution).toEqual([runId]);
  });

  it("execution gate clearing rejects a fresh owner and permits a stale recovery owner", async () => {
    const freshId = "gate-fresh-owner";
    const freshOperation = activeOperation("execution", false);
    await getRunRepository().save(gateRun(freshId, freshOperation));

    await expect(
      clearExecutionPause(freshId, "running", "leaf_validation_failed:leaf-a:fresh")
    ).rejects.toThrow(/fresh heartbeat/i);
    await expect(getRunRepository().get(freshId)).resolves.toMatchObject({
      status: "paused",
      pendingDecision: { gateId: "leaf_validation_failed:leaf-a:fresh" }
    });

    const staleId = "gate-stale-owner";
    const staleOperation = activeOperation("execution", true);
    await getRunRepository().save(gateRun(staleId, staleOperation));

    const cleared = await clearExecutionPause(
      staleId,
      "running",
      "leaf_validation_failed:leaf-a:fresh"
    );

    expect(cleared.status).toBe("running");
    expect(cleared.pendingDecision).toBeUndefined();
  });
});

function activeOperation(kind: RunOperationKind, stale: boolean): NonNullable<RunRecord["activeOperation"]> {
  const at = new Date(Date.now() - (stale ? DEFAULT_STALE_MS + 60_000 : 0)).toISOString();
  return {
    operationId:
      kind === "planning"
        ? "00000000-0000-4000-8000-000000000041"
        : "00000000-0000-4000-8000-000000000042",
    kind,
    fencingToken: 7,
    acquiredAt: at,
    heartbeatAt: at
  };
}

function questionRun(
  runId: string,
  operation: NonNullable<RunRecord["activeOperation"]>
): RunRecord {
  return makeRun({
    runId,
    status: "paused",
    pausedDuring: "generating",
    pendingQuestion: { nodeId: "question", question: "REST or GraphQL?", options: ["REST", "GraphQL"] },
    mutationFence: operation.fencingToken,
    activeOperation: operation
  });
}

function gateRun(
  runId: string,
  operation: NonNullable<RunRecord["activeOperation"]>
): RunRecord {
  return makeRun({
    runId,
    status: "paused",
    pausedDuring: "running",
    pendingDecision: {
      gate: "leaf_validation_failed",
      gateId: "leaf_validation_failed:leaf-a:fresh",
      taskId: "leaf-a",
      validationOutput: "tests failed"
    },
    pendingQuestion: { nodeId: "leaf-a", question: "Continue?", options: ["Retry", "Abort"] },
    mutationFence: operation.fencingToken,
    activeOperation: operation
  });
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "operation-policy",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "sonnet",
    userPrompt: "Build feature",
    title: "Build feature",
    version: 0,
    status: "created",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    patches: [],
    ...overrides
  };
}

function validPlanning(): RunRecord["planning"] {
  const contract = AgentTaskContractSchema.parse({
    taskId: "leaf-a",
    objective: "Implement feature",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "works" }],
    validationCommands: [],
    expectedOutput: { changedFiles: ["src/feature.ts"], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] }
  });
  return {
    decomposition: {
      contracts: [contract],
      graph: {
        id: "graph",
        planId: "plan",
        repo: "repo",
        baseBranch: "main",
        baseCommit: "BASE",
        featureRequest: "Build feature",
        rootId: "leaf-a",
        createdAt: "2026-07-15T00:00:00.000Z",
        dependencies: [],
        nodes: {
          "leaf-a": {
            id: "leaf-a",
            parentId: null,
            kind: "leaf",
            title: "Leaf A",
            goal: "Implement feature",
            status: "planned",
            granularity: "auto",
            depth: 0,
            childrenIds: [],
            dependencies: [],
            acceptanceCriteria: ["works"],
            contract
          }
        }
      }
    }
  };
}

async function seedPlanningCheckpoint(runId: string): Promise<void> {
  const saver = new JsonFileCheckpointSaver(path.join(runsDir, "checkpoints"));
  await saver.put(
    { configurable: { thread_id: planningThreadId(runId) } },
    {
      v: 1,
      id: "checkpoint-fresh-owner",
      ts: new Date().toISOString(),
      channel_values: {},
      channel_versions: {},
      versions_seen: {}
    },
    { source: "loop", step: 1, parents: {} },
    {}
  );
}

async function expectOwnerToSurvive(
  runId: string,
  operation: NonNullable<RunRecord["activeOperation"]>
): Promise<void> {
  await expect(getRunRepository().get(runId)).resolves.toMatchObject({
    mutationFence: operation.fencingToken,
    activeOperation: {
      operationId: operation.operationId,
      fencingToken: operation.fencingToken,
      heartbeatAt: operation.heartbeatAt
    }
  });
}

type RoutePost = (
  request: Request,
  context: { params: Promise<{ id: string }> }
) => Promise<Response>;

function postWithoutBody(handler: RoutePost, runId: string): Promise<Response> {
  return handler(new Request(`http://manyhands.test/api/runs/${runId}`, { method: "POST" }), {
    params: Promise.resolve({ id: runId })
  });
}

function postJson(handler: RoutePost, runId: string, body: unknown): Promise<Response> {
  return handler(
    new Request(`http://manyhands.test/api/runs/${runId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: runId }) }
  );
}
