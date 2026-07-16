import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTaskContract, MockPlanningFlowResult, TaskGraph } from "@manyhands/core";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";

const cleanupInvalidatedTasks = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@manyhands/execution-core", async () => {
  const actual = await vi.importActual<typeof import("@manyhands/execution-core")>("@manyhands/execution-core");
  return {
    ...actual,
    AmendmentsEngine: class {
      async amendSeam(input: {
        leafResults: unknown[];
        integrationResults: unknown[];
        graph: TaskGraph;
      }) {
        return {
          leafResults: input.leafResults,
          integrationResults: input.integrationResults,
          invalidatedTaskIds: new Set(Object.keys(input.graph.nodes))
        };
      }

      async cleanInvalidatedTasks(input: unknown) {
        await cleanupInvalidatedTasks(input);
      }
    }
  };
});

import { POST as POST_DECISION } from "@/app/api/runs/[id]/decisions/[decisionId]/route";
import { PATCH as PATCH_NODE } from "@/app/api/runs/[id]/nodes/[taskId]/route";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { selectWorkspaceView } from "@/lib/run-model/workspace-view";
import { resolveExecutionGraph } from "@/lib/server/runs/execution-state";
import { approveAmendment } from "@/lib/server/runs/amendment-approval-service";
import { recoverPendingAmendmentMutations } from "@/lib/server/runs/plan-mutation-recovery";
import { JsonPlanMutationJournal } from "@/lib/server/runs/plan-mutation-journal";
import {
  appendRunModelEvent,
  ensureRunModelEventLogForRun,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import { buildRunModelSeed, projectRunRecordToPlanGraph } from "@/lib/server/runs/run-model-projection";
import { resetRunRepositoryForTests, getRunRepository } from "@/lib/server/runs/store";
import type { RunRecord } from "@/lib/server/runs/schema";
import {
  getWorkspaceRepository,
  resetWorkspaceRepositoryForTests
} from "@/lib/server/workspaces";

const now = "2026-07-15T12:00:00.000Z";
const oldSignature = "load(id: string): Promise<Item>";
const newSignature = "load(id: string, locale: string): Promise<Item>";
const decisionId = "approve-amendment:am-load-v2";
let tempDir: string;
let previousRunsDir: string | undefined;
let previousWorkspacesFile: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-amendment-approval-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  previousWorkspacesFile = process.env.MANYHANDS_WORKSPACES_FILE;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  process.env.MANYHANDS_WORKSPACES_FILE = path.join(tempDir, "workspaces.json");
  await mkdir(path.join(tempDir, "execution-repo"), { recursive: true });
  await mkdir(path.join(tempDir, "source-repo"), { recursive: true });
  cleanupInvalidatedTasks.mockReset();
  cleanupInvalidatedTasks.mockResolvedValue(undefined);
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  if (previousWorkspacesFile === undefined) delete process.env.MANYHANDS_WORKSPACES_FILE;
  else process.env.MANYHANDS_WORKSPACES_FILE = previousWorkspacesFile;
  resetRunRepositoryForTests();
  resetWorkspaceRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("approve_amendment durable mutation", () => {
  it("persists r1 -> r2 in the graph and every interface contract before resolving the gate", async () => {
    const saved = await seedRun("run-amendment-success");

    const response = await postDecision(saved.runId, {
      action: "approve",
      expectedVersion: saved.version
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const durable = await getRunRepository().get(saved.runId);
    expect(durable).toMatchObject({
      status: "needs_review",
      planRevision: 2
    });
    expect(durable.approvedAt).toBeUndefined();
    expect(durable.approvedPlanRevision).toBeUndefined();
    expect(durable.activeOperation).toBeUndefined();
    expect((durable.execution as { leafResults: unknown[] }).leafResults).toEqual([]);
    expect((durable.execution as { integrationResults: unknown[] }).integrationResults).toEqual([]);
    expect(durable.patches).toContainEqual(expect.objectContaining({
      type: "SEAM_AMENDED",
      seamId: "ItemLoader",
      fromRevision: 1,
      toRevision: 2,
      changeKind: "signature",
      signature: newSignature,
      contract: { "locale.default": "en-US" }
    }));

    const graph = resolveExecutionGraph(durable);
    expect(graph.nodes.producer?.contract?.producedInterfaces?.[0]).toMatchObject({
      id: "ItemLoader",
      signature: newSignature,
      contract: { "locale.default": "en-US" }
    });
    expect(graph.nodes.consumer?.contract?.consumedInterfaces?.[0]).toMatchObject({
      id: "ItemLoader",
      signature: newSignature,
      contract: { "locale.default": "en-US" }
    });
    expect(projectRunRecordToPlanGraph(durable)?.seams).toContainEqual(
      expect.objectContaining({ seamId: "ItemLoader", draftSignature: newSignature })
    );

    const events = await readRunModelEvents(saved.runId);
    const projectionIndex = events.findLastIndex((event) => event.type === "plan.graph.projected");
    const resolutionIndex = events.findIndex(
      (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
    );
    const appliedIndex = events.findIndex(
      (event) => event.type === "amendment.applied" && event.payload.amendmentId === "am-load-v2"
    );
    expect(projectionIndex).toBeGreaterThanOrEqual(0);
    expect(resolutionIndex).toBeGreaterThan(projectionIndex);
    expect(appliedIndex).toBeGreaterThan(projectionIndex);
    expect(resolutionIndex).toBeGreaterThan(appliedIndex);
    expect(cleanupInvalidatedTasks).toHaveBeenCalledTimes(1);

    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(durable)), events);
    expect(model.amendments.get("am-load-v2")).toMatchObject({ status: "applied" });
    expect(model.seams.get("ItemLoader")).toMatchObject({
      revision: 2,
      state: "amended",
      lastChangeKind: "signature",
      contract: { "locale.default": "en-US" }
    });
    expect(model.seams.get("ItemLoader")?.signature.frozen).toBe(newSignature);
    expect(model.decisions.get(decisionId)?.status).toBe("resolved");
    expect(model.decisions.get("approve_plan:r2")?.status).toBe("pending");
  });

  it("keeps the approval gate pending when the RunRecord CAS version is stale", async () => {
    const saved = await seedRun("run-amendment-stale-cas");

    const response = await postDecision(saved.runId, {
      action: "approve",
      expectedVersion: saved.version - 1
    });

    expect(response.status).toBe(409);
    const durable = await getRunRepository().get(saved.runId);
    expect(durable.status).toBe("running");
    expect(durable.planRevision).toBe(1);
    expect(durable.patches).toEqual([]);
    expect(durable.activeOperation).toBeUndefined();

    const events = await readRunModelEvents(saved.runId);
    expect(events.some(
      (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
    )).toBe(false);
    expect(events.some((event) => event.type === "amendment.applied")).toBe(false);
    expect(events.some((event) => event.type === "seam.amended")).toBe(false);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(durable)), events);
    expect(model.decisions.get(decisionId)?.status).toBe("pending");
    expect(model.amendments.get("am-load-v2")?.status).toBe("proposed");
    expect(model.seams.get("ItemLoader")?.revision).toBe(1);
  });

  it("recovers the same durable event batch after a crash immediately post-RunRecord CAS", async () => {
    const saved = await seedRun("run-amendment-recover-record");
    const checkpointDir = path.join(
      process.env.MANYHANDS_RUNS_DIR!,
      "checkpoints",
      saved.runId
    );
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(path.join(checkpointDir, "latest.json"), "obsolete checkpoint", "utf8");

    await expect(approveAmendment(await approvalInput(saved), {
      afterRecordPersisted: () => {
        throw new Error("fault:post-record");
      }
    })).rejects.toThrow("fault:post-record");

    const interrupted = await getRunRepository().get(saved.runId);
    expect(interrupted).toMatchObject({ status: "needs_review", planRevision: 2 });
    expect((await readRunModelEvents(saved.runId)).some(
      (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
    )).toBe(false);
    expect((await mutationJournal().pending(saved.runId))[0]?.status).toBe("record_persisted");

    await recoverPendingAmendmentMutations(saved.runId);

    await expect(access(checkpointDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expectRecoveredAmendment(saved.runId);
  });

  it("recovers idempotently after checkpoint reset without resuming the obsolete thread", async () => {
    const saved = await seedRun("run-amendment-recover-checkpoint");
    const checkpointDir = path.join(
      process.env.MANYHANDS_RUNS_DIR!,
      "checkpoints",
      saved.runId
    );
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(path.join(checkpointDir, "latest.json"), "obsolete checkpoint", "utf8");

    await expect(approveAmendment(await approvalInput(saved), {
      afterCheckpointReset: () => {
        throw new Error("fault:post-reset");
      }
    })).rejects.toThrow("fault:post-reset");

    expect((await mutationJournal().pending(saved.runId))[0]?.status).toBe("checkpoint_reset");
    await expect(access(checkpointDir)).rejects.toMatchObject({ code: "ENOENT" });

    await recoverPendingAmendmentMutations(saved.runId);
    await recoverPendingAmendmentMutations(saved.runId);

    await expectRecoveredAmendment(saved.runId);
  });

  it("never attributes an explicit missing patch id to another seam amendment", async () => {
    const saved = await seedRun("run-amendment-exact-patch");
    await expect(approveAmendment(await approvalInput(saved), {
      afterRecordPersisted: () => {
        throw new Error("fault:leave-real-operation-pending");
      }
    })).rejects.toThrow("fault:leave-real-operation-pending");

    const journal = mutationJournal();
    const real = (await journal.pending(saved.runId))[0]!;
    const fake = await journal.reserve({
      operationId: "amendment:explicit-missing-patch",
      runId: saved.runId,
      kind: "amendment",
      expectedRunVersion: real.expectedRunVersion,
      sourcePlanRevision: real.sourcePlanRevision,
      targetPlanRevision: real.targetPlanRevision,
      graphHash: real.graphHash,
      patchId: "seam-patch-that-does-not-exist",
      amendmentId: "am-other",
      decisionId: "approve-amendment:am-other"
    });
    const prepared = await journal.transition(fake.operationId, {
      expectedVersion: fake.version,
      status: "graph_prepared"
    });
    await journal.transition(fake.operationId, {
      expectedVersion: prepared.version,
      status: "record_persisted"
    });

    await expect(recoverPendingAmendmentMutations(saved.runId)).rejects.toThrow(
      /patch evidence is missing/i
    );

    expect((await journal.get(fake.operationId))?.status).toBe("record_persisted");
    const events = await readRunModelEvents(saved.runId);
    expect(events.filter((event) => event.type === "seam.amended")).toHaveLength(1);
    expect(events.some(
      (event) => event.type === "decision.resolved" &&
        event.payload.decisionId === "approve-amendment:am-other"
    )).toBe(false);
  });

  it("does not advance graph_prepared while the live CAS writer owns the journal transition", async () => {
    const saved = await seedRun("run-amendment-live-cas-window");
    let signalEntered!: () => void;
    let releaseWriter!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const held = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const approval = approveAmendment(await approvalInput(saved), {
      afterRunRecordCas: async () => {
        signalEntered();
        await held;
      }
    });
    await entered;

    const live = await getRunRepository().get(saved.runId);
    const operationId = live.activeOperation?.operationId;
    expect(operationId).toBeDefined();
    expect((await mutationJournal().pending(saved.runId))[0]?.status).toBe("graph_prepared");
    try {
      const visible = await ensureRunModelEventLogForRun(live);
      expect((await mutationJournal().pending(saved.runId))[0]?.status).toBe("graph_prepared");
      expect((await getRunRepository().get(saved.runId)).activeOperation?.operationId).toBe(operationId);
      expect(visible.some((event) => event.type === "plan.graph.projected")).toBe(false);
      const rejectedEdit = await PATCH_NODE(
        new Request("http://manyhands.test/api", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expectedVersion: live.version, title: "Must not race" })
        }),
        { params: Promise.resolve({ id: saved.runId, taskId: "producer" }) }
      );
      expect(rejectedEdit.status).toBe(409);
      expect((await getRunRepository().get(saved.runId)).patches).toHaveLength(1);
    } finally {
      releaseWriter();
    }

    await approval;
    await expectRecoveredAmendment(saved.runId);
    const finalized = await getRunRepository().get(saved.runId);
    const acceptedEdit = await PATCH_NODE(
      new Request("http://manyhands.test/api", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: finalized.version, title: "Edit after finalization" })
      }),
      { params: Promise.resolve({ id: saved.runId, taskId: "producer" }) }
    );
    expect(acceptedEdit.status, await acceptedEdit.clone().text()).toBe(200);
    expect((await getRunRepository().get(saved.runId)).patches.at(-1)).toMatchObject({
      type: "NODE_RENAMED",
      taskId: "producer",
      title: "Edit after finalization"
    });
  });

  it("refuses recovery when the durable target fingerprint no longer matches", async () => {
    const saved = await seedRun("run-amendment-target-mismatch");
    await expect(approveAmendment(await approvalInput(saved), {
      afterRecordPersisted: () => {
        throw new Error("fault:target-check");
      }
    })).rejects.toThrow("fault:target-check");
    await getRunRepository().update(saved.runId, (current) => ({
      ...current,
      targetContext: current.targetContext === undefined
        ? undefined
        : { ...current.targetContext, fingerprint: "different-target-fingerprint" }
    }));

    await expect(recoverPendingAmendmentMutations(saved.runId)).rejects.toThrow(
      /target no longer matches/i
    );
    expect((await mutationJournal().pending(saved.runId))[0]?.status).toBe("record_persisted");
    expect(cleanupInvalidatedTasks).not.toHaveBeenCalled();
  });

  it("does not let read-side recovery steal or project ahead of a live post-CAS writer", async () => {
    const saved = await seedRun("run-amendment-live-writer");
    let signalEntered!: () => void;
    let releaseWriter!: () => void;
    const entered = new Promise<void>((resolve) => { signalEntered = resolve; });
    const held = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const approval = approveAmendment(await approvalInput(saved), {
      afterRecordPersisted: async () => {
        signalEntered();
        await held;
      }
    });
    await entered;

    const live = await getRunRepository().get(saved.runId);
    const operationId = live.activeOperation?.operationId;
    expect(operationId).toBeDefined();
    try {
      const visible = await ensureRunModelEventLogForRun(live);
      expect((await getRunRepository().get(saved.runId)).activeOperation?.operationId).toBe(operationId);
      expect(visible.some((event) => event.type === "plan.graph.projected")).toBe(false);
      expect(visible.some(
        (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
      )).toBe(false);
    } finally {
      releaseWriter();
    }
    await approval;
    await expectRecoveredAmendment(saved.runId);
  });

  it("does not journal worktrees_cleaned when Git invalidation fails", async () => {
    const saved = await seedRun("run-amendment-cleanup-failure");
    cleanupInvalidatedTasks.mockRejectedValueOnce(new Error("git cleanup failed"));

    await expect(approveAmendment(await approvalInput(saved))).rejects.toThrow("git cleanup failed");

    expect((await mutationJournal().pending(saved.runId))[0]?.status).toBe("record_persisted");
    expect((await readRunModelEvents(saved.runId)).some(
      (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
    )).toBe(false);

    await recoverPendingAmendmentMutations(saved.runId);
    await expectRecoveredAmendment(saved.runId);
  });

  it("preserves execution results and skips physical invalidation for contract-only amendments", async () => {
    const saved = await seedRun("run-amendment-contract", "contract");

    const response = await postDecision(saved.runId, {
      action: "approve",
      expectedVersion: saved.version
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const durable = await getRunRepository().get(saved.runId);
    expect(durable.patches).toContainEqual(expect.objectContaining({
      type: "SEAM_AMENDED",
      changeKind: "contract",
      contract: { "locale.default": "en-US" }
    }));
    expect(cleanupInvalidatedTasks).not.toHaveBeenCalled();
    expect((durable.execution as { leafResults: unknown[] }).leafResults).toEqual(
      (saved.execution as { leafResults: unknown[] }).leafResults
    );
    expect((durable.execution as { integrationResults: unknown[] }).integrationResults).toEqual(
      (saved.execution as { integrationResults: unknown[] }).integrationResults
    );
  });

  it("serializes concurrent amendment approve vs reject so exactly one disposition wins", async () => {
    const saved = await seedRun("run-amendment-approve-vs-reject");

    const responses = await Promise.all([
      postDecision(saved.runId, { action: "approve", expectedVersion: saved.version }),
      postDecision(saved.runId, { action: "reject", expectedVersion: saved.version })
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const durable = await getRunRepository().get(saved.runId);
    expect(durable.activeOperation).toBeUndefined();
    const events = await readRunModelEvents(saved.runId);
    const resolutions = events.filter(
      (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
    );
    expect(resolutions).toHaveLength(1);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(durable)), events);
    expect(["applied", "rejected"]).toContain(model.amendments.get("am-load-v2")?.status);
    expect(model.amendments.get("am-load-v2")?.status).not.toBe("proposed");
  });

  it("records amendment rejection and removes its proposed blast radius from the workspace", async () => {
    const saved = await seedRun("run-amendment-rejected");

    const response = await postDecision(saved.runId, {
      action: "reject",
      expectedVersion: saved.version
    });

    expect(response.status, await response.clone().text()).toBe(200);
    const durable = await getRunRepository().get(saved.runId);
    const events = await readRunModelEvents(saved.runId);
    expect(events.filter(
      (event) => event.type === "amendment.rejected" && event.payload.amendmentId === "am-load-v2"
    )).toHaveLength(1);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(durable)), events);
    expect(model.amendments.get("am-load-v2")?.status).toBe("rejected");
    expect(selectWorkspaceView(model).affectedByPendingAmendment).toEqual([]);
  });
});

async function seedRun(
  runId: string,
  changeKind: "signature" | "contract" = "signature"
): Promise<RunRecord> {
  const workspace = await getWorkspaceRepository().create({ name: `Workspace ${runId}` });
  const saved = await getRunRepository().save(makeRun(runId, workspace.id));
  await appendRunModelEvent(runId, {
    actor: "system",
    at: now,
    type: "plan.seam.proposed",
    payload: {
      seamId: "ItemLoader",
      name: "ItemLoader",
      producerNodeId: "producer",
      consumerNodeIds: ["consumer"],
      draftSignature: oldSignature
    }
  });
  await appendRunModelEvent(runId, {
    actor: "system",
    at: now,
    type: "seam.frozen",
    payload: {
      seamId: "ItemLoader",
      revision: 1,
      frozenSignature: oldSignature,
      extractedFrom: "contract:producer"
    }
  });
  await appendRunModelEvent(runId, {
    actor: "agent",
    at: now,
    type: "amendment.proposed",
    payload: {
      amendmentId: "am-load-v2",
      nodeId: "producer",
      kind: "seam",
      changeKind,
      detail: {
        seamId: "ItemLoader",
        fromRevision: 1,
        toRevision: 2,
        ...(changeKind === "signature" ? { newSignature } : {}),
        contract: { "locale.default": "en-US" }
      },
      affects: ["producer", "consumer", "root"]
    }
  });
  await appendRunModelEvent(runId, {
    actor: "system",
    at: now,
    type: "decision.raised",
    payload: {
      decisionId,
      kind: "approve_amendment",
      blocking: true,
      context: { amendmentId: "am-load-v2", seamId: "ItemLoader" }
    }
  });
  return saved;
}

async function approvalInput(saved: RunRecord) {
  const events = await readRunModelEvents(saved.runId);
  const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(saved)), events);
  return {
    run: saved,
    decisionId,
    amendment: model.amendments.get("am-load-v2")!,
    seam: model.seams.get("ItemLoader"),
    expectedVersion: saved.version,
    at: now
  };
}

