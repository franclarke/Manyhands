import { describe, expect, it } from "vitest";

import {
  buildGraphRevision,
  validateGraphRevision,
  type GraphRevisionMaterial
} from "@manyhands/task-graph";

/**
 * The rehearsal run of 2026-08-16 planned five units — four metrics and a CLI
 * that composes them — and the compiler rejected the graph with six
 * `resource_double_writer` findings. Every unit creates new files, new files
 * have no resource of their own, so all five write the package that contains
 * them and each pair has to be ordered.
 *
 * The plan verifier agreed the plan was ordered: `resourceVersionReachable`
 * walks the artifact chain, so A → B → C orders A and C. The graph validator
 * then rejected the same property, because `orderedByArtifact` looked only for
 * one direct requirement between exactly those two nodes. Two authorities for
 * one invariant, and the stricter one demands a requirement between every pair
 * of writers — a complete graph, which no sensible plan produces.
 *
 * Transitive is the correct reading, and not a weakening: if B consumes A's
 * artifact and C consumes B's, then C runs after B runs after A, and no two of
 * them ever write concurrently. That is the whole content of the rule.
 */
describe("Writers of one resource", () => {
  it("are ordered by a chain, not only by a direct requirement", () => {
    const codes = validateGraphRevision(buildGraphRevision(chain(), hasher)).map(({ code }) => code);

    expect(codes).not.toContain("resource_double_writer");
  });

  it("are still reported when nothing orders them", () => {
    // The control. Without this the fix above could be "stop checking".
    const material = chain();
    material.artifactRequirements = [];
    for (const claim of material.resourceClaims) {
      if (claim.access === "modify") claim.inputVersion = { kind: "repository_view", digest: "view" };
    }

    const codes = validateGraphRevision(buildGraphRevision(material, hasher)).map(({ code }) => code);

    expect(codes.filter((code) => code === "resource_double_writer")).toHaveLength(3);
  });

  it("are still reported when the chain skips one of them", () => {
    // A and B are ordered, C is off on its own writing the same resource.
    const material = chain();
    material.artifactRequirements = material.artifactRequirements.filter(({ id }) => id !== "b-to-c");
    for (const claim of material.resourceClaims) {
      if (claim.nodeId === "c") claim.inputVersion = { kind: "repository_view", digest: "view" };
    }

    const codes = validateGraphRevision(buildGraphRevision(material, hasher)).map(({ code }) => code);

    expect(codes.filter((code) => code === "resource_double_writer")).toHaveLength(2);
  });
});

/** Three leaves writing one resource, ordered a → b → c by artifacts. */
function chain(): GraphRevisionMaterial {
  return {
    graphId: "g",
    revision: 1,
    semanticPlan: ref("plan"),
    repositoryView: { digest: "view", treeSha: "tree", resourceCatalogDigest: "catalog" },
    rootId: "root",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "R", goal: "R", contractRef: ref("root") },
      a: { id: "a", parentId: "root", kind: "leaf", title: "A", goal: "A", contractRef: ref("a") },
      b: { id: "b", parentId: "root", kind: "leaf", title: "B", goal: "B", contractRef: ref("b") },
      c: { id: "c", parentId: "root", kind: "leaf", title: "C", goal: "C", contractRef: ref("c") }
    },
    artifactRequirements: [
      { id: "a-to-b", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("art-a"), consumerInputName: "a", acceptedManifestKinds: ["change_set"] },
      { id: "b-to-c", producerNodeId: "b", consumerNodeId: "c", artifactContract: ref("art-b"), consumerInputName: "b", acceptedManifestKinds: ["change_set"] }
    ],
    seamBindings: [],
    resourceClaims: [
      writer("write-a", "a", { kind: "repository_view", digest: "view" }, ref("art-a")),
      writer("write-b", "b", { kind: "artifact_contract", ref: ref("art-a") }, ref("art-b")),
      writer("write-c", "c", { kind: "artifact_contract", ref: ref("art-b") }, ref("art-c"))
    ],
    runtimeLeaseClaims: [],
    contractRefs: [ref("root"), ref("a"), ref("b"), ref("c"), ref("art-a"), ref("art-b"), ref("art-c")]
  };
}

function writer(
  id: string,
  nodeId: string,
  inputVersion: GraphRevisionMaterial["resourceClaims"][number]["inputVersion"],
  outputArtifact: ReturnType<typeof ref>
): GraphRevisionMaterial["resourceClaims"][number] {
  return {
    id,
    nodeId,
    // One package, because every unit creates files that do not exist yet.
    resourceId: "resource:package",
    source: "planner",
    evidenceRefs: ["e"],
    epistemic: { state: "known", confidence: "high", evidenceRefs: ["e"] },
    access: "modify",
    ownerPhase: "implementation",
    inputVersion,
    outputArtifact
  };
}

function ref(id: string): { id: string; revision: number; digest: string } {
  return { id, revision: 1, digest: `digest:${id}` };
}

function hasher(value: string): string {
  return `${value.length}`;
}
