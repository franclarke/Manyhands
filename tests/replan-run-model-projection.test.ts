import { execFile } from "node:child_process";
import { mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTaskContract,
  MockPlanningFlowResult,
  TaskGraph,
  TaskNode
} from "@manyhands/core";

const invokePlanningMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/server/runs/planning-invocation-service", () => ({
  invokePlanning: invokePlanningMock
}));

import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { POST as POST_PAUSE } from "@/app/api/runs/[id]/pause/route";
import { POST as POST_REGEN } from "@/app/api/runs/[id]/nodes/[taskId]/regen/route";
import { replanSubtree } from "@/lib/server/runs/replan-service";
import { runPlanningPipeline } from "@/lib/server/runs/planning-pipeline";
import { resolveExecutionGraph } from "@/lib/server/runs/execution-state";
import {
  hasPendingPlanMutation,
  recoverPendingAmendmentMutations
} from "@/lib/server/runs/plan-mutation-recovery";
import { JsonPlanMutationJournal } from "@/lib/server/runs/plan-mutation-journal";
import {
  drainRunModelEventWritesForTests,
  ensureRunModelEventLogForRun,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import { buildRunModelSeed } from "@/lib/server/runs/run-model-projection";
import { captureRunTargetContext } from "@/lib/server/runs/target-context";
import type { RunRecord } from "@/lib/server/runs/schema";
import type { RunPatch } from "@/lib/server/runs/patches";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import {
  getWorkspaceRepository,
  resetWorkspaceRepositoryForTests
} from "@/lib/server/workspaces";

const execFileAsync = promisify(execFile);
const now = "2026-07-15T00:00:00.000Z";
let tempDir: string;
let previousRunsDir: string | undefined;
let previousWorkspacesFile: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-replan-projection-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  previousWorkspacesFile = process.env.MANYHANDS_WORKSPACES_FILE;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();

  const replacement = planning(replacementGraph());
  invokePlanningMock.mockResolvedValue({
    planning: replacement,
    decomposition: {
      provider: "codex" as const,
      model: "gpt-5.5",
      fallbackUsed: false,
      validationErrors: [],
      generatedAt: now
    }
  });
});

afterEach(async () => {
  await drainRunModelEventWritesForTests();
  invokePlanningMock.mockReset();
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  if (previousWorkspacesFile === undefined) delete process.env.MANYHANDS_WORKSPACES_FILE;
  else process.env.MANYHANDS_WORKSPACES_FILE = previousWorkspacesFile;
  await rm(tempDir, { recursive: true, force: true });
});