function mutationJournal(): JsonPlanMutationJournal {
  return new JsonPlanMutationJournal({
    directory: path.join(process.env.MANYHANDS_RUNS_DIR!, "plan-mutations")
  });
}

async function expectRecoveredAmendment(runId: string): Promise<void> {
  const durable = await getRunRepository().get(runId);
  expect(durable).toMatchObject({ status: "needs_review", planRevision: 2 });
  expect(durable.activeOperation).toBeUndefined();
  expect(await mutationJournal().pending(runId)).toEqual([]);
  const events = await readRunModelEvents(runId);
  expect(events.filter(
    (event) => event.type === "run.status.changed" && event.payload.status === "needs_review"
  )).toHaveLength(1);
  expect(events.filter((event) => event.type === "plan.graph.projected")).toHaveLength(1);
  expect(events.filter((event) => event.type === "seam.amended")).toHaveLength(1);
  expect(events.filter((event) => event.type === "amendment.applied")).toHaveLength(1);
  expect(events.filter(
    (event) => event.type === "decision.resolved" && event.payload.decisionId === decisionId
  )).toHaveLength(1);
  expect(events.filter(
    (event) => event.type === "decision.raised" && event.payload.decisionId === "approve_plan:r2"
  )).toHaveLength(1);
  expect(new Set(events.map((event) => event.eventId)).size).toBe(events.length);
}

