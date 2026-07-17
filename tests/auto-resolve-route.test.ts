import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTaskContract } from "@manyhands/contracts";
import type { PlanningFlowResult as MockPlanningFlowResult } from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import { POST as POST_AUTO_RESOLVE } from "@/app/api/runs/[id]/auto-resolve/route";
import { deriveConflictList } from "@/lib/conflict-view-model";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import {
  getRunRepository,
  resetRunRepositoryForTests,
  type RunPatch,
  type RunRecord
} from "@/lib/server/runs";

const now = "2026-06-03T00:00:00.000Z";
let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-auto-resolve-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

function actionableConflictCount(run: RunRecord): number {
  const snapshot = projectRunRecordToSnapshot(run);
  if (snapshot === null) return 0;
  return deriveConflictList(snapshot, run.patches ?? []).filter(
    (conflict) => !conflict.acknowledged && ["medium", "high", "blocking"].includes(conflict.level)
  ).length;
}

describe("POST auto-resolve", () => {
  it("acknowledges every actionable conflict and preserves approval", async () => {
    const repo = getRunRepository();
    const run = makeConflictingRun({ status: "approved", approvedAt: now });
    await repo.save(run);

    const expected = actionableConflictCount(run);
    expect(expected).toBeGreaterThan(0); // precondition: the fixture really conflicts

    const response = await POST_AUTO_RESOLVE(new Request("http://mh.test"), {
      params: Promise.resolve({ id: "run-1" })
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { resolvedCount: number };
    expect(body.resolvedCount).toBe(expected);

    const saved = await repo.get("run-1");
    // Advisory acknowledgements must NOT revoke approval (approve → auto-resolve → run).
    expect(saved.status).toBe("approved");
    expect(saved.approvedAt).toBe(now);
    expect(saved.patches).toHaveLength(expected);
    expect((saved.patches as RunPatch[]).every((patch) => patch.type === "RISK_ACKNOWLEDGED")).toBe(true);
    expect(actionableConflictCount(saved)).toBe(0);
  });

  it("is idempotent: a second call resolves nothing", async () => {
    const repo = getRunRepository();
    await repo.save(makeConflictingRun({ status: "approved", approvedAt: now }));

    await POST_AUTO_RESOLVE(new Request("http://mh.test"), { params: Promise.resolve({ id: "run-1" }) });
    const second = await POST_AUTO_RESOLVE(new Request("http://mh.test"), {
      params: Promise.resolve({ id: "run-1" })
    });
    const body = (await second.json()) as { resolvedCount: number };
    expect(body.resolvedCount).toBe(0);
  });
});

function makeConflictingRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-flash",
    userPrompt: "Build a feature",
    title: "Build a feature",
    version: 0,
    status: "needs_review",
    createdAt: now,
    updatedAt: now,
    planning: makeConflictingPlanning(),
    patches: [],
    ...overrides
  };
}

function makeConflictingPlanning(): MockPlanningFlowResult {
  // task-1 and task-2 both write src/shared.ts, and task-2 consumes a symbol
  // task-1 produces — a strong file + producer/consumer overlap.
  const contractOne = makeContract({
    taskId: "task-1",
    changedFiles: ["src/shared.ts"],
    producedSymbols: ["SharedThing"]
  });
  const contractTwo = makeContract({
    taskId: "task-2",
    changedFiles: ["src/shared.ts"],
    consumedSymbols: ["SharedThing"]
  });
  const graph: TaskGraph = {
    id: "graph-1",
    planId: "plan-1",
    repo: "manyhands",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Build a feature",
    rootId: "root",
    createdAt: now,
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["task-1", "task-2"],
        dependencies: []
      },
      "task-1": leafNode("task-1", "First", contractOne),
      "task-2": leafNode("task-2", "Second", contractTwo)
    },
    dependencies: []
  };

  return {
    summary: {
      runId: "planning-run",
      featureId: "feature-1",
      mode: "balanced",
      schedulerPolicy: "risk_aware",
      taskCount: 2,
      leafCount: 2,
      dependencyCount: 0,
      contractCount: 2,
      riskPredictionCount: 0,
      staticConflictSignalCount: 0,
      batchCount: 0,
      batches: [],
      traceEventCount: 0,
      validationIssues: []
    },
    decomposition: {
      feature: {
        id: "feature-1",
        title: "Feature",
        description: "Build a feature",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Criterion"]
      },
      graph,
      contracts: [contractOne, contractTwo],
      metadata: { mode: "balanced", generatedAt: now, decomposer: "test", deterministic: true },
      validation: { graphValid: true, contractValid: true, issues: [] }
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { policy: "risk_aware", batches: [], blocked: [], explanations: [] },
    traces: []
  };
}

function leafNode(id: string, title: string, contract: AgentTaskContract) {
  return {
    id,
    parentId: "root",
    kind: "leaf" as const,
    title,
    goal: `${title} objective`,
    status: "planned" as const,
    granularity: "fine" as const,
    depth: 1,
    childrenIds: [],
    dependencies: [],
    contract,
    metadata: { authoredBy: "ai" as const }
  };
}

function makeContract(overrides: {
  taskId: string;
  changedFiles: string[];
  producedSymbols?: string[];
  consumedSymbols?: string[];
}): AgentTaskContract {
  return {
    taskId: overrides.taskId,
    objective: `${overrides.taskId} objective`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: overrides.changedFiles },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "Criterion" }],
    validationCommands: [],
    expectedOutput: {
      changedFiles: overrides.changedFiles,
      producedSymbols: overrides.producedSymbols ?? [],
      consumedSymbols: overrides.consumedSymbols ?? []
    },
    limits: { maxDurationMs: 1000, maxCostUsd: 0 },
    knownRisks: [],
    definitionOfDone: "Criterion"
  };
}
