import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentTaskContract,
  ConflictPrediction,
  MockPlanningFlowResult,
  RunSnapshot,
  TaskGraph,
  TraceEvent
} from "@manyhands/core";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { deriveConflictList } from "@/lib/conflict-view-model";
import { mergeRunTimeline } from "@/lib/run-timeline";
import { POST as POST_ACKNOWLEDGE_RISK } from "@/app/api/runs/[id]/risks/acknowledge/route";
import {
  applyPatches,
  getRunRepository,
  resetRunRepositoryForTests,
  type RunPatch,
  type RunRecord
} from "@/lib/server/runs";

const now = "2026-05-27T00:00:00.000Z";
let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-conflicts-runs-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) {
    delete process.env.MANYHANDS_RUNS_DIR;
  } else {
    process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  }
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("conflict view model", () => {
  it("detects leaf task conflicts from shared allowed paths", () => {
    const snapshot = snapshotFrom(makeRun());
    const conflicts = deriveConflictList(snapshot, []);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      pairKey: "task-1::task-2",
      taskAId: "task-1",
      taskBId: "task-2",
      acknowledged: false
    });
    expect(conflicts[0]?.sharedPaths).toEqual(expect.arrayContaining(["src/shared/** <-> src/shared/**"]));
    expect(conflicts[0]?.reason).toMatch(/allowed or expected paths overlap/u);
  });

  it("detects leaf task conflicts from shared expected files", () => {
    const snapshot = snapshotFrom(makeRun({
      planning: makePlanning({
        contractOne: makeContract({
          taskId: "task-1",
          allowedPaths: ["src/one/**"],
          changedFiles: ["src/shared/schema.ts"]
        }),
        contractTwo: makeContract({
          taskId: "task-2",
          allowedPaths: ["src/two/**"],
          changedFiles: ["src/shared/schema.ts"]
        })
      })
    }));
    const conflicts = deriveConflictList(snapshot, []);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.sharedFiles).toEqual(["src/shared/schema.ts"]);
    expect(conflicts[0]?.level).toMatch(/medium|high|blocking/u);
  });

  it("does not duplicate pairs and marks acknowledged risks as muted", () => {
    const snapshot = snapshotFrom(makeRun());
    const patch: RunPatch = {
      id: "patch-risk",
      type: "RISK_ACKNOWLEDGED",
      actor: "human",
      createdAt: now,
      taskIds: ["task-2", "task-1"],
      reason: "Acceptable during review."
    };

    const conflicts = deriveConflictList(snapshot, [patch, patch]);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      pairKey: "task-1::task-2",
      acknowledged: true,
      acknowledgedReason: "Acceptable during review."
    });
  });

  it("projects risk acknowledgements onto existing snapshot risk predictions", () => {
    const snapshot = snapshotFrom(makeRun({
      planning: makePlanning({ riskMatrix: [riskPrediction()] })
    }));
    const patched = applyPatches(snapshot, [{
      id: "patch-risk",
      type: "RISK_ACKNOWLEDGED",
      actor: "human",
      createdAt: now,
      taskIds: ["task-1", "task-2"],
      reason: "Pair reviewed."
    }]);

    expect(patched.riskPredictions[0]).toMatchObject({
      acknowledged: true,
      acknowledgedReason: "Pair reviewed."
    });
  });
});

