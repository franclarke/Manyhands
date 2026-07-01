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
import { randomUUID } from "node:crypto";
import {
  isDecomposerQuestionError,
  runMockPlanningFlow,
  type FeatureRequest,
  type MockPlanningFlowResult
} from "@manyhands/core";
import {
  AmendmentsEngine,
  computeGranularityVector,
  type RunExecutionResult
} from "@manyhands/execution-core";
import { graftSubtree } from "@manyhands/task-graph";
import { pickDecomposer } from "@/lib/decomposer-policy";
import { getWorkspaceRepository } from "../workspaces";
import { RunLifecycleError, RunMutationConflictError, RunValidationError } from "./errors";
import { publishRunEvent } from "./event-bus";
import { claimRunMutation } from "./mutation-guard";
import { assertRunActionAllowed } from "./lifecycle";
import { resetExecutionThread } from "./execution-host";
import { runExecutionPipeline } from "./execution-pipeline";
import {
  executionResultsFromRun,
  integrationDurationMs,
  provisionedFromRecord,
  assertExecutableRunGraph,
  resolveExecutionGraph
} from "./execution-state";
import { planNodeProposedEvent } from "./planning-run-model-adapter";
import { publishRunModelEvent } from "./run-model-event-log";
import { isRunnerActive, startRunBackgroundTask } from "./runner-state";
import {
  appendStatusAndRunEventsOrRollback,
  requireCapturedRunRecord,
  saveRunWithRequiredStatusEvent
} from "./audited-mutation";
import type { RunRecord } from "./schema";
import { getRunRepository } from "./store";

/** Resumable decomposer context carried across a replan's clarifying question. */
export interface ReplanResumeContext {
  stepCache: Record<string, unknown>;
  questionAnswers: Record<string, string>;
}

