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
import { RunLifecycleError, RunValidationError } from "./errors";
import { publishRunEvent } from "./event-bus";
import { resetExecutionThread } from "./execution-host";
import { runExecutionPipeline } from "./execution-pipeline";
import {
  executionResultsFromRun,
  integrationDurationMs,
  provisionedFromRecord,
  resolveExecutionGraph
} from "./execution-state";
import { planNodeProposedEvent } from "./planning-run-model-adapter";
import { publishRunModelEvent } from "./run-model-event-log";
import type { RunRecord } from "./schema";
import { getRunRepository } from "./store";

export async function replanSubtree(runId: string, taskId: string, reason: string): Promise<RunRecord> {
  const repo = getRunRepository();
  let run = await repo.get(runId);
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
      "Replanning requires the Gemini decomposer. Install Gemini CLI (or set MANYHANDS_GEMINI_BIN)."
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
      questionAnswers: {},
      stepCache: {}
    });
  } catch (error) {
    if (isDecomposerQuestionError(error)) {
      throw new RunLifecycleError(
        `El decomposer necesita una aclaración para re-planificar "${taskId}": ${error.question}`
      );
    }
    throw error;
  }

  // Graft the fresh subtree into the existing DAG (validated or it throws).
  const graft = graftSubtree({ graph, taskId, replacement: planning.decomposition.graph, revision });

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

  run = await repo.save({
    ...run,
    planning: updatedPlanning,
    execution: updatedExecution,
    status: "running"
  });

  const now = new Date().toISOString();
  publishRunEvent(runId, { kind: "status.changed", status: "running", at: now });
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

  void runExecutionPipeline(runId).catch(() => undefined);
  return run;
}
