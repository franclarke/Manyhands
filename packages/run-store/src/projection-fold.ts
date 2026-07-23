import {
  foldRun,
  reduceRun,
  type RunEvent,
  type RunProjection
} from "@manyhands/run-coordinator";

/**
 * Domain-equivalent fold that avoids repeatedly cloning the ever-growing
 * appliedEventIds audit list. reduceRun only appends to that list; it does not
 * consult it for transition decisions, so restoring it once preserves the
 * canonical projection while keeping replay linear for fact-heavy histories.
 */
export function foldRunEvents(events: readonly RunEvent[]): RunProjection {
  if (events.length === 0) throw new Error("Cannot fold a run without run.created.");
  const initial = foldRun([events[0]!]);
  return reduceRunEvents(initial, events.slice(1));
}

export function reduceRunEvents(
  projection: RunProjection,
  events: readonly RunEvent[]
): RunProjection {
  if (events.length === 0) return projection;
  const appliedEventIds = [
    ...projection.appliedEventIds,
    ...events.map((event) => event.eventId)
  ];
  let next: RunProjection = {
    ...projection,
    appliedEventIds: []
  };
  for (const event of events) {
    next = reduceRun(next, event);
    // Prevent the next structuredClone from copying the batch prefix again.
    next.appliedEventIds.length = 0;
  }
  next.appliedEventIds = appliedEventIds;
  return next;
}
