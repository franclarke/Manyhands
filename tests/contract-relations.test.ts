import { describe, it, expect } from "vitest";
import {
  LegacyParentRelationSchema,
  LegacyArtifactRequirementRelationSchema,
  LegacySeamBindingRelationSchema,
  LegacyConflictConstraintRelationSchema,
  LegacyRelationSchema,
  validateLegacyRelationEndpoints
} from "../packages/contracts/src/relations.js";

describe("Contract Relations (MH-REM-005)", () => {
  it("validates valid ParentRelation", () => {
    const rel = { id: "1", type: "parentId", parentId: "p", childId: "c" };
    expect(() => LegacyParentRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects invalid ParentRelation", () => {
    const rel = { id: "1", type: "parentId", parentId: "" };
    expect(() => LegacyParentRelationSchema.parse(rel)).toThrow();
  });

  it("validates valid ArtifactRequirementRelation", () => {
    const rel = {
      id: "2", type: "ArtifactRequirement", producerNodeId: "p", consumerNodeId: "c", requiredFor: "execution",
      artifactContract: { id: "art", revision: "1" }
    };
    expect(() => LegacyArtifactRequirementRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects ArtifactRequirementRelation without requiredFor", () => {
    const rel = { id: "2", type: "ArtifactRequirement", producerNodeId: "p", consumerNodeId: "c", artifactContract: { id: "art", revision: "1" } };
    expect(() => LegacyArtifactRequirementRelationSchema.parse(rel)).toThrow();
  });

  it("validates valid SeamBindingRelation", () => {
    const rel = {
      id: "3", type: "SeamBinding", producerNodeId: "p", consumerNodeId: "c", seamContract: { id: "art", revision: "v1" },
      producerRevision: "v1", consumerRevision: "v1"
    };
    expect(() => LegacySeamBindingRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects invalid SeamBindingRelation", () => {
    const rel = { id: "3", type: "SeamBinding" };
    expect(() => LegacySeamBindingRelationSchema.parse(rel)).toThrow();
  });

  it("validates valid ConflictConstraintRelation", () => {
    const rel = { id: "4", type: "ConflictConstraint", leftNodeId: "l", rightNodeId: "r", reason: "res", risk: "high" };
    expect(() => LegacyConflictConstraintRelationSchema.parse(rel)).not.toThrow();
  });

  it("rejects invalid ConflictConstraintRelation", () => {
    const rel = { id: "4", type: "ConflictConstraint", leftNodeId: "l", rightNodeId: "r", reason: "res", risk: "unknown" };
    expect(() => LegacyConflictConstraintRelationSchema.parse(rel)).toThrow();
  });

  it("validates legacy relation polymorphism", () => {
    const rel = { id: "1", type: "parentId", parentId: "p", childId: "c" };
    expect(LegacyRelationSchema.parse(rel).type).toBe("parentId");
  });

  it("validateLegacyRelationEndpoints checks existing nodes", () => {
    const rel = { id: "1", type: "parentId", parentId: "p", childId: "c" } as const;
    const res = validateLegacyRelationEndpoints(rel, new Set(["p", "c"]));
    expect(res.valid).toBe(true);
    expect(res.missingNodeIds).toEqual([]);
    
    const res2 = validateLegacyRelationEndpoints(rel, new Set(["p"]));
    expect(res2.valid).toBe(false);
    expect(res2.missingNodeIds).toEqual(["c"]);
  });
});
