/**
 * Selective re-decomposition (replan) — recover from an irrecoverably failed
 * or human-rejected node WITHOUT discarding the rest of the DAG.
 *
 * Flow: scope a fresh decomposition to the failed node (its goal + parent
 * context + frozen seams as hard constraints) → graft the new subtree into the
 * existing graph under revision-namespaced ids → invalidate the closure
 * (subtree + dependents + ancestor integrations: worktrees cleaned, results
 * filtered) → reset the execution thread so the wavefront re-enters seeded
 * with only the surviving work.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  isDecomposerQuestionError,
  type AgentTaskContract,
  type FeatureRequest,
  type MockPlanningFlowResult,
  type TraceEvent
} from "@manyhands/core";
import {
  AmendmentsEngine,
  computeTaskInvalidationClosure,
  computeGranularityVector,
  filterInvalidatedResults,
  type RunExecutionResult
} from "@manyhands/execution-core";
import { graftSubtree, type TaskGraph, type TaskNode } from "@manyhands/task-graph";
import { getWorkspaceRepository } from "../workspaces";
import { RunLifecycleError, RunMutationConflictError, RunValidationError } from "./errors";
import { publishRunEvent } from "./event-bus";
import { claimRunMutation } from "./mutation-guard";
import { assertRunActionAllowed } from "./lifecycle";
import { resetExecutionThread } from "./execution-host";
import {
  executionResultsFromRun,
  integrationDurationMs,
  assertExecutableRunGraph,
  resolveExecutionGraph
} from "./execution-state";
import { appendRunEventsRequired } from "./run-model-event-log";
import { isRunnerActive, startRunBackgroundTask } from "./runner-state";
import {
  appendStatusAndRunEventsOrRollback,
  requireCapturedRunRecord
} from "./audited-mutation";
import {
  JsonPlanMutationJournal,
  planMutationStatusAtLeast,
  type PlanMutationOperation
} from "./plan-mutation-journal";
import { invokePlanning } from "./planning-invocation-service";
import {
  assertRunOperationCurrent,
  invalidateRunOperation,
  releaseRunOperation,
  claimRunOperation,
  updateRunForOperation
} from "./run-operation-lease";
import { startHeartbeat } from "./runner-heartbeat";
import { withRepositoryLease } from "./repo-lock";
import { resolveRunsDirectory } from "./repository";
import {
  IMMUTABLE_BASE_PATCH_LOG_STORAGE,
  type RunOperationLease,
  type RunRecord
} from "./schema";
import { approvalDecisionId } from "./decision-identity";
import { getRunRepository } from "./store";
import { resolveRunTargetPath } from "./target-context";
import { projectRunRecordToPlanGraph, runControlForRun } from "./run-model-projection";
import { parseRunPatches, type RunPatch } from "./patches";

/** Resumable decomposer context carried across a replan's clarifying question. */
export interface ReplanResumeContext {
  stepCache: Record<string, unknown>;
  questionAnswers: Record<string, string>;
}

export interface ReplanMutationDeps {
  afterRunRecordCas?: () => Promise<void> | void;
  afterRecordPersisted?: () => Promise<void> | void;
  afterWorktreesCleaned?: () => Promise<void> | void;
  afterCheckpointReset?: () => Promise<void> | void;
}

function buildReplanPatch(
  graftedGraph: TaskGraph,
  taskId: string,
  removedDescendantIds: readonly string[]
): Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> {
  const nextTaskIds = collectSubtreeTaskIds(graftedGraph, taskId);
  const nextTaskIdSet = new Set(nextTaskIds);
  const nodes: Record<string, TaskNode> = {};
  const contracts: AgentTaskContract[] = [];
  for (const nextTaskId of nextTaskIds) {
    const node = graftedGraph.nodes[nextTaskId];
    if (node === undefined) continue;
    nodes[nextTaskId] = structuredClone(node);
    if (node.contract !== undefined) contracts.push(structuredClone(node.contract));
  }

  return {
    id: `patch-${randomUUID()}`,
    createdAt: new Date().toISOString(),
    actor: "system",
    type: "SUBTREE_REGENERATED",
    taskId,
    removedTaskIds: [taskId, ...removedDescendantIds],
    nodes,
    dependencies: graftedGraph.dependencies
      .filter(
        (dependency) =>
          nextTaskIdSet.has(dependency.fromTaskId) || nextTaskIdSet.has(dependency.toTaskId)
      )
      .map((dependency) => structuredClone(dependency)),
    contracts
  };
}