describe("replan exact run-model projection", () => {
  it("does not overwrite replanned composite and leaf roles with late additive proposals", async () => {
    const repoPath = await makeGitRepo("repo");
    const workspace = await getWorkspaceRepository().create({
      name: "Replan projection",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));

    const returned = await replanSubtree(
      "run-replan-projection",
      "target",
      "Split work into exact roles"
    );
    await drainRunModelEventWritesForTests();

    const saved = await getRunRepository().get("run-replan-projection");
    expect(returned.activeOperation).toBeUndefined();
    expect(returned.status).toBe("needs_review");
    expect(returned.version).toBe(saved.version);
    const executionGraph = resolveExecutionGraph(saved);
    const events = await readRunModelEvents(saved.runId);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(saved)), events);

    expect(events.filter((event) => event.type === "plan.graph.projected")).toHaveLength(1);
    expect(events.filter((event) => event.type === "plan.node.proposed")).toHaveLength(0);
    expect(saved.patches.map((patch) => (patch as RunPatch).type)).toEqual([
      "SUBTREE_REGENERATED"
    ]);
    expect(saved.planGraphStorage).toEqual({ version: 1, mode: "immutable_base_patch_log" });
    expect((saved.planning as MockPlanningFlowResult).decomposition.graph.nodes.target?.title).toBe(
      "Previously regenerated target"
    );
    expect((saved.planning as MockPlanningFlowResult).decomposition.graph.nodes["target-r1-group"]).toBeUndefined();
    expect(executionGraph.nodes["target-r1-group"]?.kind).toBe("composite");
    expect(model.nodes.get("target")?.role).toBe("composite");
    expect(model.nodes.get("target-r1-group")?.role).toBe("composite");
    expect(model.nodes.get("target-r1-direct")?.role).toBe("leaf");
    expect(model.nodes.get("target-r1-nested")?.role).toBe("leaf");
  });

  it("accepts fenced heartbeat version advances while planning the replacement", async () => {
    const repoPath = await makeGitRepo("repo-heartbeat");
    const workspace = await getWorkspaceRepository().create({
      name: "Replan heartbeat",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));
    invokePlanningMock.mockImplementationOnce(async () => {
      // A real replan normally outlives the 4s heartbeat interval. Simulate
      // its fenced renewal without making this regression sleep in real time.
      await getRunRepository().update("run-replan-projection", (current) => ({
        ...current,
        heartbeatAt: "2026-07-15T00:00:04.000Z",
        activeOperation: current.activeOperation === undefined
          ? undefined
          : { ...current.activeOperation, heartbeatAt: "2026-07-15T00:00:04.000Z" }
      }));
      return {
        planning: planning(replacementGraph()),
        decomposition: {
          provider: "codex" as const,
          model: "gpt-5.5",
          fallbackUsed: false,
          validationErrors: [],
          generatedAt: now
        }
      };
    });

    await expect(
      replanSubtree("run-replan-projection", "target", "Split work after heartbeat")
    ).resolves.toMatchObject({ status: "needs_review", planRevision: 2 });
    const saved = await getRunRepository().get("run-replan-projection");
    expect(saved.activeOperation).toBeUndefined();
    expect(resolveExecutionGraph(saved).nodes["target-r1-group"]?.kind).toBe("composite");
  });

  it("does not overwrite a human pause that lands while the replacement is being planned", async () => {
    const repoPath = await makeGitRepo("repo-pause");
    const workspace = await getWorkspaceRepository().create({
      name: "Replan pause",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));

    let releasePlanning!: () => void;
    const planningBlocked = new Promise<void>((resolve) => {
      releasePlanning = resolve;
    });
    invokePlanningMock.mockImplementationOnce(async () => {
      await planningBlocked;
      return {
        planning: planning(replacementGraph()),
        decomposition: {
          provider: "codex" as const,
          model: "gpt-5.5",
          fallbackUsed: false,
          validationErrors: [],
          generatedAt: now
        }
      };
    });

    const replan = replanSubtree("run-replan-projection", "target", "Pause during planning");
    const owned = await waitForActiveOperation("run-replan-projection");
    const pauseResponse = await POST_PAUSE(
      new Request("http://mh.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: owned.version })
      }),
      { params: Promise.resolve({ id: "run-replan-projection" }) }
    );
    expect(pauseResponse.status).toBe(200);

    releasePlanning();
    await expect(replan).rejects.toThrow(/paused|replan|status/i);

    const saved = await getRunRepository().get("run-replan-projection");
    expect(saved.status).toBe("paused");
    expect(saved.pausedDuring).toBe("running");
    expect(saved.planRevision).toBe(1);
    expect(saved.patches).toHaveLength(1);
    expect(saved.activeOperation).toBeUndefined();
  });

  it("uses the run's immutable target after its workspace is retargeted", async () => {
    const repoA = await makeGitRepo("repo-target-a");
    const repoB = await makeGitRepo("repo-target-b");
    const workspace = await getWorkspaceRepository().create({
      name: "Immutable replan target",
      repoPath: repoA
    });
    const targetContext = await captureRunTargetContext(repoA);
    expect(targetContext).toBeDefined();
    await getRunRepository().save({
      ...record(workspace.id),
      targetContext
    });
    await getWorkspaceRepository().update(workspace.id, { repoPath: repoB });

    await replanSubtree("run-replan-projection", "target", "Stay on the captured target");

    const invocation = invokePlanningMock.mock.calls.at(-1)?.[0] as {
      feature: { repositoryPath: string };
      workspace: { repoPath: string };
    };
    expect(path.resolve(invocation.feature.repositoryPath)).toBe(path.resolve(repoA));
    expect(path.resolve(invocation.workspace.repoPath)).toBe(path.resolve(repoA));
  });

  it("does not publish a replan if the captured repository is replaced during decomposition", async () => {
    const repoPath = await makeGitRepo("repo-replaced-during-replan");
    const workspace = await getWorkspaceRepository().create({
      name: "Replaced during replan",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));
    invokePlanningMock.mockImplementationOnce(async () => {
      await rename(repoPath, path.join(tempDir, "repo-replaced-during-replan-original"));
      await makeGitRepo("repo-replaced-during-replan");
      return {
        planning: planning(replacementGraph()),
        decomposition: {
          provider: "codex" as const,
          model: "gpt-5.5",
          fallbackUsed: false,
          validationErrors: [],
          generatedAt: now
        }
      };
    });

    await expect(
      replanSubtree("run-replan-projection", "target", "Replace the repository mid-call")
    ).rejects.toThrow(/different physical repository|replaced|recreated|diverged/i);

    const saved = await getRunRepository().get("run-replan-projection");
    expect(saved.status).toBe("failed");
    expect(saved.planRevision).toBe(1);
    expect(saved.patches).toEqual([priorSubtreePatch()]);
    expect(saved.activeOperation).toBeUndefined();
    expect(await hasPendingPlanMutation(saved.runId)).toBe(false);
  });

  it("does not publish an initial plan if the captured repository is replaced during decomposition", async () => {
    const runId = "run-planning-target-race";
    const repoPath = await makeGitRepo("repo-replaced-during-planning");
    const workspace = await getWorkspaceRepository().create({
      name: "Replaced during initial planning",
      repoPath
    });
    const seeded = await recordWithTarget(workspace.id, repoPath);
    const { planning: _planning, ...withoutPlanning } = seeded;
    await getRunRepository().save({
      ...withoutPlanning,
      runId,
      status: "generating",
      title: "Planning target race",
      summary: "Testing physical identity at the planning commit boundary",
      patches: []
    });
    invokePlanningMock.mockImplementationOnce(async () => {
      await rename(repoPath, path.join(tempDir, "repo-replaced-during-planning-original"));
      await makeGitRepo("repo-replaced-during-planning");
      return {
        planning: planning(replacementGraph()),
        decomposition: {
          provider: "codex" as const,
          model: "gpt-5.5",
          fallbackUsed: false,
          validationErrors: [],
          generatedAt: now
        }
      };
    });

    await runPlanningPipeline(runId, { intervalMs: 0 });

    const saved = await getRunRepository().get(runId);
    expect(saved.status).toBe("paused");
    expect(saved.pendingQuestion?.nodeId).toBe("__plan_degraded__");
    expect(saved.pendingQuestion?.question).toMatch(
      /different physical repository|replaced|recreated|diverged/i
    );
    expect(saved.planning).toBeUndefined();
    expect(saved.patches).toEqual([]);
    expect(saved.activeOperation).toBeUndefined();
  });

  it("regenerates a subtree against the immutable run target after workspace retargeting", async () => {
    const repoA = await makeGitRepo("repo-regen-target-a");
    const repoB = await makeGitRepo("repo-regen-target-b");
    const workspace = await getWorkspaceRepository().create({
      name: "Immutable regen target",
      repoPath: repoA
    });
    await getRunRepository().save({
      ...await recordWithTarget(workspace.id, repoA),
      status: "needs_review"
    });
    await getWorkspaceRepository().update(workspace.id, { repoPath: repoB });

    const response = await POST_REGEN(
      new Request("http://mh.test/api/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granularity: "balanced" })
      }),
      { params: Promise.resolve({ id: "run-replan-projection", taskId: "target" }) }
    );

    expect(response.status, await response.clone().text()).toBe(200);
    const invocation = invokePlanningMock.mock.calls.at(-1)?.[0] as {
      feature: { repositoryPath: string };
      workspace: { repoPath: string };
    };
    expect(path.resolve(invocation.feature.repositoryPath)).toBe(path.resolve(repoA));
    expect(path.resolve(invocation.workspace.repoPath)).toBe(path.resolve(repoA));
  });

  it("does not publish a regenerated subtree if the target is replaced during decomposition", async () => {
    const repoPath = await makeGitRepo("repo-replaced-during-regen");
    const workspace = await getWorkspaceRepository().create({
      name: "Replaced during subtree regeneration",
      repoPath
    });
    await getRunRepository().save({
      ...await recordWithTarget(workspace.id, repoPath),
      status: "needs_review"
    });
    invokePlanningMock.mockImplementationOnce(async () => {
      await rename(repoPath, path.join(tempDir, "repo-replaced-during-regen-original"));
      await makeGitRepo("repo-replaced-during-regen");
      return {
        planning: planning(replacementGraph()),
        decomposition: {
          provider: "codex" as const,
          model: "gpt-5.5",
          fallbackUsed: false,
          validationErrors: [],
          generatedAt: now
        }
      };
    });

    const response = await POST_REGEN(
      new Request("http://mh.test/api/regen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granularity: "balanced" })
      }),
      { params: Promise.resolve({ id: "run-replan-projection", taskId: "target" }) }
    );

    expect(response.status, await response.clone().text()).toBe(409);
    expect((await response.json()).error).toMatch(
      /different physical repository|replaced|recreated|diverged/i
    );
    const saved = await getRunRepository().get("run-replan-projection");
    expect(saved.status).toBe("needs_review");
    expect(saved.planRevision).toBe(1);
    expect(saved.patches).toEqual([priorSubtreePatch()]);
  });

  it("persists an actionable failed state when the replanning LLM fails before the commit point", async () => {
    const repoPath = await makeGitRepo("repo-llm-failure");
    const workspace = await getWorkspaceRepository().create({
      name: "Replan failure",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));
    invokePlanningMock.mockRejectedValueOnce(new Error("planner service unavailable"));

    await expect(
      replanSubtree("run-replan-projection", "target", "Trigger an explicit failure")
    ).rejects.toThrow("planner service unavailable");

    const saved = await getRunRepository().get("run-replan-projection");
    expect(saved.status).toBe("failed");
    expect(saved.failedDuring).toBe("running");
    expect(saved.errorMessage).toContain("Replan failed: planner service unavailable");
    expect(saved.planRevision).toBe(1);
    expect(saved.patches).toHaveLength(1);
    expect(saved.activeOperation).toBeUndefined();
    const events = await readRunModelEvents(saved.runId);
    expect(events.some((event) =>
      event.type === "run.status.changed" &&
      (event.payload as { status?: string }).status === "failed"
    )).toBe(true);
  });

  it("recovers a post-CAS replan exactly once after the direct finalizer crashes", async () => {
    const repoPath = await makeGitRepo("repo-recovery");
    const workspace = await getWorkspaceRepository().create({
      name: "Replan recovery",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));

    await expect(
      replanSubtree(
        "run-replan-projection",
        "target",
        "Recover after the commit point",
        undefined,
        { afterRecordPersisted: () => { throw new Error("simulated process crash"); } }
      )
    ).rejects.toThrow("simulated process crash");

    const committed = await getRunRepository().get("run-replan-projection");
    expect(committed.status).toBe("needs_review");
    expect(committed.planRevision).toBe(2);
    expect(await hasPendingPlanMutation(committed.runId)).toBe(true);

    await recoverPendingAmendmentMutations(committed.runId);
    await recoverPendingAmendmentMutations(committed.runId);

    expect(await hasPendingPlanMutation(committed.runId)).toBe(false);
    const events = await readRunModelEvents(committed.runId);
    expect(events.filter((event) => event.eventId.startsWith("replan-status:"))).toHaveLength(1);
    expect(events.filter((event) => event.eventId.startsWith("replan-graph:"))).toHaveLength(1);
    expect(events.filter((event) => event.eventId.startsWith("replan-approval:"))).toHaveLength(1);
  });

  it("does not advance graph_prepared while the live replan CAS writer owns the transition", async () => {
    const repoPath = await makeGitRepo("repo-live-replan-cas");
    const workspace = await getWorkspaceRepository().create({
      name: "Live replan CAS writer",
      repoPath
    });
    await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));
    let signalEntered!: () => void;
    let releaseWriter!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const held = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const replan = replanSubtree(
      "run-replan-projection",
      "target",
      "Hold after the RunRecord CAS",
      undefined,
      {
        afterRunRecordCas: async () => {
          signalEntered();
          await held;
        }
      }
    );
    await entered;

    const live = await getRunRepository().get("run-replan-projection");
    const operationId = live.activeOperation?.operationId;
    expect(operationId).toBeDefined();
    expect((await mutationJournal().pending(live.runId))[0]?.status).toBe("graph_prepared");
    try {
      const visible = await ensureRunModelEventLogForRun(live);
      expect((await mutationJournal().pending(live.runId))[0]?.status).toBe("graph_prepared");
      expect((await getRunRepository().get(live.runId)).activeOperation?.operationId).toBe(operationId);
      expect(visible.some((event) => event.type === "plan.graph.projected")).toBe(false);
    } finally {
      releaseWriter();
    }

    await replan;
    expect(await hasPendingPlanMutation(live.runId)).toBe(false);
    const events = await readRunModelEvents(live.runId);
    expect(events.filter((event) => event.eventId.startsWith("replan-graph:"))).toHaveLength(1);
  });

  it("fails an abandoned prepared replan without projecting ghost state", async () => {
    const repoPath = await makeGitRepo("repo-abandoned");
    const workspace = await getWorkspaceRepository().create({
      name: "Abandoned replan",
      repoPath
    });
    const saved = await getRunRepository().save(await recordWithTarget(workspace.id, repoPath));
    const journal = mutationJournal();
    const reserved = await journal.reserve({
      operationId: "replan:abandoned-before-cas",
      runId: saved.runId,
      kind: "replan",
      expectedRunVersion: saved.version,
      sourcePlanRevision: 1,
      targetPlanRevision: 2,
      graphHash: "never-persisted",
      patchId: "missing-replan-patch"
    });
    await journal.transition(reserved.operationId, {
      expectedVersion: reserved.version,
      status: "graph_prepared"
    });

    await recoverPendingAmendmentMutations(saved.runId);

    expect((await journal.get(reserved.operationId))?.status).toBe("failed");
    expect(await hasPendingPlanMutation(saved.runId)).toBe(false);
    expect((await getRunRepository().get(saved.runId)).planRevision).toBe(1);
    expect(await readRunModelEvents(saved.runId)).toEqual([]);
  });

  it("leaves a prepared replan pending while its exact writer heartbeat is fresh", async () => {
    const repoPath = await makeGitRepo("repo-live-writer");
    const workspace = await getWorkspaceRepository().create({
      name: "Live replan writer",
      repoPath
    });
    const operationId = "22222222-2222-4222-8222-222222222222";
    const heartbeatAt = new Date().toISOString();
    const saved = await getRunRepository().save({
      ...await recordWithTarget(workspace.id, repoPath),
      mutationFence: 1,
      activeOperation: {
        operationId,
        kind: "replan",
        fencingToken: 1,
        acquiredAt: heartbeatAt,
        heartbeatAt
      }
    });
    const journal = mutationJournal();
    const reserved = await journal.reserve({
      operationId: "replan:live-before-cas",
      runId: saved.runId,
      kind: "replan",
      expectedRunVersion: saved.version,
      sourcePlanRevision: 1,
      targetPlanRevision: 2,
      graphHash: "still-being-prepared",
      patchId: "future-replan-patch",
      runOperationId: operationId
    });
    await journal.transition(reserved.operationId, {
      expectedVersion: reserved.version,
      status: "graph_prepared"
    });

    await recoverPendingAmendmentMutations(saved.runId);

    expect((await journal.get(reserved.operationId))?.status).toBe("graph_prepared");
    expect(await hasPendingPlanMutation(saved.runId)).toBe(true);
    expect((await getRunRepository().get(saved.runId)).activeOperation?.operationId).toBe(operationId);
  });
});

