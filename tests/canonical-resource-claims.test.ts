import { describe, expect, it } from "vitest";
import { buildGraphRevision, validateGraphRevision, type GraphRevisionMaterial } from "@manyhands/task-graph";

const hash = (value: string) => `digest-${value.length}`;
const ref = (id: string) => ({ id, revision: 1, digest: `digest-${id}` });
function material(): GraphRevisionMaterial {
  return {
    graphId: "graph", revision: 1, semanticPlan: ref("plan"),
    repositoryView: { digest: "view", treeSha: "tree", resourceCatalogDigest: "catalog" }, rootId: "root",
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Root", goal: "Integrate", contractRef: ref("root-contract") },
      a: { id: "a", parentId: "root", kind: "leaf", title: "A", goal: "A", contractRef: ref("a-contract") },
      b: { id: "b", parentId: "root", kind: "leaf", title: "B", goal: "B", contractRef: ref("b-contract") }
    }, artifactRequirements: [], seamBindings: [], runtimeLeaseClaims: [],
    contractRefs: [ref("root-contract"), ref("a-contract"), ref("b-contract"), ref("out-a"), ref("out-b")],
    resourceClaims: [
      { id: "wa", nodeId: "a", resourceId: "file:a", source: "planner", evidenceRefs: ["e"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["e"] }, access: "modify", ownerPhase: "implementation", inputVersion: { kind: "repository_view", digest: "view" }, outputArtifact: ref("out-a") },
      { id: "wb", nodeId: "b", resourceId: "file:b", source: "planner", evidenceRefs: ["e"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["e"] }, access: "modify", ownerPhase: "implementation", inputVersion: { kind: "repository_view", digest: "view" }, outputArtifact: ref("out-b") }
    ]
  };
}

describe("canonical resource ownership", () => {
  it("fails closed when unordered writers are not proven disjoint", () => {
    const graph = buildGraphRevision(material(), hash);
    expect(validateGraphRevision(graph, { resourceOverlap: { overlap: () => "unknown" } }).map((f) => f.code)).toContain("resource_overlap_unknown");
    expect(validateGraphRevision(graph, { resourceOverlap: { overlap: () => "no" } })).toEqual([]);
  });

  it("accepts a deliberate writer chain only with the matching artifact input", () => {
    const next = material();
    next.resourceClaims[1] = { ...next.resourceClaims[1]!, inputVersion: { kind: "artifact_contract", ref: ref("out-a") } };
    next.artifactRequirements.push({ id: "a-to-b", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("out-a"), consumerInputName: "base", acceptedManifestKinds: ["change_set"] });
    const valid = buildGraphRevision(next, hash);
    expect(validateGraphRevision(valid, { resourceOverlap: { overlap: () => "yes" } })).toEqual([]);

    const invalidMaterial = material();
    invalidMaterial.resourceClaims[1] = { ...invalidMaterial.resourceClaims[1]!, inputVersion: { kind: "artifact_contract", ref: ref("out-a") } };
    const invalid = buildGraphRevision(invalidMaterial, hash);
    expect(validateGraphRevision(invalid, { resourceOverlap: { overlap: () => "yes" } }).map((f) => f.code)).toContain("invalid_version_chain");
  });

  it("rejects an artifact requirement without a matching producer output claim", () => {
    const input = material();
    input.artifactRequirements.push({ id: "ghost", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("out-b"), consumerInputName: "base", acceptedManifestKinds: ["change_set"] });
    expect(validateGraphRevision(buildGraphRevision(input, hash), { resourceOverlap: { overlap: () => "no" } }).map((f) => f.code)).toContain("artifact_unreachable");
  });

  it("fails closed when overlap between an observer and a writer is unknown", () => {
    const input = material();
    input.resourceClaims[1] = { id: "read-b", nodeId: "b", resourceId: "module:b", source: "planner", evidenceRefs: ["e"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["e"] }, access: "observe", inputVersion: { kind: "repository_view", digest: "view" } };
    expect(validateGraphRevision(buildGraphRevision(input, hash), { resourceOverlap: { overlap: () => "unknown" } }).map((f) => f.code)).toContain("resource_overlap_unknown");
  });
});
