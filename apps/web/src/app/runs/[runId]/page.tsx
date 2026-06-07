import { notFound } from "next/navigation";
import { deriveConflictList } from "@/lib/conflict-view-model";
import { isExecutionResult } from "@/lib/execution-summary";
import { toRunGraphViewModel } from "@/lib/graph-view-model";
import { granularityLabelForMode } from "@/lib/granularity";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { canNodeRunNow, operationalMetrics } from "@/lib/run-presentation";
import {
  RunNotFoundError,
  getRunRepository,
  parseRunPatches
} from "@/lib/server/runs";
import { buildRunModelSeed } from "@/lib/server/runs/run-model-projection";
import { ensureRunModelEventLogForRun } from "@/lib/server/runs/run-model-event-log";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { RunCanvasBinding } from "./_components/run-canvas-binding.client";
import { RunModelView } from "./_components/run-model-view.client";
import { RunHeader } from "./_components/run-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunPageProps {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ model?: string }>;
}

export default async function RunPage({ params, searchParams }: RunPageProps): Promise<React.ReactElement> {
  const { runId } = await params;
  const { model: modelFlag } = await searchParams;
  let run;
  try {
    run = await getRunRepository().get(runId);
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      notFound();
    }
    throw error;
  }

  // Agent-first is the default run workspace. The legacy canvas remains available
  // as a short-lived rollback via `?model=legacy`.
  if (modelFlag !== "legacy") {
    const initialEvents = await ensureRunModelEventLogForRun(run);
    return (
      <div className="mh-fullbleed">
        <RunModelView seed={buildRunModelSeed(run)} initialEvents={initialEvents} />
      </div>
    );
  }

  const workspaces = await getWorkspaceRepository().list();
  const workspace = workspaces.find((entry) => entry.id === run.workspaceId) ?? null;
  const snapshot = projectRunRecordToSnapshot(run);
  const patches = parseRunPatches(run.patches);
  const conflictState = conflictStateFor(snapshot, patches);
  const graph = snapshot !== null ? toRunGraphViewModel(snapshot) : null;
  const runSummary = snapshotSummary(snapshot, graph);
  const planReview = buildPlanReviewSummary(snapshot, patches);
  const readyTaskCount = graph?.nodes.filter((node) => canNodeRunNow(node)).length ?? 0;
  const activeConflictCount = conflictState.conflicts.filter((conflict) => !conflict.acknowledged).length;
  // Disambiguate WHERE a failed run broke so the phase bar marks the real step.
  // Prefer the explicit phase; fall back to approval (only set once execution is
  // reachable) for records persisted before `failedDuring` existed.
  const failedPhase =
    run.status === "failed"
      ? run.failedDuring === "running" || (run.failedDuring === undefined && run.approvedAt !== undefined)
        ? "execution"
        : "planning"
      : undefined;

  return (
    <div className="mh-fullbleed">
      <RunCanvasBinding
        runId={run.runId}
        initialStatus={run.status}
        defaultModelId={run.model}
        snapshot={snapshot}
        configLabel={`granularity / ${granularityLabelForMode(run.granularity)}`}
        readyTaskCount={readyTaskCount}
        activeConflictCount={activeConflictCount}
        planReview={planReview}
        patches={patches}
        timelineRun={{
          runId: run.runId,
          status: run.status,
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
          ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
          ...(run.approvedAt !== undefined ? { approvedAt: run.approvedAt } : {}),
          ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {})
        }}
        conflicts={conflictState.conflicts}
        {...(conflictState.error !== undefined ? { conflictError: conflictState.error } : {})}
        {...(isExecutionResult(run.execution) ? { execution: run.execution } : {})}
        {...(run.errorMessage !== undefined && run.errorMessage.length > 0 ? { errorMessage: run.errorMessage } : {})}
        {...(failedPhase !== undefined ? { failedPhase } : {})}
        initialPendingQuestion={run.pendingQuestion ?? null}
        initialLivePlanNodes={run.livePlanningNodes ?? []}
        headerSlot={
          <RunHeader
            run={run}
            workspace={workspace}
            liveStatus={run.status}
            summary={runSummary}
          />
        }
      />
    </div>
  );
}

function snapshotSummary(
  snapshot: ReturnType<typeof projectRunRecordToSnapshot>,
  graph: ReturnType<typeof toRunGraphViewModel> | null
): { nodes: number; leaves: number; depth: number; metrics: ReturnType<typeof operationalMetrics> } | null {
  if (snapshot === null || graph === null) return null;
  const nodes = Object.values(snapshot.graphSnapshot.nodes);
  return {
    nodes: nodes.length,
    leaves: nodes.filter((node) => node.kind === "leaf").length,
    depth: Math.max(0, ...nodes.map((node) => node.depth)),
    metrics: operationalMetrics(graph)
  };
}

function conflictStateFor(
  snapshot: ReturnType<typeof projectRunRecordToSnapshot>,
  patches: readonly unknown[]
): { conflicts: ReturnType<typeof deriveConflictList>; error?: string } {
  if (snapshot === null) {
    return { conflicts: [] };
  }
  try {
    return { conflicts: deriveConflictList(snapshot, patches) };
  } catch (error) {
    return {
      conflicts: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
