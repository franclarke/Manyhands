import { z } from "zod";
import { ContractReferenceSchema } from "./contract-identity.js";

/**
 * RelationType canonical enum (ADR-001 / MH-REM-005).
 */
export const RELATION_TYPES = [
  "parentId",
  "ArtifactRequirement",
  "SeamBinding",
  "ConflictConstraint"
] as const;

export type RelationType = (typeof RELATION_TYPES)[number];

export const ParentRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("parentId"),
    parentId: z.string().min(1),
    childId: z.string().min(1)
  })
  .strict();

export type ParentRelation = z.infer<typeof ParentRelationSchema>;

export const ArtifactRequirementRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("ArtifactRequirement"),
    producerNodeId: z.string().min(1),
    consumerNodeId: z.string().min(1),
    requiredFor: z.enum(["execution", "validation", "integration"]),
    artifactContract: ContractReferenceSchema
  })
  .strict();

export type ArtifactRequirementRelation = z.infer<typeof ArtifactRequirementRelationSchema>;

export const SeamBindingRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("SeamBinding"),
    producerNodeId: z.string().min(1),
    consumerNodeId: z.string().min(1),
    seamContract: ContractReferenceSchema,
    producerRevision: z.string().min(1),
    consumerRevision: z.string().min(1)
  })
  .strict();

export type SeamBindingRelation = z.infer<typeof SeamBindingRelationSchema>;

export const ConflictConstraintRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("ConflictConstraint"),
    leftNodeId: z.string().min(1),
    rightNodeId: z.string().min(1),
    reason: z.string().min(1),
    risk: z.enum(["low", "medium", "high"])
  })
  .strict();

export type ConflictConstraintRelation = z.infer<typeof ConflictConstraintRelationSchema>;

export const CanonicalRelationSchema = z.discriminatedUnion("type", [
  ParentRelationSchema,
  ArtifactRequirementRelationSchema,
  SeamBindingRelationSchema,
  ConflictConstraintRelationSchema
]);

export type CanonicalRelation = z.infer<typeof CanonicalRelationSchema>;

export function validateRelationEndpoints(
  relation: CanonicalRelation,
  existingNodeIds: ReadonlySet<string>
): { valid: boolean; missingNodeIds: string[] } {
  const missing: string[] = [];
  const check = (id: string) => {
    if (!existingNodeIds.has(id)) missing.push(id);
  };

  switch (relation.type) {
    case "parentId":
      check(relation.parentId);
      check(relation.childId);
      break;
    case "ArtifactRequirement":
    case "SeamBinding":
      check(relation.producerNodeId);
      check(relation.consumerNodeId);
      break;
    case "ConflictConstraint":
      check(relation.leftNodeId);
      check(relation.rightNodeId);
      break;
  }

  return { valid: missing.length === 0, missingNodeIds: missing };
}
