import { notFound } from "next/navigation";
import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import {
  isDaemonRequestFailure,
  queryProductRun,
  readProductRunEvents
} from "@/lib/server/daemon/productive-client";
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
  const { runId: encodedRunId } = await params;
  const runId = decodeURIComponent(encodedRunId);
  let run;
  try {
    run = await queryProductRun(runId);
  } catch (error) {
    if (isDaemonRequestFailure(error)) notFound();
    throw error;
  }
  const initialEvents = (await readProductRunEvents(runId, 0)).events.map((event) => adaptCoordinatorEvent({
    eventId: event.eventId,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt,
    type: event.type,
    payload: event.payload as Record<string, unknown>
  }));
  return (
    <div className="mh-workspace-frame">
      <RunModelView
        seed={{
          id: runId,
          title: run.title ?? run.definition?.title ?? run.goal,
          goal: run.goal,
          lifecycle: run.lifecycle,
          eventSequence: run.sequence
        }}
        initialEvents={initialEvents}
      />
    </div>
  );
}
