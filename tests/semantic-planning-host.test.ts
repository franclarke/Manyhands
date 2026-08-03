import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanningCapacityError, type SemanticPlanDraft } from "@manyhands/decomposer";
import { RunEventSchema } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";
import { runSemanticPlanningV2 } from "@/lib/server/runs/v2/semantic-planning-host";
import { bookingSnapshot } from "./helpers/target-planning-fixtures.js";

let directory: string;
const authority = { operationId: "semantic-planning-op", fencingToken: 4 };

beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "mh-semantic-planning-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe("semantic planning productive host", () => {
  it("publishes a compiled graph without CandidatePlan or WorkBreakdown events", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });
    const propose = vi.fn(async ({ slot }: { slot: number }) => slot === 0
      ? bookingDraft()
      : bookingDraft(["src/domain/missing.ts"]));

    const state = await runSemanticPlanningV2({
      runId: "semantic-run-1",
      goal: "Implement booking creation",
      acceptanceCriteria: ["A valid booking can be created."],
      constraints: [],
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority,
      protocol: "product"
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      propose,
      now: () => "2026-08-03T12:00:00.000Z"
    });

    expect(state.lifecycle).toBe("needs_approval");
    expect(propose).toHaveBeenCalledTimes(2);
    const persisted = await events.load("semantic-run-1");
    expect(persisted.map((event) => event.type)).toEqual([
      "run.created",
      "repository.inspected",
      "planning.semantic_attempt_started",
      "planning.semantic_proposal_recorded",
      "planning.semantic_proposal_recorded",
      "planning.semantic_terminal_committed",
      "graph.compiled",
      "graph.revision.proposed",
      "decision.raised"
    ]);
    expect(persisted.some((event) => [
      "planning.envelope_created",
      "planning.candidates_evaluated",
      "planning.completed"
    ].includes(event.type))).toBe(false);
    const terminal = persisted.find((event) => event.type === "planning.semantic_terminal_committed");
    expect(terminal?.type === "planning.semantic_terminal_committed"
      ? JSON.parse(terminal.payload.recordJson)
      : undefined).toMatchObject({ kind: "ready", comparison: { status: "degraded" } });
    expect(JSON.stringify(persisted)).not.toContain("CandidatePlan");
    expect(JSON.stringify(persisted)).not.toContain("WorkBreakdown");
  });

  it("leaves a capacity-interrupted attempt resumable instead of terminally failing the run", async () => {
    const events = new JsonlRunEventStore({ directory });
    const snapshots = new RunSnapshotStore({ directory, events });

    await expect(runSemanticPlanningV2({
      runId: "semantic-run-capacity",
      goal: "Implement booking creation",
      acceptanceCriteria: ["A valid booking can be created."],
      constraints: [],
      repoPath: "C:/repo/booking",
      targetFingerprint: "target-1",
      baseCommit: "1".repeat(40),
      authority,
      protocol: "product"
    }, {
      events,
      snapshots,
      inspect: async () => bookingSnapshot(),
      propose: async () => { throw new PlanningCapacityError("provider capacity exhausted"); },
      now: () => "2026-08-03T12:00:00.000Z"
    })).rejects.toThrow(PlanningCapacityError);

    const persisted = await events.load("semantic-run-capacity");
    expect(persisted.map((event) => event.type)).toContain("planning.semantic_attempt_started");
    expect(persisted.map((event) => event.type)).not.toContain("planning.failed");
    expect(persisted.map((event) => event.type)).not.toContain("planning.semantic_terminal_committed");
  });

  it("rejects malformed semantic planning journal payloads at the event boundary", () => {
    const result = RunEventSchema.safeParse({
      eventId: "semantic-attempt:invalid",
      runId: "semantic-run-invalid",
      sequence: 1,
      occurredAt: "2026-08-03T12:00:00.000Z",
      type: "planning.semantic_attempt_started",
      payload: { attemptId: "semantic-attempt:invalid", attempt: {} }
    });

    expect(result.success).toBe(false);
  });
});

function bookingDraft(existingPaths = ["src/domain/booking.ts"]): SemanticPlanDraft {
  return {
    root: {
      kind: "composite",
      handle: "booking",
      title: "Booking",
      objective: "Deliver booking creation.",
      children: [{
        kind: "leaf",
        handle: "booking-domain",
        title: "Booking domain",
        objective: "Implement booking creation in the domain module.",
        surface: { existingPaths, plannedPaths: [] },
        outcomes: [{
          statement: "A valid booking can be created.",
          covers: ["criterion-1"],
          verification: {
            kind: "repository_capability",
            capability: "test",
            references: ["tests/api.test.ts"]
          }
        }]
      }]
    },
    seams: []
  };
}
