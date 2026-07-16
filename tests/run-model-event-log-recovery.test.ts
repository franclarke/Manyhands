import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import {
  appendRunEventRequired,
  ensureRunModelEventLogForRun,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import { buildRunModelSeed, projectRunRecordToPlanGraph } from "@/lib/server/runs/run-model-projection";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-event-recovery-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = tempDir;
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe("RunRecord to event-log recovery outbox", () => {
  it("repairs a missing status transition exactly once from durable state", async () => {
    const run = record({ status: "interrupted", version: 4, updatedAt: "2026-07-14T00:04:00.000Z" });
    await appendRunEventRequired(run.runId, {
      eventId: "created-status",
      actor: "system",
      at: run.createdAt,
      type: "run.status.changed",
      payload: { status: "created", version: 0, pendingHumanAction: "none", updatedAt: run.createdAt }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const recovered = (await readRunModelEvents(run.runId)).filter(
      (event) => event.eventId === `recovery-status:${run.runId}:v4:interrupted`
    );
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.payload).toMatchObject({ status: "interrupted", version: 4 });
  });

  it("resolves the canonical approval decision for the approved plan revision", async () => {
    const run = record({
      status: "approved",
      version: 5,
      planRevision: 2,
      approvedPlanRevision: 2,
      approvedAt: "2026-07-14T00:05:00.000Z",
      updatedAt: "2026-07-14T00:05:00.000Z"
    });
    await appendRunEventRequired(run.runId, {
      eventId: "approval-r2-raised",
      actor: "system",
      at: run.createdAt,
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan:r2",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["root"] }
      }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const resolutions = (await readRunModelEvents(run.runId)).filter(
      (event) => event.type === "decision.resolved"
    );
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      decisionId: "approve_plan:r2",
      choice: { action: "approve" }
    });
  });

  it("closes a stale pending approval when a newer plan revision exists", async () => {
    const run = record({ status: "needs_review", version: 4, planRevision: 2 });
    await appendRunEventRequired(run.runId, {
      eventId: "approval-r1-raised",
      actor: "system",
      at: run.createdAt,
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan:r1",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["root"] }
      }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "approval-r2-raised",
      actor: "system",
      at: run.updatedAt,
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan:r2",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["root"] }
      }
    });

    await ensureRunModelEventLogForRun(run);

    const resolutions = (await readRunModelEvents(run.runId)).filter(
      (event) => event.type === "decision.resolved"
    );
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toMatchObject({
      decisionId: "approve_plan:r1",
      choice: { action: "reject" }
    });
  });

  it("reconstructs the delivered artifact fact and terminal completion exactly once", async () => {
    const run = record({
      status: "completed",
      version: 8,
      deliveryOutcome: "delivered",
      finalArtifactManifest: {
        version: 1,
        manifestId: "00000000-0000-4000-8000-000000000002",
        runId: "run-recovery",
        sourceTargetFingerprint: "fingerprint",
        sourceBranch: "main",
        sourceBaseSha: "base",
        executionBaseSha: "base",
        finalSha: "final",
        addedFiles: [],
        modifiedFiles: [],
        deletedFiles: [],
        patch: "",
        validationCommands: [],
        validationResults: [],
        verificationDisposition: "verified",
        omittedTasks: [],
        acceptedFailures: [],
        acceptedConflicts: [],
        repairEvidence: [],
        artifactDisposition: "ready",
        deliveryDisposition: "delivered",
        createdAt: "2026-07-14T00:07:00.000Z"
      },
      updatedAt: "2026-07-14T00:08:00.000Z",
      completedAt: "2026-07-14T00:08:00.000Z"
    });
    await appendRunEventRequired(run.runId, {
      eventId: "pre-delivery-status",
      actor: "system",
      at: run.createdAt,
      type: "run.status.changed",
      payload: { status: "needs_delivery", version: 7, pendingHumanAction: "none", updatedAt: run.createdAt }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const events = await readRunModelEvents(run.runId);
    expect(events.filter((event) => event.type === "run.delivery.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "run.completed")).toHaveLength(1);
    expect(events.find((event) => event.type === "run.delivery.completed")?.payload).toMatchObject({
      manifestId: run.finalArtifactManifest?.manifestId,
      finalSha: "final"
    });
  });

  it("retires a legacy approve_merge gate instead of leaving an actionable no-op", async () => {
    const run = record({ status: "needs_delivery", version: 6 });
    await appendRunEventRequired(run.runId, {
      eventId: "legacy-approve-merge",
      actor: "system",
      at: run.createdAt,
      type: "decision.raised",
      payload: {
        decisionId: "approve_merge",
        kind: "approve_merge",
        blocking: true,
        context: { diffRef: `diff://runs/${run.runId}/final` }
      }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const resolutions = (await readRunModelEvents(run.runId)).filter(
      (event) => event.type === "decision.resolved"
    );
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0]?.payload).toEqual({
      decisionId: "approve_merge",
      choice: { action: "reject" },
      actor: "system"
    });
  });

  it("backfills missing canonical D1 dependency facts for a legacy plan log exactly once", async () => {
    const run = record({
      status: "needs_review",
      version: 2,
      planRevision: 1,
      planning: planningWithDependency()
    });
    await appendRunEventRequired(run.runId, {
      eventId: "legacy-plan-status",
      actor: "system",
      at: run.createdAt,
      type: "run.status.changed",
      payload: { status: "needs_review", version: 2, pendingHumanAction: "decision", updatedAt: run.createdAt }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const dependencies = (await readRunModelEvents(run.runId)).filter(
      (event) => event.type === "plan.dependency.proposed"
    );
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]?.payload).toEqual({
      fromTaskId: "root",
      toTaskId: "leaf-a",
      type: "structural",
      inferred: false,
      rationale: "Foundation precedes implementation"
    });
  });

  it("replaces a stale legacy graph on cold recovery without resurrecting removed nodes or dependencies", async () => {
    const run = record({
      status: "needs_review",
      version: 4,
      planRevision: 2,
      planning: planningWithDependency()
    });
    await appendRunEventRequired(run.runId, {
      eventId: "legacy-root",
      actor: "system",
      at: run.createdAt,
      type: "plan.node.proposed",
      payload: { nodeId: "root", parentId: null, role: "root", title: "Root", goal: "Coordinate", depth: 0 }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "legacy-removed-node",
      actor: "system",
      at: run.createdAt,
      type: "plan.node.proposed",
      payload: { nodeId: "leaf-old", parentId: "root", role: "leaf", title: "Removed", goal: "Removed work", depth: 1 }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "legacy-removed-dependency",
      actor: "system",
      at: run.createdAt,
      type: "plan.dependency.proposed",
      payload: { fromTaskId: "root", toTaskId: "leaf-old", type: "structural", inferred: false }
    });
    const currentProjection = projectRunRecordToPlanGraph(run, { resetRuntime: true });
    expect(currentProjection).not.toBeNull();
    await appendRunEventRequired(run.runId, {
      eventId: "projection-before-stale-write",
      actor: "system",
      at: run.createdAt,
      type: "plan.graph.projected",
      payload: currentProjection!
    });
    await appendRunEventRequired(run.runId, {
      eventId: "stale-latest-projection",
      actor: "system",
      at: run.createdAt,
      type: "plan.graph.projected",
      payload: {
        ...currentProjection!,
        nodes: [
          { nodeId: "root", parentId: null, role: "root", title: "Root", goal: "Coordinate", depth: 0, scopePaths: [] },
          { nodeId: "leaf-old", parentId: "root", role: "leaf", title: "Removed", goal: "Removed work", depth: 1, scopePaths: [] }
        ],
        dependencies: [{ fromTaskId: "root", toTaskId: "leaf-old", type: "structural", inferred: false }]
      }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const events = await readRunModelEvents(run.runId);
    expect(events.filter((event) => event.type === "plan.graph.projected")).toHaveLength(3);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
    expect([...model.nodes.keys()]).toEqual(["root", "leaf-a"]);
    expect([...model.dependencies.values()]).toEqual([{
      fromTaskId: "root",
      toTaskId: "leaf-a",
      type: "structural",
      inferred: false,
      rationale: "Foundation precedes implementation"
    }]);
    expect(model.decisions.get("approve_plan:r2")?.status).toBe("pending");
    expect(model.decisions.get("approve_plan:r2")?.context.nodeIds).toEqual(["leaf-a"]);
  });

  it("re-emits the exact graph when stale structural facts arrive after its latest projection", async () => {
    const run = record({
      status: "needs_review",
      version: 5,
      planRevision: 2,
      planning: planningWithDependency()
    });
    const currentProjection = projectRunRecordToPlanGraph(run, { resetRuntime: true });
    expect(currentProjection).not.toBeNull();
    await appendRunEventRequired(run.runId, {
      eventId: "current-exact-projection",
      actor: "system",
      at: run.createdAt,
      type: "plan.graph.projected",
      payload: currentProjection!
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-stale-node",
      actor: "system",
      at: run.updatedAt,
      type: "plan.node.proposed",
      payload: {
        nodeId: "leaf-stale",
        parentId: "root",
        role: "leaf",
        title: "Stale leaf",
        goal: "Obsolete work",
        depth: 1
      }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-stale-dependency",
      actor: "system",
      at: run.updatedAt,
      type: "plan.dependency.proposed",
      payload: {
        fromTaskId: "root",
        toTaskId: "leaf-stale",
        type: "structural",
        inferred: false
      }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-stale-seam",
      actor: "system",
      at: run.updatedAt,
      type: "plan.seam.proposed",
      payload: {
        seamId: "stale-seam",
        name: "stale-seam",
        producerNodeId: "root",
        consumerNodeIds: ["leaf-stale"],
        draftSignature: "obsolete(): void"
      }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const events = await readRunModelEvents(run.runId);
    const projections = events.filter((event) => event.type === "plan.graph.projected");
    expect(projections).toHaveLength(2);
    expect(projections.at(-1)?.eventId).toMatch(/^recovery-plan-graph:/u);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
    expect([...model.nodes.keys()]).toEqual(["root", "leaf-a"]);
    expect([...model.dependencies.values()]).toEqual([{
      fromTaskId: "root",
      toTaskId: "leaf-a",
      type: "structural",
      inferred: false,
      rationale: "Foundation precedes implementation"
    }]);
    expect([...model.seams.keys()]).toEqual([]);
  });

  it("removes nodes and seams resurrected by late reducer facts after a graph projection", async () => {
    const run = record({
      status: "needs_review",
      version: 6,
      planRevision: 2,
      planning: planningWithDependency()
    });
    const projection = projectRunRecordToPlanGraph(run, { resetRuntime: true });
    expect(projection).not.toBeNull();
    await appendRunEventRequired(run.runId, {
      eventId: "projection-before-runtime-ghosts",
      actor: "system",
      at: run.createdAt,
      type: "plan.graph.projected",
      payload: projection!
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-ghost-planning-status",
      actor: "system",
      at: run.updatedAt,
      type: "plan.node.status",
      payload: { nodeId: "leaf-old", state: "generated" }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-ghost-scope",
      actor: "system",
      at: run.updatedAt,
      type: "scope.derived",
      payload: { nodeId: "leaf-scope-old", paths: ["src/old.ts"] }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-ghost-execution",
      actor: "system",
      at: run.updatedAt,
      type: "node.execution.started",
      payload: { nodeId: "leaf-execution-old", agent: "codex-cli", model: "gpt-5.4" }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-ghost-integration",
      actor: "system",
      at: run.updatedAt,
      type: "integration.completed",
      payload: { compositeNodeId: "composite-old", commit: "old", status: "success" }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-ghost-freeze",
      actor: "system",
      at: run.updatedAt,
      type: "seam.frozen",
      payload: {
        seamId: "seam-old",
        revision: 1,
        frozenSignature: "old(): void",
        extractedFrom: "contract:old"
      }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "late-ghost-amendment",
      actor: "system",
      at: run.updatedAt,
      type: "seam.amended",
      payload: { seamId: "seam-amended-old", revision: 2, changeKind: "contract" }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const events = await readRunModelEvents(run.runId);
    expect(events.filter((event) => event.type === "plan.graph.projected")).toHaveLength(2);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);
    expect([...model.nodes.keys()]).toEqual(["root", "leaf-a"]);
    expect([...model.seams.keys()]).toEqual([]);
  });

  it("reconstructs a missing replan clarification gate with its canonical identity", async () => {
    const run = record({
      status: "paused",
      version: 7,
      pausedDuring: "running",
      pendingQuestion: {
        nodeId: "leaf-a",
        question: "Which compatibility mode should be preserved?",
        options: ["strict", "compatible"]
      },
      pendingReplan: {
        taskId: "leaf-a",
        reason: "Contract changed",
        stepCache: {},
        questionAnswers: {}
      }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "paused-before-missing-clarify",
      actor: "system",
      at: run.updatedAt,
      type: "run.status.changed",
      payload: {
        status: "paused",
        version: run.version,
        pendingHumanAction: "decision",
        updatedAt: run.updatedAt
      }
    });

    await ensureRunModelEventLogForRun(run);
    await ensureRunModelEventLogForRun(run);

    const raised = (await readRunModelEvents(run.runId)).filter(
      (event) => event.type === "decision.raised" && event.payload.decisionId === "clarify:leaf-a"
    );
    expect(raised).toHaveLength(1);
    expect(raised[0]?.eventId).toBe(`clarify-raised:${run.runId}:leaf-a`);
    expect(raised[0]?.payload).toMatchObject({
      kind: "clarify",
      context: {
        nodeIds: ["leaf-a"],
        question: "Which compatibility mode should be preserved?",
        options: ["strict", "compatible"]
      }
    });
  });

  it("does not reopen a clarification whose resolution is already durable", async () => {
    const run = record({
      status: "interrupted",
      version: 8,
      pendingQuestion: {
        nodeId: "leaf-a",
        question: "Choose a mode",
        options: ["strict", "compatible"]
      }
    });
    await appendRunEventRequired(run.runId, {
      eventId: "clarify-resolution-survived-crash",
      actor: "human",
      at: run.updatedAt,
      type: "decision.resolved",
      payload: {
        decisionId: "clarify:leaf-a",
        choice: { answer: "strict" },
        actor: "human"
      }
    });

    await ensureRunModelEventLogForRun(run);

    const events = await readRunModelEvents(run.runId);
    expect(events.some(
      (event) => event.type === "decision.raised" && event.payload.decisionId === "clarify:leaf-a"
    )).toBe(false);
  });
});

function planningWithDependency(): RunRecord["planning"] {
  return {
    decomposition: {
      feature: { id: "feature-1" },
      graph: {
        id: "graph-1",
        planId: "plan-1",
        repo: "repo",
        baseBranch: "main",
        baseCommit: "base",
        featureRequest: "Feature",
        rootId: "root",
        createdAt: "2026-07-14T00:00:00.000Z",
        dependencies: [{
          fromTaskId: "root",
          toTaskId: "leaf-a",
          type: "structural",
          inferred: false,
          rationale: "Foundation precedes implementation"
        }],
        nodes: {
          root: {
            id: "root",
            parentId: null,
            kind: "root",
            title: "Root",
            goal: "Coordinate",
            status: "planned",
            granularity: "auto",
            depth: 0,
            childrenIds: ["leaf-a"],
            dependencies: []
          },
          "leaf-a": {
            id: "leaf-a",
            parentId: "root",
            kind: "leaf",
            title: "Leaf A",
            goal: "Implement",
            status: "planned",
            granularity: "auto",
            depth: 1,
            childrenIds: [],
            dependencies: ["root"]
          }
        }
      },
      contracts: []
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { batches: [] },
    traces: [],
    summary: { mode: "balanced" }
  } as RunRecord["planning"];
}

function record(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-recovery",
    workspaceId: "workspace-1",
    userPrompt: "Feature",
    title: "Feature",
    model: "gpt-5.5",
    planningSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" },
    executionSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "medium" },
    repairSelection: { executorId: "codex-cli", model: "gpt-5.4", effort: "medium" },
    granularity: "balanced",
    status: "created",
    version: 0,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...overrides
  } as RunRecord;
}
