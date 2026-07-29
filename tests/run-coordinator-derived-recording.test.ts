import { describe, expect, it } from "vitest";
import {
  RunCoordinator,
  RunEventSchema,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

const at = "2026-07-29T12:00:00.000Z";

describe("RunCoordinator.recordDerived", () => {
  it("re-derives facts after optimistic contention changes the current revision", async () => {
    let events: RunEvent[] = [
      event(1, "created", "run.created", { goal: "Test derived recording" }),
      event(2, "proposed-r1", "graph.revision.proposed", { graphId: "graph", revision: 1 }),
      event(3, "approved-r1", "graph.revision.approved", { graphId: "graph", revision: 1 })
    ];
    let injectContention = true;
    const coordinator = new RunCoordinator({
      events: {
        load: async () => structuredClone(events),
        append: async (runId, expectedSequence, inputs) => {
          if (injectContention) {
            injectContention = false;
            events.push(event(
              expectedSequence + 1,
              "proposed-r2",
              "graph.revision.proposed",
              { graphId: "graph", revision: 2 }
            ));
            throw new Error("optimistic contention");
          }
          expect(expectedSequence).toBe(events.length);
          const appended = inputs.map((input, index) => RunEventSchema.parse({
            ...input,
            runId,
            sequence: expectedSequence + index + 1
          }));
          events.push(...appended);
          return appended;
        }
      },
      delivery: { publish: async () => { throw new Error("unused"); } },
      clock: () => at,
      eventId: (type, sequence) => `${type}:${sequence}`
    });
    const derivedFrom: number[] = [];

    const state = await coordinator.recordDerived("run-derived", (current) => {
      derivedFrom.push(current.graphRevision!);
      return [{
        eventId: "derived-readiness",
        occurredAt: at,
        type: "readiness.observed",
        payload: {
          readyNodeIds: [`node-r${current.graphRevision}`],
          pendingDecisionIds: []
        }
      }];
    });

    expect(derivedFrom).toEqual([1, 2]);
    expect(state.graphRevision).toBe(2);
    expect(state.readiness.readyNodeIds).toEqual(["node-r2"]);
  });
});

function event(
  sequence: number,
  eventId: string,
  type: RunEventInput["type"],
  payload: RunEventInput["payload"]
): RunEvent {
  return RunEventSchema.parse({
    eventId,
    runId: "run-derived",
    sequence,
    occurredAt: at,
    type,
    payload
  });
}