function collectSubtreeTaskIds(graph: TaskGraph, taskId: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const pending = [taskId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    result.push(current);
    pending.push(...(graph.nodes[current]?.childrenIds ?? []));
  }
  return result;
}

export async function replanSubtree(
  runId: string,
  taskId: string,
  reason: string,
  resume: ReplanResumeContext = { stepCache: {}, questionAnswers: {} },
  deps: ReplanMutationDeps = {}
): Promise<RunRecord> {
  const repo = getRunRepository();
  let run = await repo.get(runId);
  assertRunActionAllowed(run, "replan");
  if (isRunnerActive(run.runId)) {
    throw new RunLifecycleError(`Run ${run.runId} is being driven by an active runner.`);
  }

  const operationId = randomUUID();
  const claimed = await claimRunOperation(runId, "replan", {
    expectedStatuses: ["running"],
    operationId,
    allowTakeover: false
  });
  const lease = claimed.lease;
  const stopHeartbeat = startHeartbeat(runId, lease);
  const journal = replanMutationJournal();
  let operation: PlanMutationOperation | undefined;
  let recordPersisted = false;

  try {
    // Gate callers have already transitioned the run back to `running`. Claim
    // before every fallible graph/target preparation step so any such failure is
    // persisted as terminal truth instead of leaving an orphaned running run.
    run = claimed.run;
    const graph = await resolveExecutionGraph(run);
    const node = graph.nodes[taskId];
    if (node === undefined) {
      throw new RunValidationError(`Task "${taskId}" is not in the run's graph.`);
    }
    if (taskId === graph.rootId) {
      throw new RunValidationError("Cannot replan the root node — restart planning instead.");
    }

    const workspaceRecord = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
    const targetPath = await resolveRunTargetPath(run);
    if (workspaceRecord === null || targetPath === undefined || targetPath.length === 0) {
      throw new RunLifecycleError("Replanning requires a workspace with a local repo path.");
    }
    // Stage metadata still comes from the workspace, but repository identity is
    // immutable per run. A later workspace retarget must never redirect replan.
    const workspace = { ...workspaceRecord, repoPath: targetPath };

    const revision = (Number(node.metadata?.["replanRevision"]) || 0) + 1;
    const parentGoal =
      (node.parentId !== null ? graph.nodes[node.parentId]?.goal : undefined) ?? run.userPrompt;

    // Frozen seams: interfaces this node consumed stay contract law (siblings
    // already built against them); interfaces it produced must keep their
    // signatures so dependents stay valid without their own replan.
    const frozenSeams = [
      ...(node.contract?.consumedInterfaces ?? []),
      ...(node.contract?.producedInterfaces ?? [])
    ];

    const feature: FeatureRequest = {
      id: `replan-${randomUUID().slice(0, 8)}`,
      title: node.title,
      description: [
        `Re-plan ONE subtree of an existing, partially-executed plan.`,
        `Subtree goal: ${node.goal}`,
        `Parent context (do not re-plan this, it is already handled): ${parentGoal}`,
        `Why the previous attempt was discarded: ${reason}`
      ].join("\n"),
      repositoryPath: targetPath,
      targetStack: [],
      constraints: [
        `Implement inside the local git repository at ${targetPath}.`,
        ...frozenSeams.map(
          (seam) =>
            `FROZEN INTERFACE — design against it EXACTLY as written, never change it: ` +
            `${seam.id} (${seam.kind}): ${seam.signature}`
        )
      ],
      acceptanceCriteria: node.acceptanceCriteria ?? [`The subtree fulfils its goal: ${node.goal}`]
    };

    let planning: MockPlanningFlowResult;
    try {
      ({ planning } = await invokePlanning({
        run,
        feature,
        mode: run.granularity === "auto" ? "balanced" : run.granularity,
        runLabel: `${runId}:replan:${taskId}`,
        processLabel: `replan-decomposer:${taskId}`,
        userPrompt: feature.description,
        workspace,
        operationLease: lease,
        questionAnswers: resume.questionAnswers,
        stepCache: resume.stepCache
      }));
    } catch (error) {
      if (isDecomposerQuestionError(error)) {
        // U2 / INV-5: a clarifying question during replan is a GATE, not an
        // abort. Persist the resumable decomposer context (step cache + answers)
        // alongside the question; resumeReplanWithAnswer continues from here.
        return suspendReplanOnQuestion(runId, taskId, reason, resume, error, lease);
      }
      throw error;
    }

    const afterPlanning = await assertRunOperationCurrent(runId, lease);
    assertReplanStillRunning(afterPlanning, run.planRevision ?? 1, operationId);
    // The decomposer can run for minutes. A path that still existed when the
    // invocation started may name a replacement repository by the time its
    // answer returns, so re-establish physical target identity at the commit
    // boundary before publishing any graph or invalidating prior work.
    await resolveRunTargetPath(afterPlanning);

    // Graft the fresh subtree into the existing DAG (validated or it throws).
    const graft = graftSubtree({ graph, taskId, replacement: planning.decomposition.graph, revision });
    assertExecutableRunGraph(graft.graph);

    // Prepare every semantic consequence without touching Git. The RunRecord
    // CAS is the commit point; physical cleanup is repeatable post-CAS work.
    const invalidatedTaskIds = computeTaskInvalidationClosure(graph, taskId);
    const existing = executionResultsFromRun(run);
    const surviving = filterInvalidatedResults(
      existing.leafResults,
      existing.integrationResults,
      invalidatedTaskIds
    );
    const replanPatch = buildReplanPatch(graft.graph, taskId, graft.removedTaskIds);

    operation = await journal.reserve({
      operationId,
      runId,
      kind: "replan",
      expectedRunVersion: run.version,
      sourcePlanRevision: run.planRevision ?? 1,
      targetPlanRevision: (run.planRevision ?? 1) + 1,
      ...(run.targetContext?.fingerprint !== undefined
        ? { targetFingerprint: run.targetContext.fingerprint }
        : {}),
      graphHash: hashGraph(graft.graph),
      preparedGraph: graft.graph,
      patchId: replanPatch.id,
      runOperationId: lease.operationId,
      invalidatedTaskIds: [...invalidatedTaskIds]
    });
    if (operation.status === "prepared") {
      operation = await journal.transition(operation.operationId, {
        expectedVersion: operation.version,
        status: "graph_prepared"
      });
    }

    // Keep planning as the immutable base and append the replan as a semantic patch.
    // Baking an already-materialized graph while retaining older patches would
    // replay them twice and can resurrect an earlier regenerated subtree.
    const storedPlanning = run.planning as MockPlanningFlowResult;
    // Upgrade pre-marker records at the write boundary. Their planning graph
    // may already be a baked replan while SUBTREE patches are historical; once
    // the marker is stamped those patches would all replay again. Compact the
    // exact materialized graph into the new immutable base and absorb the old
    // log before appending this operation's patch.
    const normalizingLegacyGraph = run.planGraphStorage === undefined;
    const previousPlanning: MockPlanningFlowResult = normalizingLegacyGraph
      ? {
          ...storedPlanning,
          decomposition: {
            ...storedPlanning.decomposition,
            graph: structuredClone(graph),
            contracts: Object.values(graph.nodes).flatMap((entry) =>
              entry.contract === undefined ? [] : [structuredClone(entry.contract)]
            )
          }
        }
      : storedPlanning;
    const patchTrace: TraceEvent = {
      id: `trace-${replanPatch.id}`,
      type: "dag_patch_appended",
      timestamp: replanPatch.createdAt,
      actor: replanPatch.actor,
      planId: previousPlanning.decomposition.graph.planId,
      taskId,
      payload: {
        patchId: replanPatch.id,
        patchType: replanPatch.type,
        order: previousPlanning.traces.length + 1
      }
    };
    const updatedPlanning: MockPlanningFlowResult = {
      ...previousPlanning,
      traces: [...previousPlanning.traces, patchTrace]
    };

    const totalDurationMs =
      surviving.leafResults.reduce((sum, result) => sum + result.executorDurationMs, 0) +
      surviving.integrationResults.reduce((sum, result) => sum + integrationDurationMs(result), 0);
    const updatedExecution: RunExecutionResult = {
      runId,
      status: "failed",
      leafResults: surviving.leafResults,
      integrationResults: surviving.integrationResults,
      totalDurationMs,
      granularityVector: computeGranularityVector({
        graph: graft.graph,
        leafResults: surviving.leafResults,
        integrationResults: surviving.integrationResults,
        totalDurationMs
      })
    };

    const preparedOperation = operation;
    // Publish the graph under an operation lease. The journal is intentionally
    // advanced only after the CAS succeeds, so recovery can distinguish old
    // intent from a new plan waiting for cleanup/checkpoint/events.
    run = await updateRunForOperation(runId, lease, (current) => {
      // Heartbeat renewals are fenced mutations and legitimately advance the
      // RunRecord version while the decomposer is working. The operation lease
      // already proves writer identity here; only semantic status/revision must
      // still match the graph prepared by this replan.
      if (
        current.status !== "running" ||
        (current.planRevision ?? 1) !== preparedOperation.sourcePlanRevision
      ) {
        throw new RunMutationConflictError(
          `Replan ${operationId} can no longer publish from status ${current.status} ` +
            `at plan revision ${current.planRevision ?? 1}.`,
          current.status,
          current.version
        );
      }
      if ((current.patches ?? []).some((entry) => patchIdentity(entry) === replanPatch.id)) {
        throw new RunMutationConflictError(
          `Replan ${operationId} is already present in the durable patch log.`,
          current.status,
          current.version
        );
      }
      const next: RunRecord = {
        ...current,
        planning: updatedPlanning,
        planGraphStorage: IMMUTABLE_BASE_PATCH_LOG_STORAGE,
        patches: normalizingLegacyGraph ? [replanPatch] : [...(current.patches ?? []), replanPatch],
        execution: updatedExecution,
        planRevision: preparedOperation.targetPlanRevision,
        status: "needs_review"
      };
      if (next.pendingReplan?.taskId === taskId && next.pendingQuestion === undefined) {
        delete next.pendingReplan;
      }
      delete next.approvedAt;
      delete next.approvedPlanRevision;
      delete next.planApprovalOverride;
      return next;
    });
    recordPersisted = true;
    await deps.afterRunRecordCas?.();
    operation = await journal.transition(preparedOperation.operationId, {
      expectedVersion: preparedOperation.version,
      status: "record_persisted"
    });
    await deps.afterRecordPersisted?.();
    operation = await finalizePersistedReplanMutation({
      run,
      operation,
      lease,
      deps
    });

    const now = new Date().toISOString();
    for (const addedId of graft.addedTaskIds) {
      const added = graft.graph.nodes[addedId];
      if (added === undefined) continue;
      publishRunEvent(runId, { kind: "node.added", taskId: addedId, at: now });
    }
    // Return terminal durable truth, not the pre-finalization CAS snapshot that
    // still carries this operation lease. `finally` repeats the idempotent
    // release as a safety net for failures between here and function exit.
    stopHeartbeat();
    return await releaseRunOperation(runId, lease);
  } catch (error) {
    if (
      !recordPersisted &&
      operation !== undefined &&
      operation.status !== "failed" &&
      operation.status !== "completed"
    ) {
      await journal.transition(operation.operationId, {
        expectedVersion: operation.version,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      }).catch(() => undefined);
    }
    if (!recordPersisted && !(error instanceof RunMutationConflictError)) {
      await persistReplanFailure(runId, lease, error);
    }
    throw error;
  } finally {
    stopHeartbeat();
    await releaseRunOperation(runId, lease).catch(() => undefined);
  }
}