function postDecision(runId: string, body: unknown): Promise<Response> {
  return POST_DECISION(
    new Request("http://manyhands.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ id: runId, decisionId }) }
  );
}

function makeRun(runId: string, workspaceId: string): RunRecord {
  return {
    runId,
    workspaceId,
    granularity: "balanced",
    model: "gpt-5.4",
    userPrompt: "Amend the ItemLoader seam",
    title: "Amend ItemLoader",
    version: 0,
    status: "running",
    planRevision: 1,
    approvedPlanRevision: 1,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
    planning: makePlanning(),
    execution: {
      runId,
      status: "failed",
      leafResults: [makeLeafResult("producer"), makeLeafResult("consumer")],
      integrationResults: [makeIntegrationResult()],
      totalDurationMs: 30,
      granularityVector: {
        leafTaskCount: 0,
        compositeTaskCount: 0,
        maxDepth: 1,
        averageChildrenPerComposite: 2,
        parallelismRatio: 0,
        integrationConflictRate: 0,
        scopeViolationRate: 0,
        validationFailureRate: 0,
        totalDurationMs: 0
      }
    },
    provisioned: {
      repoRoot: path.join(tempDir, "execution-repo"),
      sourceRepoRoot: path.join(tempDir, "source-repo"),
      sourceBranch: "main",
      sourceBaseCommit: "base",
      baseBranch: "main",
      baseCommit: "base",
      executionBaseCommit: "base",
      provisionedAt: now
    },
    targetContext: {
      sourceRealPath: path.join(tempDir, "source-repo"),
      gitCommonDir: path.join(tempDir, "source-repo", ".git"),
      sourceBranch: "main",
      sourceBaseCommit: "base",
      fingerprint: "target-fingerprint",
      capturedAt: now,
      executionRepoPath: path.join(tempDir, "execution-repo"),
      executionBaseCommit: "base"
    },
    patches: []
  };
}

function makeLeafResult(taskId: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "base",
    currentHead: `${taskId}-head`,
    agentCommittedUnexpectedly: false,
    diff: `diff --git a/${taskId}.ts b/${taskId}.ts`,
    changedFiles: [`src/${taskId}.ts`],
    commitSha: `${taskId}-commit`,
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 10,
    executorTimedOut: false
  };
}