export async function replanSubtree(
  runId: string,
  taskId: string,
  reason: string,
  resume: ReplanResumeContext = { stepCache: {}, questionAnswers: {} }
): Promise<RunRecord> {
  const repo = getRunRepository();
  let run = await repo.get(runId);
  assertRunActionAllowed(run, "replan");
  if (isRunnerActive(run.runId)) {
    throw new RunLifecycleError(`Run ${run.runId} is being driven by an active runner.`);
  }
  const graph = await resolveExecutionGraph(run);
  const node = graph.nodes[taskId];
  if (node === undefined) {
    throw new RunValidationError(`Task "${taskId}" is not in the run's graph.`);
  }
  if (taskId === graph.rootId) {
    throw new RunValidationError("Cannot replan the root node — restart planning instead.");
  }

  const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
  if (workspace === null || workspace.repoPath === undefined || workspace.repoPath.length === 0) {
    throw new RunLifecycleError("Replanning requires a workspace with a local repo path.");
  }

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
    repositoryPath: workspace.repoPath,
    targetStack: [],
    constraints: [
      `Implement inside the local git repository at ${workspace.repoPath}.`,
      ...frozenSeams.map(
        (seam) =>
          `FROZEN INTERFACE — design against it EXACTLY as written, never change it: ` +
          `${seam.id} (${seam.kind}): ${seam.signature}`
      )
    ],
    acceptanceCriteria: node.acceptanceCriteria ?? [`The subtree fulfils its goal: ${node.goal}`]
  };

  const selection = pickDecomposer({
    userPrompt: feature.description,
    model: run.planningModel ?? run.model,
    workspace
  });
  if (selection.provider === "deterministic") {
    throw new RunLifecycleError(
      "Replanning requires the Claude Code decomposer. Install Claude Code CLI (or set MANYHANDS_CLAUDE_BIN)."
    );
  }

  let planning: MockPlanningFlowResult;
  try {
    planning = await runMockPlanningFlow({
      feature,
      mode: run.granularity === "auto" ? "balanced" : run.granularity,
      schedulerPolicy: "risk_aware",
      runLabel: `${runId}:replan:${taskId}`,
      decomposer: selection.decomposer,
      questionAnswers: resume.questionAnswers,
      stepCache: resume.stepCache
    });
  } catch (error) {
    if (isDecomposerQuestionError(error)) {
      // U2 / INV-5: a clarifying question during replan is a GATE, not an
      // abort. Persist the resumable decomposer context (step cache + answers)
      // alongside the question; resumeReplanWithAnswer continues from here.
      return suspendReplanOnQuestion(runId, taskId, reason, resume, error);
    }
    throw error;
  }

  // Graft the fresh subtree into the existing DAG (validated or it throws).
  const graft = graftSubtree({ graph, taskId, replacement: planning.decomposition.graph, revision });
  assertExecutableRunGraph(graft.graph);

  // Invalidate the closure: worktrees cleaned, results filtered to survivors.
  const provisioned = provisionedFromRecord(run.provisioned);
  const existing = executionResultsFromRun(run);
  let leafResults = existing.leafResults;
  let integrationResults = existing.integrationResults;
  if (provisioned !== undefined) {
    const invalidation = await new AmendmentsEngine().invalidateTask({
      repoRoot: provisioned.repoRoot,
      runId,
      graph,
      taskId,
      leafResults,
      integrationResults
    });
    leafResults = invalidation.leafResults;
    integrationResults = invalidation.integrationResults;
  }

  // Persist: graph + contracts rebuilt from the grafted nodes (the graph is the
  // single source of truth — D1), survivors pre-seeded for the next frontier.
  const contracts = Object.values(graft.graph.nodes).flatMap((n) => (n.contract !== undefined ? [n.contract] : []));
  const previousPlanning = run.planning as MockPlanningFlowResult;
  const updatedPlanning: MockPlanningFlowResult = {
    ...previousPlanning,
    decomposition: {
      ...previousPlanning.decomposition,
      graph: graft.graph,
      contracts
    }
  };

  const totalDurationMs =
    leafResults.reduce((sum, r) => sum + r.executorDurationMs, 0) +
    integrationResults.reduce((sum, r) => sum + integrationDurationMs(r), 0);
  const updatedExecution: RunExecutionResult = {
    runId,
    status: "failed",
    leafResults,
    integrationResults,
    totalDurationMs,
    granularityVector: computeGranularityVector({
      graph: graft.graph,
      leafResults,
      integrationResults,
      totalDurationMs
    })
  };

  // The previous execution thread points at the old graph shape; drop it so
  // the next start re-enters the wavefront seeded with the survivors.
  await resetExecutionThread(runId);

  const previous = run;
  run = await saveRunWithRequiredStatusEvent(previous, {
    ...run,
    planning: updatedPlanning,
    execution: updatedExecution,
    status: "running"
  });

  const now = new Date().toISOString();
  for (const addedId of graft.addedTaskIds) {
    const added = graft.graph.nodes[addedId];
    if (added === undefined) continue;
    publishRunEvent(runId, { kind: "node.added", taskId: addedId, at: now });
    publishRunModelEvent(
      runId,
      planNodeProposedEvent(
        {
          nodeId: addedId,
          parentId: added.parentId,
          title: added.title,
          goal: added.goal,
          depth: added.depth
        },
        "leaf"
      )
    );
  }

  startRunBackgroundTask(runId, "replan:execution", () => runExecutionPipeline(runId));
  return run;
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
  error: { nodeId: string; question: string; options: string[]; stepCache: Record<string, unknown> }
): Promise<RunRecord> {
  let previous: RunRecord | undefined;
  const saved = await claimRunMutation(runId, { status: ["running"] }, (current) => {
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
    { at: now }
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
  let context: { taskId: string; reason: string; resume: ReplanResumeContext } | undefined;
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
      context = {
        taskId: pending.taskId,
        reason: pending.reason,
        resume: {
          stepCache: pending.stepCache,
          questionAnswers: { ...pending.questionAnswers, [question.nodeId]: answer }
        }
      };
      decisionId = `clarify:${question.nodeId}`;
      const next = { ...current, status: "running" as const };
      delete next.pausedDuring;
      delete next.pendingQuestion;
      delete next.pendingReplan;
      return next;
    }
  );

  const now = new Date().toISOString();
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
  const replanContext = context;
  if (replanContext !== undefined) {
    startRunBackgroundTask(runId, "replan:resume", async () => {
      await replanSubtree(runId, replanContext.taskId, replanContext.reason, replanContext.resume);
    });
  }
  return saved;
}
