import { notFound } from "next/navigation";
import {
  RunNotFoundError,
  getRunRepository
} from "@/lib/server/runs";
import { buildRunModelSeed } from "@/lib/server/runs/run-model-projection";
import { ensureRunModelEventLogForRun } from "@/lib/server/runs/run-model-event-log";
import { getWorkspaceRepository } from "@/lib/server/workspaces";
import { RunModelView } from "./_components/run-model-view.client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RunPageProps {
  params: Promise<{ runId: string }>;
}

/**
 * Run control room — agent-first workspace over the run-model event log.
 * The page seeds the reducer with the persisted snapshot; live updates stream
 * through the SSE adapter into the same reducer (single source of truth).
 */
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

  const [initialEvents, workspaces] = await Promise.all([
    ensureRunModelEventLogForRun(run),
    getWorkspaceRepository().list()
  ]);
  const workspace = workspaces.find((entry) => entry.id === run.workspaceId) ?? null;

  return (
    <div className="mh-workspace-frame">
      <RunModelView
        seed={buildRunModelSeed(run)}
        initialEvents={initialEvents}
        workspaceName={workspace?.name ?? undefined}
      />
    </div>
  );
}
