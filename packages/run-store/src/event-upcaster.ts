/**
 * Durable event schema versioning.
 *
 * The canonical journal (`*.events.v2.jsonl`) is append-only and immortal, so the
 * on-disk shape of an event can never change in place. When an event's shape must
 * change, bump {@link CURRENT_EVENT_SCHEMA_VERSION} and register an upcaster from
 * the previous version to the next one. Reading then migrates every older record
 * forward before it reaches the domain schema. A record from a NEWER version than
 * this build understands fails closed — a future journal is never read blindly.
 */
export const CURRENT_EVENT_SCHEMA_VERSION = 2;

/** Migrates a durable event payload from version N to version N+1. */
type EventUpcaster = (event: unknown) => unknown;

/**
 * Registry keyed by source version. Empty today: v2 is the first and current
 * shape, so nothing needs migrating yet. Add `1: (event) => ...` here the day a
 * v1 record shape is superseded.
 */
const upcasters: Record<number, EventUpcaster> = {};

/** Apply successive upcasters to bring a stored event up to the current version. */
export function upcastEventToCurrent(schemaVersion: number, event: unknown): unknown {
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error(`Invalid event schema version ${schemaVersion}.`);
  }
  if (schemaVersion > CURRENT_EVENT_SCHEMA_VERSION) {
    throw new Error(`Event schema version ${schemaVersion} is newer than the supported ${CURRENT_EVENT_SCHEMA_VERSION}.`);
  }
  let version = schemaVersion;
  let current = event;
  while (version < CURRENT_EVENT_SCHEMA_VERSION) {
    const upcaster = upcasters[version];
    if (upcaster === undefined) throw new Error(`No upcaster registered for event schema version ${version}.`);
    current = upcaster(current);
    version += 1;
  }
  return current;
}