async function persistReplanFailure(
  runId: string,
  lease: RunOperationLease,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  let previous: RunRecord | undefined;
  const failed = await updateRunForOperation(runId, lease, (current) => {
    if (current.status !== "running") {
      throw new RunMutationConflictError(
        `Run ${runId} left running while its replan failed.`,
        current.status,
        current.version
      );
    }
    previous = current;
    return {
      ...current,
      status: "failed" as const,
      failedDuring: "running" as const,
      errorMessage: `Replan failed: ${message}`
    };
  });
  await appendStatusAndRunEventsOrRollback(
    requireCapturedRunRecord(previous, runId),
    failed,
    [],
    { actor: "system", lease }
  );
}

export async function finalizePersistedReplanMutation(input: {
  run: RunRecord;
  operation: PlanMutationOperation;
  lease: RunOperationLease;
  deps?: ReplanMutationDeps;
}): Promise<PlanMutationOperation> {
  const journal = replanMutationJournal();
  let operation = await journal.get(input.operation.operationId) ?? input.operation;
  if (operation.status === "failed") {
    throw new RunLifecycleError(`Replan mutation ${operation.operationId} is already failed.`);
  }
  if (operation.status === "completed") return operation;

  let current = await assertDurableReplanEvidence(input.run.runId, operation);
  const patch = replanPatchForOperation(current, operation);
  if (patch === undefined) {
    throw new RunLifecycleError(
      `Run ${current.runId} is missing the durable subtree patch for replan ${operation.operationId}.`
    );
  }

  if (!planMutationStatusAtLeast(operation.status, "worktrees_cleaned")) {
    current = await assertRunOperationCurrent(current.runId, input.lease);
    const invalidatedTaskIds = new Set(
      operation.invalidatedTaskIds ?? [
        ...patch.removedTaskIds,
        ...computeTaskInvalidationClosure(resolveExecutionGraph(current), patch.taskId)
      ]
    );
    if (current.provisioned !== undefined) {
      const graph = resolveExecutionGraph(current);
      await withRepositoryLease(
        { repoRoot: current.provisioned.repoRoot, runId: current.runId },
        async () => {
          const owned = await assertRunOperationCurrent(current.runId, input.lease);
          assertReplanRecoveryStatus(owned, operation);
          await new AmendmentsEngine().cleanInvalidatedTasks({
            repoRoot: current.provisioned!.repoRoot,
            runId: current.runId,
            graph,
            invalidatedTaskIds
          });
          const stillOwned = await assertRunOperationCurrent(current.runId, input.lease);
          assertReplanRecoveryStatus(stillOwned, operation);
        }
      );
    }
    operation = await journal.transition(operation.operationId, {
      expectedVersion: operation.version,
      status: "worktrees_cleaned"
    });
    await input.deps?.afterWorktreesCleaned?.();
  }

  if (!planMutationStatusAtLeast(operation.status, "checkpoint_reset")) {
    const owned = await assertRunOperationCurrent(current.runId, input.lease);
    assertReplanRecoveryStatus(owned, operation);
    await resetExecutionThread(current.runId);
    const stillOwned = await assertRunOperationCurrent(current.runId, input.lease);
    assertReplanRecoveryStatus(stillOwned, operation);
    operation = await journal.transition(operation.operationId, {
      expectedVersion: operation.version,
      status: "checkpoint_reset"
    });
    await input.deps?.afterCheckpointReset?.();
  }

  if (!planMutationStatusAtLeast(operation.status, "events_persisted")) {
    current = await assertRunOperationCurrent(current.runId, input.lease);
    assertReplanRecoveryStatus(current, operation);
    const graphProjection = projectRunRecordToPlanGraph(current, { resetRuntime: true });
    if (graphProjection === null) {
      throw new RunLifecycleError("Replanned graph could not be projected to the durable run-model log");
    }
    await appendRunEventsRequired(current.runId, [
      {
        eventId: `replan-status:${operation.operationId}:r${operation.targetPlanRevision}`,
        actor: "system",
        at: patch.createdAt,
        type: "run.status.changed",
        payload: runControlForRun(current)
      },
      {
        eventId: `replan-graph:${operation.operationId}:r${operation.targetPlanRevision}`,
        actor: "system",
        at: patch.createdAt,
        type: "plan.graph.projected",
        payload: graphProjection
      },
      {
        eventId: `replan-approval:${operation.operationId}:r${operation.targetPlanRevision}`,
        actor: "system",
        at: patch.createdAt,
        type: "decision.raised",
        payload: {
          decisionId: approvalDecisionId(operation.targetPlanRevision),
          kind: "approve_plan",
          blocking: true,
          context: {
            nodeIds: graphProjection.nodes
              .filter((node) => node.role === "leaf")
              .map((node) => node.nodeId)
          }
        }
      }
    ]);
    const stillOwned = await assertRunOperationCurrent(current.runId, input.lease);
    assertReplanRecoveryStatus(stillOwned, operation);
    operation = await journal.transition(operation.operationId, {
      expectedVersion: operation.version,
      status: "events_persisted"
    });
  }

  return journal.transition(operation.operationId, {
    expectedVersion: operation.version,
    status: "completed"
  });
}

