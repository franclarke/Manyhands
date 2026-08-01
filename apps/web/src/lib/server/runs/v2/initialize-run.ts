import { JsonlRunEventStore } from "@manyhands/run-store";

export interface RunCanonicalInitialization {
  directory: string;
  runId: string;
  goal: string;
  occurredAt?: string;
}

/**
 * Establish the canonical event source before the create response is visible.
 * Planning remains responsible for all subsequent events and can safely reuse
 * this durable `run.created` event.
 */
export async function initializeRunCanonicalEvents(input: RunCanonicalInitialization): Promise<void> {
  const events = new JsonlRunEventStore({ directory: input.directory });
  const authority = await events.claimAuthority(input.runId, `create:${input.runId}`);
  const existing = await events.load(input.runId);
  if (existing.length > 0) {
    const created = existing.find((event) => event.type === "run.created");
    if (created?.payload.goal !== input.goal) {
      throw new Error(`Run ${input.runId} already has a different canonical goal.`);
    }
    return;
  }
  await events.appendFenced(input.runId, 0, authority, [{
    eventId: `run:${input.runId}:created`,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    type: "run.created",
    payload: { goal: input.goal }
  }]);
}
