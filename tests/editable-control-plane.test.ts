import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentTaskContract,
  MockPlanningFlowResult,
  RunSnapshot,
  TaskGraph
} from "@manyhands/core";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { PATCH } from "@/app/api/runs/[id]/nodes/[taskId]/route";
import { POST as POST_REGEN } from "@/app/api/runs/[id]/nodes/[taskId]/regen/route";
import { POST as POST_INTEGRATOR } from "@/app/api/runs/[id]/integrator/route";
import { POST as POST_SERIALIZE } from "@/app/api/runs/[id]/serialize/route";
import { DELETE as DELETE_DEPENDENCY } from "@/app/api/runs/[id]/dependencies/route";
import {
  appendPatch,
  applyPatches,
  applyPatchesUpTo,
  getRunRepository,
  resetRunRepositoryForTests,
  type RunPatch,
  type RunRecord
} from "@/lib/server/runs";

const now = "2026-05-26T00:00:00.000Z";
let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-edit-runs-"));
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

describe("editable control plane vertical slice", () => {
  it("appends and replays node patches without mutating the base snapshot", () => {
    const run = makeRun();
    const snapshot = projectRunRecordToSnapshot(run, { applyPatches: false });
    expect(snapshot).not.toBeNull();

    const renamed: RunPatch = {
      id: "patch-1",
      type: "NODE_RENAMED",
      actor: "human",
      createdAt: now,
      taskId: "task-1",
      title: "Edited title"
    };
    const manual: RunPatch = {
      id: "patch-2",
      type: "NODE_MARKED_MANUAL",
      actor: "human",
      createdAt: now,
      taskId: "task-1",
      manual: true
    };
    const executor: RunPatch = {
      id: "patch-3",
      type: "NODE_EXECUTOR_EDITED",
      actor: "human",
      createdAt: now,
      taskId: "task-1",
      executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-flash" }
    };

    const withPatch = appendPatch(appendPatch(appendPatch(run, renamed), manual), executor);
    expect(withPatch.patches).toHaveLength(3);

    const patched = applyPatches(snapshot!, withPatch.patches);
    expect(patched.graphSnapshot.nodes["task-1"]?.title).toBe("Edited title");
    expect(patched.graphSnapshot.nodes["task-1"]?.metadata?.authoredBy).toBe("human");
    expect(patched.graphSnapshot.nodes["task-1"]?.metadata?.executorOverride).toEqual({
      executorId: "gemini-cli",
      model: "gemini-2.5-flash"
    });
    expect(snapshot!.graphSnapshot.nodes["task-1"]?.title).toBe("Original title");

    const firstOnly = applyPatchesUpTo(snapshot!, withPatch.patches, "patch-1");
    expect(firstOnly.graphSnapshot.nodes["task-1"]?.title).toBe("Edited title");
    expect(firstOnly.graphSnapshot.nodes["task-1"]?.metadata?.authoredBy).toBe("ai");
  });

  it("PATCH node writes patches, appends trace events, and invalidates approval", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await PATCH(
      new Request("http://manyhands.test/api", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Edited task",
          objective: "Edited objective",
          allowedPaths: ["src/edited.ts"],
          acceptanceCriteria: ["Edited criterion"],
          manual: true,
          executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-flash" }
        }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "run-1", taskId: "task-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("needs_review");
    expect(saved.approvedAt).toBeUndefined();
    expect(saved.patches.map((patch) => (patch as RunPatch).type)).toEqual([
      "NODE_RENAMED",
      "NODE_OBJECTIVE_EDITED",
      "NODE_PATHS_EDITED",
      "NODE_ACCEPTANCE_EDITED",
      "NODE_MARKED_MANUAL",
      "NODE_EXECUTOR_EDITED"
    ]);

    const planning = saved.planning as MockPlanningFlowResult;
    const patchTraceEvents = planning.traces.filter(
      (event) => event.type === "dag_patch_appended" && event.payload.patchId !== undefined
    );
    expect(patchTraceEvents).toHaveLength(6);
    expect(patchTraceEvents[0]?.taskId).toBe("task-1");
  });

  it("PATCH node clears an executor override back to the run default", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({
      patches: [
        {
          id: "patch-existing-executor",
          type: "NODE_EXECUTOR_EDITED",
          actor: "human",
          createdAt: now,
          taskId: "task-1",
          executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-flash" }
        }
      ]
    }));

    const response = await PATCH(
      new Request("http://manyhands.test/api", {
        method: "PATCH",
        body: JSON.stringify({ executorOverride: null }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "run-1", taskId: "task-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.patches.at(-1)).toMatchObject({
      type: "NODE_EXECUTOR_EDITED",
      executorOverride: null
    });
    const snapshot = projectRunRecordToSnapshot(saved);
    expect(snapshot?.graphSnapshot.nodes["task-1"]?.metadata?.executorOverride).toBeUndefined();
  });

  it("does not persist when a patch would leave the DAG invalid", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await PATCH(
      new Request("http://manyhands.test/api", {
        method: "PATCH",
        body: JSON.stringify({ allowedPaths: [] }),
        headers: { "content-type": "application/json" }
      }),
      { params: Promise.resolve({ id: "run-1", taskId: "task-1" }) }
    );

    expect(response.status).toBe(409);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("approved");
    expect(saved.patches).toHaveLength(0);
    expect((saved.planning as MockPlanningFlowResult).traces).toHaveLength(0);
  });

  it("projects patches into the graph view model and inspector", () => {
    const patches: RunPatch[] = [
      {
        id: "patch-title",
        type: "NODE_RENAMED",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        title: "Patched title"
      },
      {
        id: "patch-objective",
        type: "NODE_OBJECTIVE_EDITED",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        objective: "Patched objective"
      },
      {
        id: "patch-paths",
        type: "NODE_PATHS_EDITED",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        allowedPaths: ["src/patched.ts"],
        forbiddenPaths: ["src/forbidden.ts"]
      },
      {
        id: "patch-acceptance",
        type: "NODE_ACCEPTANCE_EDITED",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        acceptanceCriteria: ["Patched acceptance"]
      },
      {
        id: "patch-manual",
        type: "NODE_MARKED_MANUAL",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        manual: true
      },
      {
        id: "patch-executor",
        type: "NODE_EXECUTOR_EDITED",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-flash" }
      }
    ];
    const run = makeRun({ patches });
    const snapshot = projectRunRecordToSnapshot(run);
    expect(snapshot).not.toBeNull();

    const node = (snapshot as RunSnapshot).graphSnapshot.nodes["task-1"];
    expect(node?.title).toBe("Patched title");
    expect(node?.metadata?.authoredBy).toBe("human");
    expect((node?.metadata?.executorOverride as { model?: string } | undefined)?.model).toBe(
      "gemini-2.5-flash"
    );

    const contract = (snapshot as RunSnapshot).contracts.find((entry) => entry.taskId === "task-1");
    expect(contract?.objective).toBe("Patched objective");
    expect(contract?.allowed.paths).toEqual(["src/patched.ts"]);
    expect(contract?.forbidden.paths).toEqual(["src/forbidden.ts"]);
    expect(contract?.acceptance.map((entry) => entry.description)).toEqual(["Patched acceptance"]);
  });

  it("replays subtree regeneration, integrator creation, and serialization patches", () => {
    const base = projectRunRecordToSnapshot(makeRun(), { applyPatches: false });
    expect(base).not.toBeNull();
    const regeneratedContract = makeContract({
      taskId: "task-1",
      objective: "Regenerated objective",
      allowedPaths: ["src/regenerated.ts"],
      changedFiles: ["src/regenerated.ts"],
      acceptance: ["Regenerated acceptance"]
    });
    const integratorContract = makeContract({
      taskId: "integrator-task-1-task-2",
      objective: "Integrate both task outputs",
      allowedPaths: ["src/integration/**"],
      changedFiles: ["src/integration/notes.md"],
      acceptance: ["Integrated output is coherent."]
    });
    const patches: RunPatch[] = [
      {
        id: "patch-regen",
        type: "SUBTREE_REGENERATED",
        actor: "human",
        createdAt: now,
        taskId: "task-1",
        removedTaskIds: ["task-1"],
        nodes: {
          "task-1": {
            id: "task-1",
            parentId: "root",
            kind: "leaf",
            title: "Regenerated task",
            goal: "Regenerated objective",
            status: "planned",
            granularity: "fine",
            depth: 1,
            childrenIds: [],
            contract: regeneratedContract,
            metadata: { authoredBy: "ai" }
          }
        },
        dependencies: [],
        contracts: [regeneratedContract]
      },
      {
        id: "patch-integrator",
        type: "INTEGRATOR_NODE_CREATED",
        actor: "human",
        createdAt: now,
        taskId: "integrator-task-1-task-2",
        node: {
          id: "integrator-task-1-task-2",
          parentId: "root",
          kind: "integrator",
          title: "Integration task",
          goal: "Integrate both task outputs",
          status: "planned",
          granularity: "fine",
          depth: 1,
          childrenIds: [],
          dependencies: [],
          contract: integratorContract,
          metadata: {
            authoredBy: "human",
            integrator: true,
            integratesTaskIds: ["task-1", "task-2"],
            integrationReason: "Shared files need review."
          }
        },
        contract: integratorContract,
        dependencies: [
          {
            fromTaskId: "task-1",
            toTaskId: "integrator-task-1-task-2",
            type: "logical",
            inferred: false,
            rationale: "Integrator consumes task output."
          },
          {
            fromTaskId: "task-2",
            toTaskId: "integrator-task-1-task-2",
            type: "logical",
            inferred: false,
            rationale: "Integrator consumes task output."
          }
        ]
      },
      {
        id: "patch-serialize",
        type: "TASKS_SERIALIZED",
        actor: "human",
        createdAt: now,
        fromTaskId: "task-1",
        toTaskId: "task-2",
        rationale: "Task 2 should wait for task 1."
      },
      {
        id: "patch-remove-dependency",
        type: "DEPENDENCY_REMOVED",
        actor: "human",
        createdAt: now,
        fromTaskId: "task-2",
        toTaskId: "task-3",
        rationale: "They can run independently."
      }
    ];

    const patched = applyPatches(base!, patches);
    expect(patched.graphSnapshot.nodes["task-1"]?.title).toBe("Regenerated task");
    expect(patched.graphSnapshot.nodes.root?.childrenIds).toContain("integrator-task-1-task-2");
    expect(patched.graphSnapshot.nodes["integrator-task-1-task-2"]?.metadata?.integrator).toBe(true);
    expect(patched.graphSnapshot.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromTaskId: "task-1", toTaskId: "task-2" }),
        expect.objectContaining({ fromTaskId: "task-1", toTaskId: "integrator-task-1-task-2" }),
        expect.objectContaining({ fromTaskId: "task-2", toTaskId: "integrator-task-1-task-2" })
      ])
    );
    expect(patched.graphSnapshot.dependencies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ fromTaskId: "task-2", toTaskId: "task-3" })])
    );
    expect(patched.graphSnapshot.nodes["task-2"]?.dependencies).toContain("task-1");
    expect(patched.graphSnapshot.nodes["task-3"]?.dependencies).not.toContain("task-2");
    expect(patched.graphSnapshot.nodes["integrator-task-1-task-2"]?.dependencies).toEqual(["task-1", "task-2"]);
  });

  it("POST serialize appends a guided dependency patch and trace", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await POST_SERIALIZE(
      jsonRequest({ fromTaskId: "task-1", toTaskId: "task-3", rationale: "Shared state." }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("needs_review");
    expect(saved.patches).toHaveLength(1);
    expect((saved.patches[0] as RunPatch).type).toBe("TASKS_SERIALIZED");
    const snapshot = projectRunRecordToSnapshot(saved);
    expect(snapshot?.graphSnapshot.dependencies).toEqual(
      expect.arrayContaining([expect.objectContaining({ fromTaskId: "task-1", toTaskId: "task-3" })])
    );
    expect(snapshot?.graphSnapshot.nodes["task-3"]?.dependencies).toContain("task-1");
    expect((saved.planning as MockPlanningFlowResult).traces.some((event) => event.type === "dag_patch_appended")).toBe(true);
  });

  it("POST serialize rejects cycles and duplicate dependencies without persisting", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun());

    const duplicate = await POST_SERIALIZE(
      jsonRequest({ fromTaskId: "task-1", toTaskId: "task-2" }),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(duplicate.status).toBe(409);

    const cycle = await POST_SERIALIZE(
      jsonRequest({ fromTaskId: "task-3", toTaskId: "task-1" }),
      { params: Promise.resolve({ id: "run-1" }) }
    );
    expect(cycle.status).toBe(409);

    const saved = await repo.get("run-1");
    expect(saved.patches).toHaveLength(0);
  });

  it("DELETE dependency removes a dependency patch, syncs node shortcut, and invalidates approval", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await DELETE_DEPENDENCY(
      jsonRequest({ fromTaskId: "task-1", toTaskId: "task-2", rationale: "Can run in parallel." }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("needs_review");
    expect(saved.approvedAt).toBeUndefined();
    expect((saved.patches[0] as RunPatch).type).toBe("DEPENDENCY_REMOVED");

    const snapshot = projectRunRecordToSnapshot(saved);
    expect(snapshot?.graphSnapshot.dependencies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ fromTaskId: "task-1", toTaskId: "task-2" })])
    );
    expect(snapshot?.graphSnapshot.nodes["task-2"]?.dependencies).not.toContain("task-1");
  });

  it("DELETE dependency rejects missing dependencies without persisting", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun());

    const response = await DELETE_DEPENDENCY(
      jsonRequest({ fromTaskId: "task-3", toTaskId: "task-1" }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(409);
    const saved = await repo.get("run-1");
    expect(saved.patches).toHaveLength(0);
  });

  it("POST integrator creates an integrator node with metadata and visible view-model marker", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await POST_INTEGRATOR(
      jsonRequest({
        taskIds: ["task-1", "task-2"],
        reason: "Shared schema paths need explicit integration.",
        title: "Schema integration"
      }),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("needs_review");
    const patch = saved.patches[0] as RunPatch;
    expect(patch.type).toBe("INTEGRATOR_NODE_CREATED");
    if (patch.type !== "INTEGRATOR_NODE_CREATED") return;
    expect(patch.node.metadata?.integrator).toBe(true);
    expect(patch.node.metadata?.integratesTaskIds).toEqual(["task-1", "task-2"]);

    const snapshot = projectRunRecordToSnapshot(saved);
    expect(snapshot).not.toBeNull();
    const integratorNode = snapshot?.graphSnapshot.nodes[patch.taskId];
    expect(integratorNode?.metadata?.integrator).toBe(true);
    expect(integratorNode?.metadata?.authoredBy).toBe("human");
    expect(snapshot?.graphSnapshot.nodes.root?.childrenIds).toContain(patch.taskId);
    expect(snapshot?.graphSnapshot.nodes[patch.taskId]?.dependencies).toEqual(["task-1", "task-2"]);
  });

  it("POST regen replaces only the requested subtree, preserves the task id, and traces the patch", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "approved", approvedAt: now }));

    const response = await POST_REGEN(
      jsonRequest({ granularity: "coarse" }),
      { params: Promise.resolve({ id: "run-1", taskId: "task-1" }) }
    );

    expect(response.status).toBe(200);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("needs_review");
    expect(saved.approvedAt).toBeUndefined();
    const patch = saved.patches[0] as RunPatch;
    expect(patch.type).toBe("SUBTREE_REGENERATED");
    if (patch.type !== "SUBTREE_REGENERATED") return;
    expect(patch.taskId).toBe("task-1");
    expect(Object.keys(patch.nodes)).toContain("task-1");
    expect(patch.removedTaskIds).toContain("task-1");

    const snapshot = projectRunRecordToSnapshot(saved);
    expect(snapshot?.graphSnapshot.nodes["task-1"]).toBeDefined();
    expect(snapshot?.graphSnapshot.nodes["task-2"]).toBeDefined();
    expect(snapshot?.graphSnapshot.nodes["task-3"]).toBeDefined();
    expect((saved.planning as MockPlanningFlowResult).traces.some((event) => event.type === "dag_patch_appended")).toBe(true);
  });

  it("POST regen does not persist when the regenerated graft leaves the DAG invalid", async () => {
    const repo = getRunRepository();
    const planning = makePlanning();
    planning.decomposition.graph.nodes["task-1"] = {
      ...planning.decomposition.graph.nodes["task-1"]!,
      parentId: "task-2"
    };
    await repo.save(makeRun({ status: "approved", approvedAt: now, planning }));

    const response = await POST_REGEN(
      jsonRequest({ granularity: "balanced" }),
      { params: Promise.resolve({ id: "run-1", taskId: "task-1" }) }
    );

    expect(response.status).toBe(409);
    const saved = await repo.get("run-1");
    expect(saved.status).toBe("approved");
    expect(saved.patches).toHaveLength(0);
    expect((saved.planning as MockPlanningFlowResult).traces).toHaveLength(0);
  });
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "Build a feature",
    title: "Build a feature",
    status: "needs_review",
    createdAt: now,
    updatedAt: now,
    planning: makePlanning(),
    patches: [],
    ...overrides
  };
}