describe("run timeline", () => {
  it("orders run events, traces, and patches while deduplicating dag patch traces", () => {
    const patch: RunPatch = {
      id: "patch-serialize",
      type: "TASKS_SERIALIZED",
      actor: "human",
      createdAt: "2026-05-27T00:02:00.000Z",
      fromTaskId: "task-1",
      toTaskId: "task-2",
      rationale: "Shared file."
    };
    const run = makeRun({
      status: "approved",
      approvedAt: "2026-05-27T00:03:00.000Z",
      startedAt: "2026-05-27T00:01:00.000Z",
      patches: [patch],
      planning: makePlanning({
        traces: [
          traceEvent({
            id: "trace-patch-serialize",
            type: "dag_patch_appended",
            timestamp: patch.createdAt,
            taskId: "task-1",
            payload: { patchId: patch.id, patchType: patch.type }
          }),
          traceEvent({
            id: "trace-risk",
            type: "risk_predicted",
            timestamp: "2026-05-27T00:01:30.000Z",
            payload: { taskIds: ["task-1", "task-2"] }
          })
        ]
      })
    });
    const snapshot = snapshotFrom(run);

    const timeline = mergeRunTimeline({ run, snapshot, patches: run.patches });

    expect(timeline.map((entry) => entry.kind)).toEqual([
      "status",
      "status",
      "trace",
      "patch",
      "status"
    ]);
    expect(timeline.find((entry) => entry.id === "patch-serialize")).toMatchObject({
      type: "TASKS_SERIALIZED",
      taskIds: ["task-1", "task-2"]
    });
    expect(timeline.some((entry) => entry.id === "trace-patch-serialize")).toBe(false);
  });

  it("keeps timeline entry ids unique when trace event ids repeat across phases", () => {
    const run = makeRun({
      planning: makePlanning({
        traces: [
          traceEvent({
            id: "trace-1",
            type: "feature_loaded",
            timestamp: "2026-05-27T00:01:00.000Z"
          }),
          traceEvent({
            id: "trace-1",
            type: "batch_started",
            timestamp: "2026-05-27T00:02:00.000Z",
            taskId: "task-1"
          })
        ]
      })
    });

    const timeline = mergeRunTimeline({ run, snapshot: snapshotFrom(run), patches: [] });
    const ids = timeline.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("trace-1");
  });

  it("extracts affected tasks for editable control-plane patches", () => {
    const patches: RunPatch[] = [
      {
        id: "patch-rename",
        type: "NODE_RENAMED",
        actor: "human",
        createdAt: "2026-05-27T00:01:00.000Z",
        taskId: "task-1",
        title: "Edited"
      },
      {
        id: "patch-regen",
        type: "SUBTREE_REGENERATED",
        actor: "human",
        createdAt: "2026-05-27T00:02:00.000Z",
        taskId: "task-1",
        removedTaskIds: ["task-1"],
        nodes: {},
        dependencies: [],
        contracts: []
      },
      {
        id: "patch-integrator",
        type: "INTEGRATOR_NODE_CREATED",
        actor: "human",
        createdAt: "2026-05-27T00:03:00.000Z",
        taskId: "integrator-1",
        node: {
          id: "integrator-1",
          parentId: "root",
          kind: "integrator",
          title: "Integrator",
          goal: "Integrate",
          status: "planned",
          granularity: "fine",
          depth: 1,
          childrenIds: [],
          dependencies: [],
          metadata: { integratesTaskIds: ["task-1", "task-2"] }
        },
        dependencies: []
      },
      {
        id: "patch-risk",
        type: "RISK_ACKNOWLEDGED",
        actor: "human",
        createdAt: "2026-05-27T00:04:00.000Z",
        taskIds: ["task-1", "task-2"],
        reason: "Reviewed."
      }
    ];
    const run = makeRun({ patches });
    const timeline = mergeRunTimeline({ run, snapshot: snapshotFrom(run), patches });

    expect(timeline.find((entry) => entry.id === "patch-rename")?.taskIds).toEqual(["task-1"]);
    expect(timeline.find((entry) => entry.id === "patch-regen")?.taskIds).toEqual(["task-1"]);
    expect(timeline.find((entry) => entry.id === "patch-integrator")?.taskIds).toEqual([
      "integrator-1",
      "task-1",
      "task-2"
    ]);
    expect(timeline.find((entry) => entry.id === "patch-risk")?.taskIds).toEqual(["task-1", "task-2"]);
  });
});

describe("risk acknowledgement endpoint", () => {
  it("appends a risk acknowledgement patch and trace while invalidating approval", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await POST_ACKNOWLEDGE_RISK(
      jsonRequest({ taskIds: ["task-1", "task-2"], reason: "Reviewed with team." }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("needs_review");
    expect(saved.approvedAt).toBeUndefined();
    expect(saved.patches).toHaveLength(1);
    expect(saved.patches[0]).toMatchObject({
      type: "RISK_ACKNOWLEDGED",
      taskIds: ["task-1", "task-2"],
      reason: "Reviewed with team."
    });
    expect((saved.planning as MockPlanningFlowResult).traces).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "dag_patch_appended" })])
    );
  });

  it("rejects self-pairs, missing tasks, and duplicate acknowledgements without persisting", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({
      patches: [{
        id: "patch-existing-risk",
        type: "RISK_ACKNOWLEDGED",
        actor: "human",
        createdAt: now,
        taskIds: ["task-1", "task-2"],
        reason: "Already reviewed."
      }]
    }));

    const selfPair = await POST_ACKNOWLEDGE_RISK(
      jsonRequest({ taskIds: ["task-1", "task-1"] }),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    const missing = await POST_ACKNOWLEDGE_RISK(
      jsonRequest({ taskIds: ["task-1", "missing-task"] }),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    const duplicate = await POST_ACKNOWLEDGE_RISK(
      jsonRequest({ taskIds: ["task-2", "task-1"] }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(selfPair.status).toBe(409);
    expect(missing.status).toBe(409);
    expect(duplicate.status).toBe(409);
    const saved = await repo.get("run-1");
    expect(saved.patches).toHaveLength(1);
  });
});

