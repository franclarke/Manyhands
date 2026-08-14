import { describe, expect, it } from "vitest";

import { routeRepair } from "@manyhands/run-coordinator";

const graph = {
  rootId: "unit:root",
  nodes: {
    "unit:root": { id: "unit:root", kind: "root" as const },
    "unit:a": { id: "unit:a", kind: "leaf" as const },
    "unit:b": { id: "unit:b", kind: "leaf" as const }
  },
  seamBindings: [
    { id: "seam:a-root", producerNodeId: "unit:a", consumerNodeId: "unit:root", validationObligationIds: ["validation:root"] },
    { id: "seam:b-root", producerNodeId: "unit:b", consumerNodeId: "unit:root", validationObligationIds: ["validation:root"] }
  ]
};

const consumed = [
  { artifactId: "artifact:a", producerNodeId: "unit:a" },
  { artifactId: "artifact:b", producerNodeId: "unit:b" }
];

describe("Stage 9 repair routing", () => {
  it("routes a defect naming one consumed artifact to that artifact's producer", () => {
    expect(routeRepair({
      failedNodeId: "unit:root",
      failureReason: "child_defect: artifact:a does not satisfy seam:a-root.",
      graph,
      consumedArtifacts: consumed
    })).toEqual({ kind: "retry_node", nodeId: "unit:a" });
  });

  it("routes a seam mismatch to the boundary's producer, not the consumer", () => {
    expect(routeRepair({
      failedNodeId: "unit:root",
      failureReason: "seam_mismatch: seam:b-root expects createB(): B.",
      graph,
      consumedArtifacts: consumed
    })).toEqual({ kind: "retry_node", nodeId: "unit:b" });
  });

  it("routes an ownership violation to a plan amendment", () => {
    const route = routeRepair({
      failedNodeId: "unit:root",
      failureReason: "ownership_violation: unit:root wrote resources it does not claim: src/a.ts is owned by unit:a.",
      graph,
      consumedArtifacts: consumed
    });
    expect(route.kind).toBe("amend_plan");
  });

  it("routes an environment cause to effect policy and raises no attempt", () => {
    const route = routeRepair({
      failedNodeId: "unit:a",
      failureReason: "SANDBOX_UNAVAILABLE: Codex native sandbox setup marker is unavailable.",
      graph,
      consumedArtifacts: []
    });
    expect(route.kind).toBe("effect_policy");
  });

  it("amends the plan when a cause indicts more than one child", () => {
    // No single lowest authority exists, so guessing one would move the repair
    // to a node that cannot fix it.
    const route = routeRepair({
      failedNodeId: "unit:root",
      failureReason: "child_defect: artifact:a and artifact:b disagree on the shared contract.",
      graph,
      consumedArtifacts: consumed
    });
    expect(route.kind).toBe("amend_plan");
  });

  it("keeps an unattributable failure on the failed node itself", () => {
    expect(routeRepair({
      failedNodeId: "unit:a",
      failureReason: "validation: focused check failed",
      graph,
      consumedArtifacts: []
    })).toEqual({ kind: "retry_node", nodeId: "unit:a" });
  });

  it("does not route a leaf's own failure to a child it never consumed", () => {
    expect(routeRepair({
      failedNodeId: "unit:b",
      failureReason: "validation: artifact:a is mentioned only in passing",
      graph,
      consumedArtifacts: []
    })).toEqual({ kind: "retry_node", nodeId: "unit:b" });
  });
});