function makeIntegrationResult(): IntegrationResult {
  return {
    compositeTaskId: "root",
    status: "success",
    childResults: [],
    integrationCommitSha: "root-commit",
    repairAttempted: false,
    preMergeFindings: []
  };
}

function makePlanning(): MockPlanningFlowResult {
  const iface = {
    id: "ItemLoader",
    kind: "function" as const,
    signature: oldSignature,
    description: "Loads one item"
  };
  const producer = makeContract("producer", "src/producer.ts", {
    producedInterfaces: [iface]
  });
  const consumer = makeContract("consumer", "src/consumer.ts", {
    dependencies: ["producer"],
    consumedInterfaces: [iface]
  });
  const graph: TaskGraph = {
    id: "graph-amendment",
    planId: "plan-amendment",
    repo: "manyhands",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Amend the ItemLoader seam",
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
        childrenIds: ["producer", "consumer"],
        dependencies: []
      },
      producer: {
        id: "producer",
        parentId: "root",
        kind: "leaf",
        title: "Producer",
        goal: "Produce ItemLoader",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract: producer
      },
      consumer: {
        id: "consumer",
        parentId: "root",
        kind: "leaf",
        title: "Consumer",
        goal: "Consume ItemLoader",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: ["producer"],
        contract: consumer
      }
    },
    dependencies: [{
      fromTaskId: "producer",
      toTaskId: "consumer",
      type: "contractual",
      inferred: false,
      rationale: "Consumer uses ItemLoader"
    }]
  };
  return {
    summary: {
      runId: "planning-amendment",
      featureId: "feature-amendment",
      mode: "balanced",
      schedulerPolicy: "risk_aware",
      taskCount: 3,
      leafCount: 2,
      dependencyCount: 1,
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
        id: "feature-amendment",
        title: "Amend ItemLoader",
        description: "Amend the ItemLoader seam",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["The seam is updated"]
      },
      graph,
      contracts: [producer, consumer],
      metadata: {
        mode: "balanced",
        generatedAt: now,
        decomposer: "test",
        deterministic: true
      },
      validation: { graphValid: true, contractValid: true, issues: [] }
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { policy: "risk_aware", batches: [], blocked: [], explanations: [] },
    traces: []
  };
}

function makeContract(
  taskId: string,
  changedFile: string,
  overrides: Partial<AgentTaskContract>
): AgentTaskContract {
  return {
    taskId,
    objective: `Implement ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [changedFile] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: `${taskId} works` }],
    validationCommands: [],
    expectedOutput: { changedFiles: [changedFile], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 1_000, maxCostUsd: 0 },
    knownRisks: [],
    definitionOfDone: `${taskId} works`,
    ...overrides
  };
}
