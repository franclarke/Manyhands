import { describe, expect, it } from "vitest";
import { compileGraphRevision } from "@manyhands/decomposer";
import { RunEventSchema, type RunEvent } from "@manyhands/run-coordinator";
import { loadApprovedExecutionPlanV2 } from "@/lib/server/runs/v2/execution-pipeline";
import { bookingBreakdown, bookingSnapshot, compilerDependencies } from "./helpers/target-planning-fixtures";

const at = "2026-07-17T12:00:00.000Z";

describe("loadApprovedExecutionPlanV2", () => {
  it("loads the exact approved graph, contracts and immutable repository snapshot", () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const events = approvedEvents(compiled);

    const loaded = loadApprovedExecutionPlanV2(events);

    expect(loaded.graph).toEqual(compiled.graph);
    expect(loaded.contracts).toEqual(compiled.contracts);
    expect(loaded.repositorySnapshot.snapshotId).toBe(compiled.graph.repositorySnapshotId);
    expect(loaded.state.approvedGraphRevision).toBe(compiled.graph.revision);
  });

  it("refuses a proposed revision that was not approved", () => {
    const compiled = compileGraphRevision({ breakdown: bookingBreakdown(), repositorySnapshot: bookingSnapshot() }, compilerDependencies);
    const events = approvedEvents(compiled);
    events.push(RunEventSchema.parse({
      eventId: "revision-2-proposed",
      runId: "run-v2-host",
      sequence: events.length + 1,
      occurredAt: at,
      type: "graph.revision.proposed",
      payload: { graphId: compiled.graph.graphId, revision: compiled.graph.revision + 1 }
    }));

    expect(() => loadApprovedExecutionPlanV2(events)).toThrow(/exact current graph revision/u);
  });
});

function approvedEvents(compiled: ReturnType<typeof compileGraphRevision>): RunEvent[] {
  const snapshot = bookingSnapshot();
  return [
    event(1, "run.created", { goal: "Build booking" }),
    event(2, "repository.inspected", { snapshotId: snapshot.snapshotId, disposition: snapshot.inspectionDisposition, snapshot: snapshot as unknown as Record<string, unknown> }),
    event(3, "graph.compiled", {
      graphId: compiled.graph.graphId,
      revision: compiled.graph.revision,
      graph: compiled.graph as unknown as Record<string, unknown>,
      contracts: compiled.contracts as unknown as Array<Record<string, unknown>>,
      review: compiled.review as unknown as Record<string, unknown>,
      trace: compiled.trace as unknown as Record<string, unknown>
    }),
    event(4, "graph.revision.proposed", { graphId: compiled.graph.graphId, revision: compiled.graph.revision }),
    event(5, "graph.revision.approved", { graphId: compiled.graph.graphId, revision: compiled.graph.revision })
  ];
}

function event<T extends RunEvent["type"]>(
  sequence: number,
  type: T,
  payload: Extract<RunEvent, { type: T }>["payload"]
): Extract<RunEvent, { type: T }> {
  return RunEventSchema.parse({
    eventId: `${type}:${sequence}`,
    runId: "run-v2-host",
    sequence,
    occurredAt: at,
    type,
    payload
  }) as Extract<RunEvent, { type: T }>;
}