async function assertDurableReplanEvidence(
  runId: string,
  operation: PlanMutationOperation
): Promise<RunRecord> {
  const current = await getRunRepository().get(runId);
  assertReplanRecoveryStatus(current, operation);
  if (
    operation.targetFingerprint !== undefined &&
    current.targetContext?.fingerprint !== operation.targetFingerprint
  ) {
    throw new RunLifecycleError(
      `Run ${runId} target no longer matches replan mutation ${operation.operationId}.`
    );
  }
  const patch = replanPatchForOperation(current, operation);
  if (patch === undefined) {
    throw new RunLifecycleError(`Run ${runId} is missing replan patch ${operation.patchId ?? "<unknown>"}.`);
  }
  const graphHash = hashGraph(resolveExecutionGraph(current));
  const preparedHash = isTaskGraphLike(operation.preparedGraph)
    ? hashGraph(operation.preparedGraph)
    : undefined;
  if (graphHash !== operation.graphHash && graphHash !== preparedHash) {
    throw new RunLifecycleError(`Run ${runId} graph does not match replan mutation ${operation.operationId}.`);
  }
  return current;
}

function isTaskGraphLike(value: unknown): value is TaskGraph {
  return (
    typeof value === "object" &&
    value !== null &&
    "nodes" in value &&
    "dependencies" in value &&
    "rootId" in value
  );
}

