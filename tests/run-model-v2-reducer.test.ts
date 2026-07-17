import { describe, expect, it } from "vitest";
import { adaptCoordinatorEvent } from "@/lib/run-model/sse-adapter";
import { createInitialRunModel, reduceRunEvents, restoreRunModelSnapshot, snapshotRunModel } from "@/lib/run-model/reducer";
import type { RunConfig } from "@/lib/run-model/types";

const config: RunConfig = { aggressiveness: "medium", planningModel: "planner", executionSelection: { executorId: "claude", model: "m" }, repairSelection: { executorId: "claude", model: "m" } };
const initial = () => createInitialRunModel({ id: "run-1", intent: "Build it", workspaceId: "ws", config });

describe("run model V2 replay", () => {
  it("restores the same normalized model as replaying canonical V2 events", () => {
    const events = [
      coordinator(1, "graph.compiled", { graphId: "graph-1", revision: 1, graph: { schemaVersion: 2, graphId: "graph-1", revision: 1, rootId: "root", baseCommit: "base", repositorySnapshotId: "snapshot", nodes: { root: { id: "root", parentId: null, kind: "root", title: "Booking app", goal: "Ship booking" }, ui: { id: "ui", parentId: "root", kind: "leaf", title: "Booking screen", goal: "Build UI" } }, artifactRequirements: [], seamBindings: [], conflictConstraints: [], legacyOrderingConstraints: [], createdAt: "2026-07-17T00:00:00.000Z" }, contracts: [], review: {}, trace: {} }),
      coordinator(2, "graph.revision.proposed", { graphId: "graph-1", revision: 1 }),
      coordinator(3, "graph.revision.approved", { graphId: "graph-1", revision: 1 }),
      coordinator(4, "readiness.observed", { readyNodeIds: ["ui"], pendingDecisionIds: [] })
    ].map(adaptCoordinatorEvent);
    const replayed = reduceRunEvents(initial(), events);
    const restored = restoreRunModelSnapshot(snapshotRunModel(replayed));
    expect(snapshotRunModel(restored)).toEqual(snapshotRunModel(replayed));
    expect(restored.nodes.get("ui")?.depth).toBe(1);
    expect(restored.orchestration.lifecycle).toBe("running");
  });
});

function coordinator(sequence: number, type: string, payload: Record<string, unknown>) {
  return { eventId: `event-${sequence}`, runId: "run-1", sequence, occurredAt: `2026-07-17T00:00:0${sequence}.000Z`, type, payload };
}
