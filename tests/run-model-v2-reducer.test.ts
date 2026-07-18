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
  });
});

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
