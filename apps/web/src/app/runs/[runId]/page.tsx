import { notFound } from "next/navigation";
import { deriveConflictList } from "@/lib/conflict-view-model";
import { isExecutionResult } from "@/lib/execution-summary";
import { toRunGraphViewModel } from "@/lib/graph-view-model";
import { granularityLabelForMode } from "@/lib/granularity";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { buildPlanReviewSummary } from "@/lib/plan-review";
import { operationalMetrics } from "@/lib/run-presentation";
import { findScenario } from "@/lib/scenarios";
import {
  RunNotFoundError,
  getRunRepository,
  parseRunPatches
} from "@/lib/server/runs";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import type { MockPlanningFlowResult } from "@manyhands/core";
import { RunCanvasBinding } from "./_components/run-canvas-binding.client";
import { RunHeader } from "./_components/run-header";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunPageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunPage({ params }: RunPageProps): Promise<React.ReactElement> {
  const { runId } = await params;
  let run;
  try {
    run = await getRunRepository().get(runId);
  } catch (error) {
    if (error instanceof RunNotFoundError) {
      notFound();
    }
    throw error;
  }

  const workspaces = await getWorkspaceRepository().list();
  const workspace = workspaces.find((entry) => entry.id === run.workspaceId) ?? null;
  const scenario = run.scenarioId !== undefined ? findScenario(run.scenarioId) ?? null : null;
  const snapshot = projectRunRecordToSnapshot(run);
  const patches = parseRunPatches(run.patches);
  const conflictState = conflictStateFor(snapshot, patches);
  const runSummary = snapshotSummary(snapshot);
  const planReview = buildPlanReviewSummary(snapshot, patches);
  const readyTaskCount =
    run.planning !== undefined
      ? (run.planning as MockPlanningFlowResult).summary.leafCount
      : 0;

  return (
    <div className="mh-fullbleed">
      <RunCanvasBinding
        runId={run.runId}
        initialStatus={run.status}
        snapshot={snapshot}
        benchmarkLabel={scenario?.benchmarkId ?? run.scenarioId ?? "prompt"}
        configLabel={`granularity / ${granularityLabelForMode(run.granularity)}`}
        readyTaskCount={readyTaskCount}
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
        initialPendingQuestion={run.pendingQuestion ?? null}
        headerSlot={
          <RunHeader
            run={run}
            workspace={workspace}
            scenario={scenario}
            liveStatus={run.status}
            summary={runSummary}
          />
        }
      />
    </div>
  );
}

function snapshotSummary(
  snapshot: ReturnType<typeof projectRunRecordToSnapshot>
): { nodes: number; leaves: number; depth: number; metrics: ReturnType<typeof operationalMetrics> } | null {
  if (snapshot === null) return null;
  const graph = toRunGraphViewModel(snapshot);
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
