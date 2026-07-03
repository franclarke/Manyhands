/**
 * Fixture authoring helpers — PURE DATA construction for golden fixtures.
 *
 * NOT a reducer, selector, or UI. This only assembles `RunEvent[]` with the same
 * shape as the future SSE stream (PR 03 of `docs/design/implementation-plan.md`).
 * `seq` is auto-assigned (1-based) so fixtures stay strictly monotonic by
 * construction; `at` is derived from `seq` for deterministic ordering.
 */
import type {
  Actor,
  RunConfig,
  RunEvent,
  RunEventPayloads,
  RunEventType,
  RunFixture,
  RunId
} from "../types";

/** A typed, seq-less event spec; `fixture()` assigns seq/at/runId. */
type EventSpec = {
  [K in RunEventType]: { actor: Actor; type: K; payload: RunEventPayloads[K] };
}[RunEventType];

/** Typed authoring of a single event (payload is checked against `type`). */
export function ev<K extends RunEventType>(
  actor: Actor,
  type: K,
  payload: RunEventPayloads[K]
): { actor: Actor; type: K; payload: RunEventPayloads[K] } {
  return { actor, type, payload };
}

const BASE_AT = Date.parse("2026-06-05T00:00:00.000Z");

/** Assemble a `RunFixture` from ordered specs, assigning monotonic `seq`/`at`. */
export function fixture(runId: RunId, specs: EventSpec[]): RunFixture {
  const events: RunEvent[] = specs.map((spec, index) => ({
    seq: index + 1,
    at: new Date(BASE_AT + (index + 1) * 1000).toISOString(),
    runId,
    actor: spec.actor,
    type: spec.type,
    payload: spec.payload as Record<string, unknown>
  }));
  return { runId, events };
}

/** Shared demo config so fixtures don't repeat it. */
export const demoConfig: RunConfig = {
  aggressiveness: "medium",
  planningModel: "sonnet",
  executionSelection: { executorId: "claude-code-cli", model: "sonnet" },
  repairSelection: { executorId: "claude-code-cli", model: "sonnet" }
};