function assertReplanRecoveryStatus(current: RunRecord, operation: PlanMutationOperation): void {
  if (
    current.status !== "needs_review" ||
    (current.planRevision ?? 1) !== operation.targetPlanRevision
  ) {
    throw new RunLifecycleError(
      `Replan mutation ${operation.operationId} targets needs_review revision ` +
        `${operation.targetPlanRevision}, but run ${current.runId} is ${current.status} ` +
        `revision ${current.planRevision ?? 1}.`
    );
  }
}

function replanPatchForOperation(
  run: RunRecord,
  operation: PlanMutationOperation
): Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> | undefined {
  const patches = parseRunPatches(run.patches);
  const exact = operation.patchId === undefined
    ? undefined
    : patches.find(
        (patch): patch is Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> =>
          patch.id === operation.patchId && patch.type === "SUBTREE_REGENERATED"
      );
  if (exact !== undefined) return exact;
  if (operation.patchId !== undefined) return undefined;
  const replans = patches.filter(
    (patch): patch is Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> =>
      patch.type === "SUBTREE_REGENERATED"
  );
  return replans.at(-1);
}

function patchIdentity(value: unknown): string | undefined {
  return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
    ? value.id
    : undefined;
}

function hashGraph(graph: TaskGraph): string {
  return createHash("sha256").update(JSON.stringify(sortJsonValue(graph))).digest("hex");
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortJsonValue(entry)])
  );
}

