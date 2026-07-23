import { describe, it, expect } from "vitest";
import { reduceGraphRevision } from "../packages/task-graph/src/graph-reducer.js";
import { type GraphRevision } from "../packages/task-graph/src/graph-revision.js";

function getBaseGraph(): GraphRevision {
  return {
    schemaVersion: 2,
    graphId: "graph-1",
    revision: 1,
    rootId: "root",
    baseCommit: "1111111111111111111111111111111111111111",
    repositorySnapshotId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    nodes: {
      "root": { id: "root", parentId: null, kind: "root", title: "Root", goal: "root" },
      "n1": { id: "n1", parentId: "root", kind: "leaf", title: "N1", goal: "g1" }
    },
    artifactRequirements: [],
    seamBindings: [],
    conflictConstraints: [],
    legacyOrderingConstraints: [],
    createdAt: "2026-01-01T00:00:00Z"
  };
}

describe("GraphReducer (MH-REM-006)", () => {
  it("rejects stale CAS GraphRevision write", () => {
    const graph = getBaseGraph();
    expect(() => reduceGraphRevision(graph, { expectedRevision: 2, operations: [] })).toThrow(/Stale CAS/);
  });

  it("returns unchanged on empty operations", () => {
    const graph = getBaseGraph();
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [] });
    expect(res.nextRevision.revision).toBe(1);
  });

  it("handles upsert_node", () => {
    const graph = getBaseGraph();
    const res = reduceGraphRevision(graph, {
      expectedRevision: 1,
      operations: [{ type: "upsert_node", node: { id: "n2", parentId: "root", kind: "leaf", title: "n2", goal: "g" } }]
    });
    expect(res.nextRevision.nodes["n2"]).toBeDefined();
    expect(res.nextRevision.revision).toBe(2);
  });

  it("handles remove_node", () => {
    const graph = getBaseGraph();
    graph.nodes["n2"] = { id: "n2", parentId: "root", kind: "leaf", title: "n2", goal: "g" };
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "remove_node", nodeId: "n2" }] });
    expect(res.nextRevision.nodes["n2"]).toBeUndefined();
  });

  it("handles update_node_goal", () => {
    const graph = getBaseGraph();
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "update_node_goal", nodeId: "root", goal: "new_goal" }] });
    expect(res.nextRevision.nodes["root"].goal).toBe("new_goal");
  });

  it("handles add_artifact_requirement", () => {
    const graph = getBaseGraph();
    const req = {
      id: "r1",
      producerNodeId: "root",
      consumerNodeId: "n1",
      requiredFor: "execution",
      artifactContract: { id: "art", revision: "1" }
    } as const;
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "add_artifact_requirement", requirement: req }] });
    expect(res.nextRevision.artifactRequirements.length).toBe(1);
  });

  it("handles remove_artifact_requirement", () => {
    const graph = getBaseGraph();
    graph.artifactRequirements = [{
      id: "r1",
      producerNodeId: "root",
      consumerNodeId: "n1",
      requiredFor: "execution",
      artifactContract: { id: "art", revision: "1" }
    }];
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "remove_artifact_requirement", requirementId: "r1" }] });
    expect(res.nextRevision.artifactRequirements.length).toBe(0);
  });

  it("handles add_seam_binding", () => {
    const graph = getBaseGraph();
    const binding = {
      id: "b1",
      producerNodeId: "root",
      consumerNodeId: "n1",
      seamContract: { id: "c", revision: "1" },
      producerRevision: "1",
      consumerRevision: "1"
    } as const;
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "add_seam_binding", binding }] });
    expect(res.nextRevision.seamBindings.length).toBe(1);
  });

  it("handles remove_seam_binding", () => {
    const graph = getBaseGraph();
    graph.seamBindings = [{
      id: "b1",
      producerNodeId: "root",
      consumerNodeId: "n1",
      seamContract: { id: "c", revision: "1" },
      producerRevision: "1",
      consumerRevision: "1"
    }];
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "remove_seam_binding", bindingId: "b1" }] });
    expect(res.nextRevision.seamBindings.length).toBe(0);
  });

  it("handles add_conflict_constraint and remove_conflict_constraint", () => {
    const graph = getBaseGraph();
    const con = { id: "c1", leftNodeId: "root", rightNodeId: "n1", reason: "r", risk: "low" } as const;
    const res = reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "add_conflict_constraint", constraint: con }] });
    expect(res.nextRevision.conflictConstraints.length).toBe(1);

    const res2 = reduceGraphRevision(res.nextRevision, { expectedRevision: 2, operations: [{ type: "remove_conflict_constraint", constraintId: "c1" }] });
    expect(res2.nextRevision.conflictConstraints.length).toBe(0);
  });

  it("throws when graph becomes invalid (e.g. invalid root operation)", () => {
    const graph = getBaseGraph();
    expect(() => reduceGraphRevision(graph, { expectedRevision: 1, operations: [{ type: "remove_node", nodeId: "root" }] })).toThrow(/GraphRevision reduction produced invalid graph/);
  });
});