function makePlanning(): MockPlanningFlowResult {
  const contract = makeContract();
  const contractTwo = makeContract({
    taskId: "task-2",
    objective: "Second objective",
    allowedPaths: ["src/second.ts"],
    changedFiles: ["src/second.ts"],
    acceptance: ["Second criterion"]
  });
  const contractThree = makeContract({
    taskId: "task-3",
    objective: "Third objective",
    allowedPaths: ["src/third.ts"],
    changedFiles: ["src/third.ts"],
    acceptance: ["Third criterion"]
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
        goal: "Coordinate the feature",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["task-1", "task-2", "task-3"],
        dependencies: []
      },
      "task-1": {
        id: "task-1",
        parentId: "root",
        kind: "leaf",
        title: "Original title",
        goal: "Original objective",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract,
        metadata: { authoredBy: "ai" }
      },
      "task-2": {
        id: "task-2",
        parentId: "root",
        kind: "leaf",
        title: "Second task",
        goal: "Second objective",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract: contractTwo,
        metadata: { authoredBy: "ai" }
      },
      "task-3": {
        id: "task-3",
        parentId: "root",
        kind: "leaf",
        title: "Third task",
        goal: "Third objective",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract: contractThree,
        metadata: { authoredBy: "ai" }
      }
    },
    dependencies: [
      {
        fromTaskId: "task-1",
        toTaskId: "task-2",
        type: "logical",
        inferred: false,
        rationale: "Existing order."
      },
      {
        fromTaskId: "task-2",
        toTaskId: "task-3",
        type: "logical",
        inferred: false,
        rationale: "Existing order."
      }
    ]
  };

  return {
    summary: {
      runId: "planning-run",
      featureId: "feature-1",
      mode: "balanced",
      schedulerPolicy: "risk_aware",
      taskCount: 2,
      leafCount: 3,
      dependencyCount: 2,
      contractCount: 3,
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
        acceptanceCriteria: ["Original criterion"]
      },
      graph,
      contracts: [contract, contractTwo, contractThree],
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
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: {
      policy: "risk_aware",
      batches: [],
      blocked: [],
      explanations: []
    },
    traces: []
  };
}

