import { describe, expect, it } from "vitest";
import {
  RunCoordinator,
  RunExecutionCoordinator,
  decisionBlocksNode,
  type DecisionInput,
  type RunEvent,
  type RunEventInput
} from "@manyhands/run-coordinator";

const decision: DecisionInput = {
  id: "decision-a",
  kind: "clarify_goal",
  question: "Which behavior should A use?",
  options: [{ id: "one", label: "One" }, { id: "two", label: "Two" }],
  affectedNodeIds: ["node-a"],
  evidenceRefs: ["contract:a"],
  impact: "behavior"
};

function setup() {
  const at = "2026-07-17T12:00:00.000Z";
  let events: RunEvent[] = [
    { eventId: "created", runId: "run-1", sequence: 1, occurredAt: at, type: "run.created", payload: { goal: "build" } },
    { eventId: "proposed", runId: "run-1", sequence: 2, occurredAt: at, type: "graph.revision.proposed", payload: { graphId: "graph-1", revision: 1 } },
    { eventId: "approved", runId: "run-1", sequence: 3, occurredAt: at, type: "graph.revision.approved", payload: { graphId: "graph-1", revision: 1 } }
  ];
  const coordinator = new RunCoordinator({
    events: {
      load: async () => events,
      append: async (runId, expectedSequence, inputs: RunEventInput[]) => {
        const appended = inputs.map((input, index) => ({ ...input, runId, sequence: expectedSequence + index + 1 })) as RunEvent[];
        events = [...events, ...appended];
        return appended;
      }
    },
    delivery: { publish: async () => { throw new Error("unused"); } },
    clock: () => at,
    eventId: (type, sequence) => `${type}-${sequence}`
  });
  return { coordinator, events: () => events };
}

describe("local decision readiness", () => {
  it("blocks only affected nodes and keeps independent work running", async () => {
    const test = setup();
    await test.coordinator.execute("run-1", { type: "raise_decision", decision });
    const dispatched: string[] = [];
    const execution = new RunExecutionCoordinator({
      coordinator: test.coordinator,
      observeReadiness: async (_runId, state) => ({
        readyNodeIds: ["node-a", "node-b"].filter((nodeId) => !Object.values(state.decisions).some((item) => decisionBlocksNode(item, nodeId))),
        pendingDecisionIds: ["decision-a"]
      }),
      selectWave: ({ readyNodeIds }) => readyNodeIds,
      waveId: () => "wave-independent",
      dispatch: async ({ nodeId }) => { dispatched.push(nodeId); }
    });

    const state = await execution.advance("run-1", { maxParallel: 2 });

    expect(dispatched).toEqual(["node-b"]);
    expect(state.lifecycle).toBe("running");
  });

  it("waits globally only when every remaining node is decision-blocked", async () => {
    const test = setup();
    await test.coordinator.execute("run-1", { type: "raise_decision", decision });
    const execution = new RunExecutionCoordinator({
      coordinator: test.coordinator,
      observeReadiness: async () => ({ readyNodeIds: [], pendingDecisionIds: ["decision-a"] }),
      selectWave: () => [],
      waveId: () => "unused",
      dispatch: async () => { throw new Error("must not dispatch"); }
    });

    expect((await execution.advance("run-1", { maxParallel: 2 })).lifecycle).toBe("waiting_for_input");
  });

  it("resolves a decision, recomputes readiness from facts and dispatches the released node", async () => {
    const test = setup();
    await test.coordinator.execute("run-1", { type: "raise_decision", decision });
    let dispatched = false;
    const execution = new RunExecutionCoordinator({
      coordinator: test.coordinator,
      observeReadiness: async (_runId, state) => ({
        readyNodeIds: state.decisions["decision-a"]?.status === "resolved" ? ["node-a"] : [],
        pendingDecisionIds: state.decisions["decision-a"]?.status === "pending" ? ["decision-a"] : []
      }),
      selectWave: ({ readyNodeIds }) => readyNodeIds,
      waveId: () => "wave-released",
      dispatch: async () => { dispatched = true; }
    });

    const state = await execution.resolveDecisionAndAdvance("run-1", { decisionId: "decision-a", optionId: "one" }, { maxParallel: 1 });

    expect(dispatched).toBe(true);
    expect(state.lifecycle).toBe("running");
    expect(test.events().map((event) => event.type)).toContain("decision.resolved");
  });
});
