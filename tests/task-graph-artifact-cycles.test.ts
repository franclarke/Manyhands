import { describe, it, expect } from "vitest";
import { validateGraphRevision } from "../packages/task-graph/src/validate-v2.js";
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
      "n1": { id: "n1", parentId: "root", kind: "composite", title: "N1", goal: "n1" },
      "n2": { id: "n2", parentId: "n1", kind: "leaf", title: "N2", goal: "n2" }
    },
    artifactRequirements: [],
    seamBindings: [],
    conflictConstraints: [],
    legacyOrderingConstraints: [],
    createdAt: "2026-01-01T00:00:00Z"
  };
}

describe("Task Graph Artifact Cycles (MH-REM-001)", () => {
  it("passes validation for correct graph", () => {
    const graph = getBaseGraph();
    const issues = validateGraphRevision(graph);
    expect(issues.filter(i => i.severity === "error")).toHaveLength(0);
  });

  it("detects basic hierarchy cycle", () => {
    const graph = getBaseGraph();
    graph.nodes["n1"]!.parentId = "n2";
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "hierarchy_cycle", nodeId: "n1" }));
  });

  it("detects self relation on parentId", () => {
    const graph = getBaseGraph();
    graph.nodes["n1"]!.parentId = "n1";
    const issues = validateGraphRevision(graph);
    expect(issues.some(i => i.code === "self_relation" || i.code === "hierarchy_cycle")).toBe(true);
  });

  it("detects basic artifact cycle", () => {
    const graph = getBaseGraph();
    graph.nodes["n3"] = { id: "n3", parentId: "root", kind: "leaf", title: "N3", goal: "n3" };
    graph.artifactRequirements = [
      { id: "r1", producerNodeId: "n2", consumerNodeId: "n3", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } },
      { id: "r2", producerNodeId: "n3", consumerNodeId: "n2", requiredFor: "execution", artifactContract: { id: "b", revision: "1" } }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "artifact_cycle" }));
  });

  it("detects basic legacy cycle", () => {
    const graph = getBaseGraph();
    graph.nodes["n3"] = { id: "n3", parentId: "root", kind: "leaf", title: "N3", goal: "n3" };
    graph.legacyOrderingConstraints = [
      { id: "r1", fromNodeId: "n2", toNodeId: "n3", reason: "test", deprecated: true, requiresReplan: true },
      { id: "r2", fromNodeId: "n3", toNodeId: "n2", reason: "test", deprecated: true, requiresReplan: true }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "artifact_cycle" }));
  });

  it("detects mixed hierarchy and artifact cycle", () => {
    const graph = getBaseGraph();
    graph.artifactRequirements = [
      { id: "r1", producerNodeId: "n2", consumerNodeId: "n1", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "artifact_cycle" }));
  });

  it("detects mixed hierarchy and legacy cycle", () => {
    const graph = getBaseGraph();
    graph.legacyOrderingConstraints = [
      { id: "l1", fromNodeId: "n2", toNodeId: "n1", reason: "test", deprecated: true, requiresReplan: true }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "artifact_cycle" }));
  });

  it("detects self relation on artifact", () => {
    const graph = getBaseGraph();
    graph.artifactRequirements = [
      { id: "r1", producerNodeId: "n2", consumerNodeId: "n2", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues.some(i => i.code === "schema_invalid" || i.code === "self_relation")).toBe(true);
  });

  /**
   * Wide-graph N=16 is why this exists. The planner emitted an artifact
   * `projection-registry -> study-wide-graph-script` and a seam
   * `study-wide-graph-script -> projection-registry`: one relation had its
   * direction inverted, so the two together claim each node depends on the
   * other. Validation only walked artifact and legacy edges, so the graph
   * compiled, nineteen agents ran for roughly forty minutes, and the run died
   * in integration. A seam carries a producer and a consumer exactly as an
   * artifact does; leaving it out of the walk makes half the declared
   * dependencies invisible to the only check that can catch a contradiction.
   */
  it("detects a cycle closed by a seam binding against an artifact", () => {
    const graph = getBaseGraph();
    graph.nodes["n3"] = { id: "n3", parentId: "root", kind: "leaf", title: "N3", goal: "n3" };
    graph.artifactRequirements = [
      { id: "r1", producerNodeId: "n2", consumerNodeId: "n3", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } }
    ];
    graph.seamBindings = [
      { id: "s1", producerNodeId: "n3", consumerNodeId: "n2", seamContract: { id: "b", revision: "1" }, producerRevision: "1", consumerRevision: "1" }
    ];

    const issues = validateGraphRevision(graph);

    expect(issues).toContainEqual(expect.objectContaining({ code: "artifact_cycle" }));
  });

  it("accepts a seam that runs the same way as the artifact it accompanies", () => {
    const graph = getBaseGraph();
    graph.nodes["n3"] = { id: "n3", parentId: "root", kind: "leaf", title: "N3", goal: "n3" };
    graph.artifactRequirements = [
      { id: "r1", producerNodeId: "n2", consumerNodeId: "n3", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } }
    ];
    graph.seamBindings = [
      { id: "s1", producerNodeId: "n2", consumerNodeId: "n3", seamContract: { id: "b", revision: "1" }, producerRevision: "1", consumerRevision: "1" }
    ];

    const issues = validateGraphRevision(graph);

    expect(issues.filter((issue) => issue.severity === "error")).toHaveLength(0);
  });

  it("detects self relation on seam binding", () => {
    const graph = getBaseGraph();
    graph.seamBindings = [
      { id: "s1", producerNodeId: "n2", consumerNodeId: "n2", seamContract: { id: "a", revision: "1" }, producerRevision: "1", consumerRevision: "1" }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues.some(i => i.code === "schema_invalid" || i.code === "self_relation")).toBe(true);
  });

  it("detects self relation on conflict constraint", () => {
    const graph = getBaseGraph();
    graph.conflictConstraints = [
      { id: "c1", leftNodeId: "n2", rightNodeId: "n2", reason: "r", risk: "low" }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues.some(i => i.code === "schema_invalid" || i.code === "self_relation")).toBe(true);
  });

  it("detects self relation on legacy constraint", () => {
    const graph = getBaseGraph();
    graph.legacyOrderingConstraints = [
      { id: "l1", fromNodeId: "n2", toNodeId: "n2", reason: "test", deprecated: true, requiresReplan: true }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues.some(i => i.code === "schema_invalid" || i.code === "self_relation")).toBe(true);
  });

  it("detects missing relation node", () => {
    const graph = getBaseGraph();
    graph.artifactRequirements = [
      { id: "r1", producerNodeId: "n2", consumerNodeId: "missing", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_relation_node" }));
  });

  it("detects duplicate relation", () => {
    const graph = getBaseGraph();
    graph.artifactRequirements = [
      { id: "dup", producerNodeId: "n2", consumerNodeId: "n1", requiredFor: "execution", artifactContract: { id: "a", revision: "1" } }
    ];
    graph.legacyOrderingConstraints = [
      { id: "dup", fromNodeId: "n1", toNodeId: "n2", reason: "test", deprecated: true, requiresReplan: true }
    ];
    const issues = validateGraphRevision(graph);
    expect(issues).toContainEqual(expect.objectContaining({ code: "duplicate_relation" }));
  });
});
