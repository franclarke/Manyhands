import { describe, expect, it } from "vitest";

import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import { buildRunModel } from "@/lib/run-model/reducer";
import type { RunSeed } from "@/lib/run-model/types";

const seed: RunSeed = {
  id: "run-1",
  title: "Booking app",
  goal: "Ship booking",
  lifecycle: "planning",
  eventSequence: 0
};

describe("run model V2 replay", () => {
  it("projects planning discoveries before the executable graph is compiled", () => {
    const model = buildRunModel(seed, [
      coordinator(1, "run.created", { goal: "Ship booking" }),
      coordinator(2, "planning.attempt_started", { attempt: 1 }),
      coordinator(3, "planning.node_discovered", {
        attempt: 1,
        node: planningNode("root", null, "composite", "Booking app", 0, 1)
      }),
      coordinator(4, "planning.node_discovered", {
        attempt: 1,
        node: planningNode("ui", "root", "leaf", "Booking screen", 0, 2)
      })
    ].map(adaptCoordinatorEvent));

    expect(model.graphPhase).toBe("provisional");
    expect(model.graph?.rootId).toBe("root");
    expect(model.nodes.map((node) => node.id)).toEqual(["root", "ui"]);
    expect(model.nodes.find((node) => node.id === "ui")?.layout).toEqual({ depth: 1, siblingIndex: 0, siblingCount: 2 });
  });

  it("keeps the last provisional graph visible while a resolved clarification starts an empty replan", () => {
    const events = [
      coordinator(1, "run.created", { goal: "Ship booking" }),
      coordinator(2, "planning.attempt_started", { attempt: 1 }),
      coordinator(3, "planning.node_discovered", {
        attempt: 1,
        node: planningNode("root", null, "composite", "Booking app", 0, 1)
      }),
      coordinator(4, "planning.node_discovered", {
        attempt: 1,
        node: planningNode("ui", "root", "leaf", "Booking screen", 0, 1)
      }),
      coordinator(5, "decision.raised", {
        decision: {
          id: "stack-choice",
          kind: "clarify_goal",
          question: "Which stack?",
          options: [{ id: "vanilla", label: "Vanilla" }, { id: "vite", label: "Vite" }],
          affectedNodeIds: ["root"],
          evidenceRefs: [],
          impact: "architecture"
        }
      }),
      coordinator(6, "decision.resolved", { decisionId: "stack-choice", optionId: "vanilla" }),
      coordinator(7, "planning.attempt_started", { attempt: 2 })
    ];
    const model = buildRunModel(seed, events.map(adaptCoordinatorEvent));

    expect(model.graphPhase).toBe("provisional");
    expect(model.graph?.rootId).toBe("root");
    expect(model.nodes.map((node) => node.id)).toEqual(["root", "ui"]);

    const partialReplan = buildRunModel(seed, [
      ...events,
      coordinator(8, "planning.node_discovered", {
        attempt: 2,
        node: planningNode("new-root", null, "composite", "Revised booking app", 0, 1)
      })
    ].map(adaptCoordinatorEvent));
    expect(partialReplan.nodes.map((node) => node.id)).toEqual(["root", "ui"]);

    const completedReplan = buildRunModel(seed, [
      ...events,
      coordinator(8, "planning.node_discovered", {
        attempt: 2,
        node: planningNode("new-root", null, "composite", "Revised booking app", 0, 1)
      }),
      coordinator(9, "planning.completed", { breakdownId: "revised-booking", breakdown: {} })
    ].map(adaptCoordinatorEvent));
    expect(completedReplan.nodes.map((node) => node.id)).toEqual(["new-root"]);
  });

  it("projects the graph and remains idempotent when SSE replays duplicate event ids", () => {
    const events = [
      coordinator(1, "run.created", { goal: "Ship booking" }),
      coordinator(2, "graph.compiled", {
        graphId: "graph-1",
        revision: 1,
        graph: graph(),
        contracts: [],
        review: {},
        trace: {}
      }),
      coordinator(3, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      coordinator(4, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      coordinator(5, "readiness.observed", { readyNodeIds: ["ui"], pendingDecisionIds: [] })
    ].map(adaptCoordinatorEvent);

    const replayed = buildRunModel(seed, events);
    const duplicated = buildRunModel(seed, [...events, ...events]);

    expect(duplicated).toEqual(replayed);
    expect(replayed.run.lifecycle).toBe("running");
    expect(replayed.run.eventSequence).toBe(5);
    expect(replayed.nodes.find((node) => node.id === "ui")?.status).toBe("ready");
    expect(replayed.graphPhase).toBe("compiled");
  });

  it("marks only the decision's affected node as waiting, even while its attempt is still active", () => {
    const model = buildRunModel(seed, [
      coordinator(1, "run.created", { goal: "Ship booking" }),
      coordinator(2, "graph.compiled", {
        graphId: "graph-1",
        revision: 1,
        graph: graphWithSibling(),
        contracts: [],
        review: {},
        trace: {}
      }),
      coordinator(3, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      coordinator(4, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      coordinator(5, "readiness.observed", { readyNodeIds: ["ui", "api"], pendingDecisionIds: [] }),
      coordinator(6, "attempt.started", {
        attemptId: "attempt-ui",
        nodeId: "ui",
        inputFingerprint: "sha256:ui",
        executorProfile: { id: "codex-cli", revision: "sha256:profile" }
      }),
      coordinator(7, "decision.raised", {
        decision: {
          id: "ui-validation",
          kind: "resolve_conflict",
          question: "The UI validation needs guidance.",
          options: [{ id: "retry", label: "Retry" }, { id: "stop", label: "Stop" }],
          affectedNodeIds: ["ui"],
          evidenceRefs: ["attempt-ui"],
          impact: "behavior"
        }
      })
    ].map(adaptCoordinatorEvent));

    expect(model.nodes.find((node) => node.id === "ui")?.status).toBe("waiting");
    expect(model.nodes.find((node) => node.id === "api")?.status).toBe("ready");
    expect(model.nodes.find((node) => node.id === "root")?.status).toBe("ready");
    expect(model.nodes.filter((node) => node.status === "waiting").map((node) => node.id)).toEqual(["ui"]);
  });
});

function planningNode(id: string, parentNodeId: string | null, kind: "composite" | "leaf", title: string, siblingIndex: number, siblingCount: number) {
  return {
    nodeId: id,
    parentNodeId,
    key: id,
    parentKey: parentNodeId,
    kind,
    title,
    objective: title,
    siblingIndex,
    siblingCount
  };
}

function graph(): Record<string, unknown> {
  return {
    schemaVersion: 2,
    graphId: "graph-1",
    revision: 1,
    rootId: "root",
    baseCommit: "base",
    repositorySnapshotId: "snapshot",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Booking app", goal: "Ship booking" },
      ui: { id: "ui", parentId: "root", kind: "leaf", title: "Booking screen", goal: "Build UI" }
    },
    artifactRequirements: [],
    seamBindings: [],
    conflictConstraints: [],
    legacyOrderingConstraints: [],
    createdAt: "2026-07-17T00:00:00.000Z"
  };
}

function graphWithSibling(): Record<string, unknown> {
  const base = graph();
  return {
    ...base,
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Booking app", goal: "Ship booking" },
      ui: { id: "ui", parentId: "root", kind: "leaf", title: "Booking screen", goal: "Build UI" },
      api: { id: "api", parentId: "root", kind: "leaf", title: "Booking API", goal: "Build API" }
    }
  };
}

function coordinator(sequence: number, type: string, payload: Record<string, unknown>) {
  return {
    eventId: `event-${sequence}`,
    runId: "run-1",
    sequence,
    occurredAt: `2026-07-17T00:00:0${sequence}.000Z`,
    type,
    payload
  };
}