function makeContract(overrides: {
  taskId?: string;
  objective?: string;
  allowedPaths?: string[];
  changedFiles?: string[];
  acceptance?: string[];
} = {}): AgentTaskContract {
  const taskId = overrides.taskId ?? "task-1";
  const objective = overrides.objective ?? "Original objective";
  const allowedPaths = overrides.allowedPaths ?? ["src/original.ts"];
  const changedFiles = overrides.changedFiles ?? ["src/original.ts"];
  const acceptance = overrides.acceptance ?? ["Original criterion"];
  return {
    taskId,
    objective,
    context: {
      typeSignatures: [],
      referenceSnippets: [],
      conventions: [],
      upstreamArtifacts: []
    },
    allowed: {
      paths: allowedPaths
    },
    forbidden: {
      paths: []
    },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [
      {
        kind: "custom",
        description: acceptance[0] ?? "Criterion"
      }
    ],
    validationCommands: [],
    expectedOutput: {
      changedFiles,
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: {
      maxDurationMs: 1000,
      maxCostUsd: 0
    },
    knownRisks: [],
    definitionOfDone: acceptance[0] ?? "Criterion"
  };
}

function jsonRequest(body: unknown): Request {
  return new Request("http://manyhands.test/api", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}

describe("projectRunRecordToSnapshot — real execution results", () => {
  function leaf(taskId: string, status: string, extra: Record<string, unknown> = {}) {
    return {
      taskId,
      status,
      baseHead: "base",
      currentHead: status === "success" ? "commit" : "base",
      agentCommittedUnexpectedly: false,
      diff: status === "success" ? "diff --git a/x b/x" : "",
      changedFiles: status === "success" ? ["src/original.ts"] : [],
      scopeCheck: { passed: true, violations: [] },
      executorExitCode: status === "success" ? 0 : 1,
      executorDurationMs: 1234,
      executorTimedOut: false,
      ...extra
    };
  }

  function makeFailedRun(): RunRecord {
    return makeRun({
      status: "failed",
      execution: {
        runId: "run-1",
        status: "failed",
        leafResults: [
          leaf("task-1", "success", { commitSha: "abc123" }),
          leaf("task-2", "executor_error", {
            stderrTail: "Error: Quota exceeded for quota metric 'GenerateContent requests'."
          })
        ],
        integrationResults: [],
        granularityVector: {},
        totalDurationMs: 4000
      } as unknown as RunRecord["execution"],
      executionTraces: [
        { id: "t1", type: "executor_started", actor: "system", taskId: "task-2", timestamp: now, payload: {} },
        { id: "t2", type: "executor_completed", actor: "system", taskId: "task-2", timestamp: now, payload: { exitCode: 1, timedOut: false } }
      ] as unknown as RunRecord["executionTraces"]
    });
  }

  it("projects leaf results into agentRunResults with per-node pass/fail", () => {
    const snapshot = projectRunRecordToSnapshot(makeFailedRun());
    expect(snapshot).not.toBeNull();
    expect(snapshot!.agentRunResults).toHaveLength(2);
    expect(snapshot!.metadata.deterministic).toBe(false);

    const byTask = new Map(snapshot!.agentRunResults.map((result) => [result.taskId, result]));
    expect(byTask.get("task-1")?.success).toBe(true);
    expect(byTask.get("task-2")?.success).toBe(false);
  });

  it("surfaces the executor stderr as the failure cause in the inspector", () => {
    const snapshot = projectRunRecordToSnapshot(makeFailedRun());
    const task2 = snapshot!.agentRunResults.find((result) => result.taskId === "task-2");
    expect(task2?.success).toBe(false);
    expect((task2?.metadata as { status?: string } | undefined)?.status).toBe("executor_error");
    expect(task2?.stderr).toContain("Quota exceeded");
  });

  it("merges persisted execution traces so the trace tab is populated per task", () => {
    const snapshot = projectRunRecordToSnapshot(makeFailedRun());
    const types = snapshot!.traceEvents
      .filter((event) => event.taskId === "task-2")
      .map((event) => event.type);
    expect(types).toContain("executor_started");
    expect(types).toContain("executor_completed");
  });
});