function snapshotFrom(run: RunRecord): RunSnapshot {
  const snapshot = projectRunRecordToSnapshot(run);
  if (snapshot === null) {
    throw new Error("Expected run snapshot");
  }
  return snapshot;
}

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "Build a conflicted feature",
    title: "Build a conflicted feature",
    status: "needs_review",
    createdAt: now,
    updatedAt: now,
    planning: makePlanning(),
    patches: [],
    ...overrides
  };
}

function makePlanning(input: {
  contractOne?: AgentTaskContract;
  contractTwo?: AgentTaskContract;
  riskMatrix?: ConflictPrediction[];
  traces?: TraceEvent[];
} = {}): MockPlanningFlowResult {
  const contractOne = input.contractOne ?? makeContract({
    taskId: "task-1",
    allowedPaths: ["src/shared/**"],
    changedFiles: ["src/one.ts"]
  });
  const contractTwo = input.contractTwo ?? makeContract({
    taskId: "task-2",
    allowedPaths: ["src/shared/**"],
    changedFiles: ["src/two.ts"]
  });
  const graph: TaskGraph = {
    id: "graph-1",
    planId: "plan-1",
    repo: "manyhands",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Build a conflicted feature",
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
      "task-1": {
        id: "task-1",
        parentId: "root",
        kind: "leaf",
        title: "Task one",
        goal: contractOne.objective,
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract: contractOne,
        metadata: { authoredBy: "ai" }
      },
      "task-2": {
        id: "task-2",
        parentId: "root",
        kind: "leaf",
        title: "Task two",
        goal: contractTwo.objective,
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract: contractTwo,
        metadata: { authoredBy: "ai" }
      }
    },
    dependencies: []
  };

  return {
    summary: {
      runId: "planning-run",
      featureId: "feature-1",
      mode: "balanced",
      schedulerPolicy: "risk_aware",
      taskCount: 3,
      leafCount: 2,
      dependencyCount: 0,
      contractCount: 2,
      riskPredictionCount: input.riskMatrix?.length ?? 0,
      staticConflictSignalCount: 0,
      batchCount: 0,
      batches: [],
      traceEventCount: input.traces?.length ?? 0,
      validationIssues: []
    },
    decomposition: {
      feature: {
        id: "feature-1",
        title: "Feature",
        description: "Build a conflicted feature",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Done"]
      },
      graph,
      contracts: [contractOne, contractTwo],
      metadata: {
        mode: "balanced",
        generatedAt: now,
        decomposer: "test",
        deterministic: true
      },
      validation: {
        graphValid: true,
        contractValid: true,
        issues: []
      }
    },
    riskMatrix: input.riskMatrix ?? [],
    staticConflictSignals: [],
    schedule: {
      policy: "risk_aware",
      batches: [],
      blocked: [],
      explanations: []
    },
    traces: input.traces ?? []
  };
}

function makeContract(input: {
  taskId: string;
  allowedPaths: string[];
  changedFiles: string[];
}): AgentTaskContract {
  return {
    taskId: input.taskId,
    objective: `Objective ${input.taskId}`,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: {
      paths: input.allowedPaths
    },
    forbidden: {
      paths: []
    },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [
      {
        kind: "custom",
        description: "Done"
      }
    ],
    validationCommands: [],
    expectedOutput: {
      changedFiles: input.changedFiles,
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: {
      maxDurationMs: 1000,
      maxCostUsd: 0
    },
    knownRisks: [],
    definitionOfDone: "Done"
  };
}

function riskPrediction(): ConflictPrediction {
  return {
    taskAId: "task-1",
    taskBId: "task-2",
    level: "medium",
    score: 0.3,
    evidence: [{
      signal: "path_overlap",
      detail: "allowed or expected paths overlap: src/shared/** <-> src/shared/**",
      weight: 0.3
    }],
    sharedFiles: [],
    sharedSymbols: [],
    predictedConflictTypes: ["textual"],
    recommendation: "serialize",
    explanation: "allowed or expected paths overlap: src/shared/** <-> src/shared/**"
  };
}

function traceEvent(input: {
  id: string;
  type: TraceEvent["type"];
  timestamp: string;
  taskId?: string;
  payload?: Record<string, unknown>;
}): TraceEvent {
  return {
    id: input.id,
    type: input.type,
    timestamp: input.timestamp,
    actor: "system",
    planId: "plan-1",
    ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
    payload: input.payload ?? {}
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://manyhands.test/api", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}