function replanMutationJournal(): JsonPlanMutationJournal {
  return new JsonPlanMutationJournal({ directory: `${resolveRunsDirectory()}/plan-mutations` });
}

function assertReplanStillRunning(
  current: RunRecord,
  expectedPlanRevision: number,
  operationId: string
): void {
  if (current.status !== "running" || (current.planRevision ?? 1) !== expectedPlanRevision) {
    throw new RunMutationConflictError(
      `Replan ${operationId} can no longer continue from status ${current.status} ` +
        `at plan revision ${current.planRevision ?? 1}.`,
      current.status,
      current.version
    );
  }
}

// ─── replan question gate (U2) ─────────────────────────────────────────────

/**
 * Suspend the replan on the decomposer's clarifying question: the run pauses
 * (during "running") with the question projected for the DecisionChannel and
 * the resumable replan context persisted on the record.
 */
async function suspendReplanOnQuestion(
  runId: string,
  taskId: string,
  reason: string,
  resume: ReplanResumeContext,
  error: { nodeId: string; question: string; options: string[]; stepCache: Record<string, unknown> },
  lease: RunOperationLease
): Promise<RunRecord> {
  let previous: RunRecord | undefined;
  const saved = await updateRunForOperation(runId, lease, (current) => {
    if (current.status !== "running") {
      throw new RunMutationConflictError(
        `Run ${runId} cannot suspend a replan from status ${current.status}.`,
        current.status,
        current.version
      );
    }
    previous = current;
    return {
      ...current,
      status: "paused" as const,
      pausedDuring: "running" as const,
      pendingQuestion: {
        nodeId: error.nodeId,
        question: `[Replan de "${taskId}"] ${error.question}`,
        options: error.options.length >= 2 ? error.options : [...error.options, "Continuar con lo propuesto"]
      },
      pendingReplan: {
        taskId,
        reason,
        stepCache: error.stepCache,
        questionAnswers: resume.questionAnswers
      }
    };
  });

  const now = new Date().toISOString();
  await appendStatusAndRunEventsOrRollback(
    requireCapturedRunRecord(previous, runId),
    saved,
    [
      {
        eventId: `clarify-raised:${runId}:${error.nodeId}`,
        actor: "system",
        at: now,
        type: "decision.raised",
        payload: {
          decisionId: `clarify:${error.nodeId}`,
          kind: "clarify",
          blocking: true,
          context: {
            nodeIds: [error.nodeId],
            question: saved.pendingQuestion?.question ?? error.question,
            options: saved.pendingQuestion?.options ?? error.options
          }
        }
      }
    ],
    { at: now, lease }
  );
  return saved;
}

