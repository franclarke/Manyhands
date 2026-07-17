import { describe, expect, it } from "vitest";
import {
  RunCoordinator,
  RunExecutionCoordinator,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

function approvedEvents(): RunEvent[] {
  const base = { runId: "run-1", occurredAt: "2026-07-17T12:00:00.000Z" };
  return [
    { ...base, eventId: "created", sequence: 1, type: "run.created", payload: { goal: "build" } },
    { ...base, eventId: "proposed", sequence: 2, type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } },
    { ...base, eventId: "approved", sequence: 3, type: "graph.revision.approved", payload: { graphId: "graph-1", revision: 1 } }
  ];
}

function harness() {
  let events = approvedEvents();
  const ordering: string[] = [];
  const coordinator = new RunCoordinator({
    events: {
      load: async () => events,
      append: async (runId: string, expectedSequence: number, inputs: RunEventInput[]) => {
        expect(expectedSequence).toBe(events.length);
        const appended = inputs.map((input, index) => ({ ...input, runId, sequence: expectedSequence + index + 1 })) as RunEvent[];
        events = [...events, ...appended];
        if (appended.some((event) => event.type === "wave.selected")) ordering.push("wave.persisted");
        return appended;
      }
    },
    delivery: { publish: async () => { throw new Error("unused"); } },
    clock: () => "2026-07-17T12:00:00.000Z",
    eventId: (type, sequence) => `${type}-${sequence}`
  });
  return { coordinator, events: () => events, ordering };
}

describe("RunExecutionCoordinator", () => {
  it("persists the selected wave before any executor dispatch", async () => {
    const test = harness();
    const execution = new RunExecutionCoordinator({
      coordinator: test.coordinator,
      observeReadiness: async () => ({ readyNodeIds: ["node-b"], pendingDecisionIds: [] }),
      selectWave: ({ readyNodeIds }) => readyNodeIds,
      waveId: () => "wave-1",
      dispatch: async ({ nodeId }) => test.ordering.push(`dispatch:${nodeId}`)
    });

    const state = await execution.advance("run-1", { maxParallel: 2 });

    expect(test.ordering).toEqual(["wave.persisted", "dispatch:node-b"]);
    expect(state.lifecycle).toBe("running");
    expect(test.events().at(-1)).toMatchObject({ type: "wave.selected", payload: { waveId: "wave-1", nodeIds: ["node-b"], maxParallel: 2 } });
  });
});
