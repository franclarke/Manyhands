import { notFound } from "next/navigation";
import { deriveConflictList } from "@/lib/conflict-view-model";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
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
  const scenario = findScenario(run.scenarioId) ?? null;
  const snapshot = projectRunRecordToSnapshot(run);
  const patches = parseRunPatches(run.patches);
  const conflictState = conflictStateFor(snapshot, patches);
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
        benchmarkLabel={scenario?.benchmarkId ?? run.scenarioId}
        configLabel={`granularity · ${run.granularity}`}
        readyTaskCount={readyTaskCount}
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
        headerSlot={
          <RunHeader run={run} workspace={workspace} scenario={scenario} liveStatus={run.status} />
        }
      />
    </div>
  );
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
