import { describe, expect, it } from "vitest";
import { GraphRevisionMaterialSchema, buildGraphRevision, validateGraphRevision, validateGraphRevisionTransition, type GraphRevisionMaterial } from "@manyhands/task-graph";

const ref = (id: string) => ({ id, revision: 1, digest: `digest-${id}` });
function flow(): GraphRevisionMaterial {
  return {
    graphId: "g", revision: 1, semanticPlan: ref("plan"), repositoryView: { digest: "view", treeSha: "tree", resourceCatalogDigest: "catalog" }, rootId: "root",
    nodes: { root: { id: "root", parentId: null, kind: "root", title: "R", goal: "R", contractRef: ref("root") }, a: { id: "a", parentId: "root", kind: "leaf", title: "A", goal: "A", contractRef: ref("a") }, b: { id: "b", parentId: "root", kind: "leaf", title: "B", goal: "B", contractRef: ref("b") } },
    artifactRequirements: [], seamBindings: [], resourceClaims: [], runtimeLeaseClaims: [], contractRefs: [ref("root"), ref("a"), ref("b"), ref("ab"), ref("ba"), ref("seam"), ref("validate")]
  };
}

describe("canonical graph identity", () => {
  it("normalizes every set-like graph relation before computing identity", () => {
    const input = flow();
    input.artifactRequirements = [
      { id: "requirement-z", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("ab"), consumerInputName: "z", acceptedManifestKinds: ["change_set", "candidate_tree", "change_set"] },
      { id: "requirement-a", producerNodeId: "b", consumerNodeId: "a", artifactContract: ref("ba"), consumerInputName: "a", acceptedManifestKinds: ["change_set"] }
    ];
    input.seamBindings = [
      { id: "seam-z", producerNodeId: "a", consumerNodeId: "b", seamContract: ref("seam"), artifactRequirementId: "requirement-z", validationObligationIds: ["validate-z", "validate-a", "validate-z"] },
      { id: "seam-a", producerNodeId: "b", consumerNodeId: "a", seamContract: ref("seam"), artifactRequirementId: "requirement-a", validationObligationIds: ["validate-z"] }
    ];
    input.resourceClaims = [
      { id: "claim-z", nodeId: "a", resourceId: "ra", source: "planner", evidenceRefs: ["e-z", "e-a", "e-z"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["ep-z", "ep-a", "ep-z"] }, access: "observe", inputVersion: { kind: "repository_view", digest: "view" } },
      { id: "claim-a", nodeId: "b", resourceId: "rb", source: "planner", evidenceRefs: ["e-z"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["ep-z"] }, access: "observe", inputVersion: { kind: "repository_view", digest: "view" } }
    ];
    input.runtimeLeaseClaims = [
      { id: "lease-z", nodeId: "a", provider: "git", resourceKey: "z", mode: "exclusive", phase: "implementation" },
      { id: "lease-a", nodeId: "b", provider: "git", resourceKey: "a", mode: "shared", phase: "validation" }
    ];
    input.contractRefs.reverse();
    input.artifactRequirements.push(structuredClone(input.artifactRequirements[0]!));
    input.seamBindings.push(structuredClone(input.seamBindings[0]!));
    input.resourceClaims.push(structuredClone(input.resourceClaims[0]!));
    input.runtimeLeaseClaims.push(structuredClone(input.runtimeLeaseClaims[0]!));
    input.contractRefs.push(structuredClone(input.contractRefs[0]!));

    const reordered = structuredClone(input);
    reordered.artifactRequirements.reverse();
    reordered.artifactRequirements[1]!.acceptedManifestKinds.reverse();
    reordered.seamBindings.reverse();
    reordered.seamBindings[1]!.validationObligationIds.reverse();
    reordered.resourceClaims.reverse();
    reordered.resourceClaims[1]!.evidenceRefs.reverse();
    reordered.resourceClaims[1]!.epistemic.evidenceRefs.reverse();
    reordered.runtimeLeaseClaims.reverse();
    reordered.contractRefs.reverse();

    const built = buildGraphRevision(input, (canonical) => canonical);
    const rebuilt = buildGraphRevision(reordered, (canonical) => canonical);

    expect(rebuilt).toEqual(built);
    expect(built.artifactRequirements.map(({ id }) => id)).toEqual(["requirement-a", "requirement-z"]);
    expect(built.artifactRequirements[1]!.acceptedManifestKinds).toEqual(["candidate_tree", "change_set"]);
    expect(built.seamBindings[1]!.validationObligationIds).toEqual(["validate-a", "validate-z"]);
    expect(built.resourceClaims[1]!.evidenceRefs).toEqual(["e-a", "e-z"]);
    expect(built.resourceClaims[1]!.epistemic.evidenceRefs).toEqual(["ep-a", "ep-z"]);
    expect(built.runtimeLeaseClaims.map(({ id }) => id)).toEqual(["lease-a", "lease-z"]);
    expect(built.contractRefs).toHaveLength(7);
  });

  it("rejects conflicting relations that reuse one canonical id", () => {
    const input = flow();
    input.artifactRequirements = [
      { id: "requirement", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("ab"), consumerInputName: "first", acceptedManifestKinds: ["change_set"] },
      { id: "requirement", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("ab"), consumerInputName: "second", acceptedManifestKinds: ["change_set"] }
    ];

    expect(() => buildGraphRevision(input, (canonical) => canonical)).toThrow(/conflicting artifactRequirements id requirement/i);
  });

  it("keeps runtime state out of strict task nodes", () => {
    const input = flow();
    input.nodes.a = { ...input.nodes.a!, status: "running" } as never;
    expect(GraphRevisionMaterialSchema.safeParse(input).success).toBe(false);
  });

  it("requires consecutive revisions with changed identity", () => {
    const graph = { graphId: "g", revision: 1, digest: "same" } as unknown as Parameters<typeof validateGraphRevisionTransition>[0];
    const next = { ...graph, revision: 3 } as Parameters<typeof validateGraphRevisionTransition>[1];
    expect(validateGraphRevisionTransition(graph, next).map((f) => f.code)).toEqual(["nonconsecutive_revision", "content_identity_unchanged"]);
  });

  it("reports artifact cycles independently from the valid child-to-composite hierarchy", () => {
    const input = flow();
    input.resourceClaims.push(
      { id: "write-ab", nodeId: "a", resourceId: "ra", source: "planner", evidenceRefs: ["e"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["e"] }, access: "modify", ownerPhase: "implementation", inputVersion: { kind: "repository_view", digest: "view" }, outputArtifact: ref("ab") },
      { id: "write-ba", nodeId: "b", resourceId: "rb", source: "planner", evidenceRefs: ["e"], epistemic: { state: "known", confidence: "high", evidenceRefs: ["e"] }, access: "modify", ownerPhase: "implementation", inputVersion: { kind: "repository_view", digest: "view" }, outputArtifact: ref("ba") }
    );
    input.artifactRequirements.push(
      { id: "ab", producerNodeId: "a", consumerNodeId: "b", artifactContract: ref("ab"), consumerInputName: "a", acceptedManifestKinds: ["change_set"] },
      { id: "ba", producerNodeId: "b", consumerNodeId: "a", artifactContract: ref("ba"), consumerInputName: "b", acceptedManifestKinds: ["change_set"] }
    );
    const codes = validateGraphRevision(buildGraphRevision(input, (s) => `${s.length}`)).map((f) => f.code);
    expect(codes).toContain("artifact_cycle");
    expect(codes).not.toContain("hierarchy_cycle");
  });

  it("requires a seam to bind its artifact and validation obligation", () => {
    const input = flow();
    input.seamBindings.push({ id: "s", producerNodeId: "a", consumerNodeId: "b", seamContract: ref("seam"), artifactRequirementId: "missing", validationObligationIds: ["not-declared"] });
    expect(validateGraphRevision(buildGraphRevision(input, (s) => `${s.length}`)).map((f) => f.code)).toEqual(expect.arrayContaining(["missing_seam_artifact", "missing_seam_obligation"]));
  });
});
