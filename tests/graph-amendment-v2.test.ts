import { describe, expect, it } from "vitest";
import type { LegacyGraphRevisionV2 } from "@manyhands/task-graph";
import {
  applyApprovedGraphAmendment,
  proposeDiscoveredArtifactRequirement
} from "@manyhands/run-coordinator";

function graph(): LegacyGraphRevisionV2 {
  return {
    schemaVersion: 2,
    graphId: "graph-1",
    revision: 1,
    rootId: "root",
    baseCommit: "base",
    repositorySnapshotId: "snapshot-1",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Root", goal: "Build" },
      producer: { id: "producer", parentId: "root", kind: "leaf", title: "Producer", goal: "Produce data" },
      consumer: { id: "consumer", parentId: "root", kind: "leaf", title: "Consumer", goal: "Use data" }
    },
    artifactRequirements: [], seamBindings: [], conflictConstraints: [], legacyOrderingConstraints: [],
    createdAt: "2026-07-17T12:00:00.000Z"
  };
}

describe("graph amendments V2", () => {
  it("turns a discovered dependency into an evidenced proposal and a new immutable revision", () => {
    const proposal = proposeDiscoveredArtifactRequirement({
      graph: graph(),
      producerNodeId: "producer",
      consumerNodeId: "consumer",
      artifactContract: { id: "artifact-data", revision: "rev-2" },
      requiredFor: "execution",
      evidenceRefs: ["attempt:consumer:stderr", "repo:path:src/data.ts"],
      rationale: "Consumer imports data produced by the sibling."
    });

    expect(proposal.sourceRevision).toBe(1);
    expect(proposal.evidenceRefs).toHaveLength(2);
    const revised = applyApprovedGraphAmendment(graph(), proposal, "2026-07-17T12:01:00.000Z");
    expect(revised.revision).toBe(2);
    expect(revised.artifactRequirements).toEqual([
      expect.objectContaining({ producerNodeId: "producer", consumerNodeId: "consumer", artifactContract: { id: "artifact-data", revision: "rev-2" } })
    ]);
    expect(graph().artifactRequirements).toEqual([]);
  });
});
