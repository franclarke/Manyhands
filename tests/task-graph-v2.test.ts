import { describe, expect, it } from "vitest";
import {
  GraphRevisionSchema,
  getExecutableReadinessV2,
  reviseGraph,
  validateGraphRevision,
  type GraphRevision
} from "@manyhands/task-graph";

function graph(): GraphRevision {
  return {
    schemaVersion: 2,
    graphId: "booking-graph",
    revision: 1,
    rootId: "root",
    baseCommit: "1111111111111111111111111111111111111111",
    repositorySnapshotId: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    createdAt: "2026-07-17T00:00:00.000Z",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Booking app", goal: "Build booking app" },
      api: { id: "api", parentId: "root", kind: "leaf", title: "Booking API", goal: "Expose bookings" },
      ui: { id: "ui", parentId: "root", kind: "leaf", title: "Booking UI", goal: "Show bookings" }
    },
    artifactRequirements: [],
    seamBindings: [],
    conflictConstraints: [],
    legacyOrderingConstraints: []
  };
}

describe("GraphRevision V2", () => {
  it("accepts a valid revision without node dependency shortcuts", () => {
    const candidate = graph();
    expect(GraphRevisionSchema.safeParse(candidate).success).toBe(true);
    expect(validateGraphRevision(candidate)).toEqual([]);
    expect(candidate.nodes.ui).not.toHaveProperty("dependencies");
  });

  it.each([
    ["invalid root", (candidate: GraphRevision) => { candidate.rootId = "missing"; }, "missing_root"],
    ["hierarchy cycle", (candidate: GraphRevision) => { candidate.nodes.root!.parentId = "api"; candidate.nodes.api!.parentId = "root"; }, "hierarchy_cycle"],
    ["missing producer", (candidate: GraphRevision) => { candidate.artifactRequirements.push(requirement({ producerNodeId: "missing" })); }, "missing_relation_node"],
    ["missing seam contract", (candidate: GraphRevision) => { candidate.seamBindings.push({ id: "ui-api", producerNodeId: "api", consumerNodeId: "ui", seamContract: { id: "", revision: "r1" }, producerRevision: "r1", consumerRevision: "r1" }); }, "schema_invalid"],
    ["incompatible seam revisions", (candidate: GraphRevision) => { candidate.seamBindings.push({ id: "ui-api", producerNodeId: "api", consumerNodeId: "ui", seamContract: { id: "booking-api", revision: "r2" }, producerRevision: "r1", consumerRevision: "r2" }); }, "schema_invalid"],
    ["leaf owning a child", (candidate: GraphRevision) => { candidate.nodes.ui!.parentId = "api"; }, "invalid_node_kind"],
    ["missing conflict node", (candidate: GraphRevision) => { candidate.conflictConstraints.push({ id: "shared-file", leftNodeId: "api", rightNodeId: "missing", reason: "Both may edit routes", risk: "high" }); }, "missing_relation_node"]
  ])("rejects %s", (_name, mutate, issueCode) => {
    const candidate = graph();
    mutate(candidate);
    expect(validateGraphRevision(candidate)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: issueCode, severity: "error" })])
    );
  });

  it("uses artifact availability for readiness while seams and conflicts remain non-ordering metadata", () => {
    const candidate = graph();
    candidate.artifactRequirements.push(requirement());
    candidate.seamBindings.push({
      id: "booking-api-seam",
      producerNodeId: "api",
      consumerNodeId: "ui",
      seamContract: { id: "booking-api", revision: "r1" },
      producerRevision: "r1",
      consumerRevision: "r1"
    });
    candidate.conflictConstraints.push({
      id: "route-overlap",
      leftNodeId: "api",
      rightNodeId: "ui",
      reason: "Potential shared route file",
      risk: "medium"
    });

    expect(getExecutableReadinessV2(candidate, { availableArtifactContractIds: [] })).toEqual([
      { nodeId: "api", ready: true, missingArtifactContractIds: [] },
      { nodeId: "ui", ready: false, missingArtifactContractIds: ["booking-model"] }
    ]);
    expect(getExecutableReadinessV2(candidate, { availableArtifactContractIds: ["booking-model"] })).toEqual([
      { nodeId: "api", ready: true, missingArtifactContractIds: [] },
      { nodeId: "ui", ready: true, missingArtifactContractIds: [] }
    ]);
  });

  it("creates an immutable next revision for semantic operations", () => {
    const original = graph();
    const revised = reviseGraph(original, {
      expectedRevision: 1,
      createdAt: "2026-07-17T01:00:00.000Z",
      operations: [{ type: "update_node_goal", nodeId: "ui", goal: "Show and filter bookings" }]
    });

    expect(revised.revision).toBe(2);
    expect(revised.createdAt).toBe("2026-07-17T01:00:00.000Z");
    expect(revised.nodes.ui?.goal).toBe("Show and filter bookings");
    expect(original.nodes.ui?.goal).toBe("Show bookings");
    expect(() => reviseGraph(original, { expectedRevision: 2, operations: [] })).toThrow(/revision/i);
  });
});

function requirement(overrides: Partial<GraphRevision["artifactRequirements"][number]> = {}) {
  return {
    id: "ui-needs-model",
    artifactContract: { id: "booking-model", revision: "r1" },
    producerNodeId: "api",
    consumerNodeId: "ui",
    requiredFor: "execution" as const,
    ...overrides
  };
}