function mutationJournal(): JsonPlanMutationJournal {
  return new JsonPlanMutationJournal({
    directory: path.join(process.env.MANYHANDS_RUNS_DIR!, "plan-mutations")
  });
}

async function makeGitRepo(name: string): Promise<string> {
  const repoPath = path.join(tempDir, name);
  await execFileAsync("git", ["init", "-b", "main", repoPath]);
  await execFileAsync("git", ["config", "user.email", "test@manyhands.local"], { cwd: repoPath });
  await execFileAsync("git", ["config", "user.name", "ManyHands Test"], { cwd: repoPath });
  await execFileAsync("git", ["commit", "--allow-empty", "-m", "base"], { cwd: repoPath });
  return repoPath;
}

async function waitForActiveOperation(runId: string): Promise<RunRecord> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await getRunRepository().get(runId);
    if (run.activeOperation !== undefined) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${runId} to claim its replan operation`);
}

function record(workspaceId: string): RunRecord {
  return {
    runId: "run-replan-projection",
    workspaceId,
    userPrompt: "Build exact role projection",
    title: "Build exact role projection",
    model: "gpt-5.5",
    planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
    executionSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "medium" },
    repairSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "medium" },
    granularity: "balanced",
    status: "running",
    version: 0,
    planRevision: 1,
    planning: planning(mainGraph()),
    createdAt: now,
    updatedAt: now,
    patches: [priorSubtreePatch()]
  } as RunRecord;
}

async function recordWithTarget(workspaceId: string, repoPath: string): Promise<RunRecord> {
  const targetContext = await captureRunTargetContext(repoPath);
  if (targetContext === undefined) {
    throw new Error(`Expected a Git target context for ${repoPath}`);
  }
  return { ...record(workspaceId), targetContext };
}

function priorSubtreePatch(): Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> {
  const target = node({
    id: "target",
    kind: "leaf",
    depth: 1,
    parentId: "root",
    title: "Previously regenerated target",
    contract: contract("target")
  });
  return {
    id: "patch-prior-subtree",
    type: "SUBTREE_REGENERATED",
    actor: "human",
    createdAt: now,
    taskId: "target",
    removedTaskIds: ["target"],
    nodes: { target },
    dependencies: [],
    contracts: [target.contract!]
  };
}

function planning(graph: TaskGraph): MockPlanningFlowResult {
  return {
    decomposition: {
      feature: {
        id: "feature-replan",
        title: "Replan",
        description: "Replan",
        repositoryPath: graph.repo,
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Done"]
      },
      graph,
      contracts: Object.values(graph.nodes).flatMap((node) =>
        node.contract === undefined ? [] : [node.contract]
      )
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { batches: [] },
    traces: [],
    summary: { mode: "balanced" }
  } as MockPlanningFlowResult;
}

function mainGraph(): TaskGraph {
  return {
    id: "graph-main",
    planId: "plan-main",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Build exact role projection",
    rootId: "root",
    createdAt: now,
    dependencies: [],
    nodes: {
      root: node({ id: "root", kind: "root", depth: 0, childrenIds: ["target"] }),
      target: node({
        id: "target",
        kind: "leaf",
        depth: 1,
        parentId: "root",
        contract: contract("target")
      })
    }
  } as TaskGraph;
}

function replacementGraph(): TaskGraph {
  return {
    id: "graph-replacement",
    planId: "plan-replacement",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Split exact roles",
    rootId: "replacement-root",
    createdAt: now,
    dependencies: [],
    nodes: {
      "replacement-root": node({
        id: "replacement-root",
        kind: "root",
        depth: 0,
        childrenIds: ["group", "direct"]
      }),
      group: node({
        id: "group",
        kind: "composite",
        depth: 1,
        parentId: "replacement-root",
        childrenIds: ["nested"]
      }),
      nested: node({
        id: "nested",
        kind: "leaf",
        depth: 2,
        parentId: "group",
        contract: contract("nested")
      }),
      direct: node({
        id: "direct",
        kind: "leaf",
        depth: 1,
        parentId: "replacement-root",
        contract: contract("direct")
      })
    }
  } as TaskGraph;
}

function node(input: Partial<TaskNode> & Pick<TaskNode, "id" | "kind" | "depth">): TaskNode {
  return {
    parentId: null,
    title: input.id,
    goal: `Goal ${input.id}`,
    status: "planned",
    granularity: "auto",
    childrenIds: [],
    dependencies: [],
    ...input
  } as TaskNode;
}

function contract(taskId: string): AgentTaskContract {
  return {
    taskId,
    objective: `Implement ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [`src/${taskId}.ts`] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: `${taskId} works` }],
    validationCommands: [],
    expectedOutput: {
      changedFiles: [`src/${taskId}.ts`],
      producedSymbols: [],
      consumedSymbols: []
    },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "Done"
  };
}
