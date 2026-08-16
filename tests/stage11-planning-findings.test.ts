import { describe, expect, it } from "vitest";

import { foldRun, type RunEvent } from "@manyhands/run-coordinator";

import { planningFailureFindings } from "@/lib/run-model/presentation";

const at = "2026-08-15T00:00:00.000Z";

/**
 * A failed planning run showed seven findings as one red paragraph:
 * `code: message | code: message | …`. The engine had them as a list and the
 * daemon flattened them into a sentence, so the operator had to parse prose to
 * learn which of seven things went wrong.
 *
 * The findings travel structured. The `reason` string stays, because journals
 * written before this carry only that and still have to render.
 */
describe("Planning failure findings", () => {
  it("keeps each finding separate through the projection", () => {
    const projection = foldRun([created(), failed({
      reason: "artifact_path_outside_write_surface: A | resource_double_writer: B",
      findings: [
        { code: "artifact_path_outside_write_surface", message: "A", severity: "error" },
        { code: "resource_double_writer", message: "B", severity: "error" }
      ]
    })]);

    expect(projection.planningFindings?.map(({ code }) => code)).toEqual([
      "artifact_path_outside_write_surface",
      "resource_double_writer"
    ]);
    // The prose survives for anything that only knows how to show a sentence.
    expect(projection.failureReason).toContain("resource_double_writer");
  });

  it("still folds a journal recorded before findings were structured", () => {
    const projection = foldRun([created(), failed({ reason: "schema_invalid: units.unit:a.outcomes" })]);

    expect(projection.failureReason).toBe("schema_invalid: units.unit:a.outcomes");
    expect(projection.planningFindings).toBeUndefined();
  });

  it("presents structured findings one per entry", () => {
    const findings = planningFailureFindings({
      failureReason: "a: one | b: two",
      planningFindings: [
        { code: "a", message: "one", severity: "error" },
        { code: "b", message: "two", severity: "warning" }
      ]
    });

    expect(findings).toEqual([
      { code: "a", message: "one", severity: "error" },
      { code: "b", message: "two", severity: "warning" }
    ]);
  });

  it("recovers entries from a historical reason rather than showing one paragraph", () => {
    // Journals already on disk carry only the joined sentence. Splitting it is
    // reading history, not a substitute for recording the findings.
    const findings = planningFailureFindings({
      failureReason: "artifact_path_outside_write_surface: Artifact a is outside. | resource_double_writer: Writers x and y are not ordered."
    });

    expect(findings).toEqual([
      { code: "artifact_path_outside_write_surface", message: "Artifact a is outside.", severity: "error" },
      { code: "resource_double_writer", message: "Writers x and y are not ordered.", severity: "error" }
    ]);
  });

  it("shows an unstructured reason as a single finding without inventing a code", () => {
    const findings = planningFailureFindings({ failureReason: "The planner timed out." });

    expect(findings).toEqual([{ message: "The planner timed out.", severity: "error" }]);
  });

  it("has nothing to show when the run did not fail", () => {
    expect(planningFailureFindings({})).toEqual([]);
  });
});

function created(): RunEvent {
  return event(1, "run.created", { goal: "Build it" });
}

function failed(payload: Record<string, unknown>): RunEvent {
  return event(2, "planning.failed", payload as never);
}

function event<T extends RunEvent["type"]>(
  sequence: number,
  type: T,
  payload: Extract<RunEvent, { type: T }>["payload"]
): Extract<RunEvent, { type: T }> {
  return { eventId: `event-${sequence}`, runId: "run-1", sequence, occurredAt: at, type, payload } as Extract<RunEvent, { type: T }>;
}