/**
 * Resume a replan suspended on a clarifying question (U2): claims the pending
 * question atomically (INV-4), folds the answer into the replan context, and
 * re-enters replanSubtree — the decomposer continues from its step cache.
 */
export async function resumeReplanWithAnswer(
  runId: string,
  nodeId: string | undefined,
  answer: string
): Promise<RunRecord> {
  const now = new Date().toISOString();
  let decisionId: string | undefined;
  let previous: RunRecord | undefined;
  const saved = await claimRunMutation(
    runId,
    {
      status: ["paused"],
      pausedDuring: "running",
      pendingQuestionNodeId: nodeId ?? "any"
    },
    (current) => {
      previous = current;
      const pending = current.pendingReplan;
      const question = current.pendingQuestion;
      if (pending === undefined || question === undefined) {
        throw new RunMutationConflictError(
          `Run ${runId} has no suspended replan to resume.`,
          current.status,
          current.version
        );
      }
      const questionAnswers = { ...pending.questionAnswers, [question.nodeId]: answer };
      decisionId = `clarify:${question.nodeId}`;
      if (current.activeOperation !== undefined && current.activeOperation.kind !== "replan") {
        throw new RunMutationConflictError(
          `Run ${runId} is owned by ${current.activeOperation.kind} operation ${current.activeOperation.operationId}.`,
          current.status,
          current.version
        );
      }
      // A crash may strand the lease that originally suspended this gate. The
      // answer is the hand-off boundary: revoke that generation atomically so
      // the resumed replan can claim a fresh fenced operation.
      const base = current.activeOperation === undefined ? current : invalidateRunOperation(current);
      const next = {
        ...base,
        status: "running" as const,
        pendingReplan: {
          ...pending,
          questionAnswers,
          resumeRequestedAt: now
        }
      };
      delete next.pausedDuring;
      delete next.pendingQuestion;
      return next;
    }
  );

  await appendStatusAndRunEventsOrRollback(
    requireCapturedRunRecord(previous, runId),
    saved,
    decisionId !== undefined
      ? [
          {
            actor: "human",
            at: now,
            type: "decision.resolved",
            payload: { decisionId, choice: { answer }, actor: "human" }
          }
        ]
      : [],
    { actor: "human", at: now }
  );
  startRunBackgroundTask(runId, "replan:resume", () =>
    resumeDurablePendingReplan(runId).then(() => undefined)
  );
  return saved;
}

/**
 * Re-enter a replan from the answer persisted on the RunRecord. The route and
 * restart recovery both call this seam, so a crash after decision.resolved but
 * before the in-memory callback starts cannot lose the user's answer.
 */
export async function resumeDurablePendingReplan(runId: string): Promise<RunRecord> {
  const run = await getRunRepository().get(runId);
  const pending = run.pendingReplan;
  if (
    run.status !== "running" ||
    pending === undefined ||
    pending.resumeRequestedAt === undefined ||
    run.pendingQuestion !== undefined
  ) {
    throw new RunMutationConflictError(
      `Run ${runId} has no answered replan ready to resume.`,
      run.status,
      run.version
    );
  }
  return replanSubtree(runId, pending.taskId, pending.reason, {
    stepCache: pending.stepCache,
    questionAnswers: pending.questionAnswers
  });
}
