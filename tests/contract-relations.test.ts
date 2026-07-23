import { describe, it, expect } from "vitest";
import {
  ParentRelationSchema,
  ArtifactRequirementRelationSchema,
  SeamBindingRelationSchema,
  ConflictConstraintRelationSchema,
  CanonicalRelationSchema,
  validateRelationEndpoints
} from "../packages/contracts/src/relations.js";

describe("Contract Relations (MH-REM-005)", () => {
  it("validates valid ParentRelation", () => {
    const rel = { id: "1", type: "parentId", parentId: "p", childId: "c" };
    expect(() => ParentRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects invalid ParentRelation", () => {
    const rel = { id: "1", type: "parentId", parentId: "" };
    expect(() => ParentRelationSchema.parse(rel)).toThrow();
  });

  it("validates valid ArtifactRequirementRelation", () => {
    const rel = {
      id: "2", type: "ArtifactRequirement", producerNodeId: "p", consumerNodeId: "c", requiredFor: "execution",
      artifactContract: { id: "art", revision: "1" }
    };
    expect(() => ArtifactRequirementRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects ArtifactRequirementRelation without requiredFor", () => {
    const rel = { id: "2", type: "ArtifactRequirement", producerNodeId: "p", consumerNodeId: "c", artifactContract: { id: "art", revision: "1" } };
    expect(() => ArtifactRequirementRelationSchema.parse(rel)).toThrow();
  });

  it("validates valid SeamBindingRelation", () => {
    const rel = {
      id: "3", type: "SeamBinding", producerNodeId: "p", consumerNodeId: "c", seamContract: { id: "art", revision: "v1" },
      producerRevision: "v1", consumerRevision: "v1"
    };
    expect(() => SeamBindingRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects invalid SeamBindingRelation", () => {
    const rel = { id: "3", type: "SeamBinding" };
    expect(() => SeamBindingRelationSchema.parse(rel)).toThrow();
  });

  it("validates valid ConflictConstraintRelation", () => {
    const rel = { id: "4", type: "ConflictConstraint", leftNodeId: "l", rightNodeId: "r", reason: "res", risk: "high" };
    expect(() => ConflictConstraintRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects invalid ConflictConstraintRelation", () => {
    const rel = { id: "4", type: "ConflictConstraint", leftNodeId: "l", rightNodeId: "r", reason: "res", risk: "unknown" };
    expect(() => ConflictConstraintRelationSchema.parse(rel)).toThrow();
  });

  it("validates CanonicalRelation polymorphism", () => {
    const rel = { id: "1", type: "parentId", parentId: "p", childId: "c" };
    expect(CanonicalRelationSchema.parse(rel).type).toBe("parentId");
  });

  it("validateRelationEndpoints checks existing nodes", () => {
    const rel = { id: "1", type: "parentId", parentId: "p", childId: "c" } as const;
    const res = validateRelationEndpoints(rel, new Set(["p", "c"]));
    expect(res.valid).toBe(true);
    expect(res.missingNodeIds).toEqual([]);
    
    const res2 = validateRelationEndpoints(rel, new Set(["p"]));
    expect(res2.valid).toBe(false);
    expect(res2.missingNodeIds).toEqual(["c"]);
  });
});
