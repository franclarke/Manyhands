import { z } from "zod";
import { ContractReferenceSchema } from "./contract-identity.js";

/** Historical relation vocabulary retained only for persistence compatibility. */
export const LEGACY_RELATION_TYPES = [
  "parentId",
  "ArtifactRequirement",
  "SeamBinding",
  "ConflictConstraint"
] as const;

export type LegacyRelationType = (typeof LEGACY_RELATION_TYPES)[number];

export const LegacyParentRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("parentId"),
    parentId: z.string().min(1),
    childId: z.string().min(1)
  })
  .strict();

export type LegacyParentRelation = z.infer<typeof LegacyParentRelationSchema>;

export const LegacyArtifactRequirementRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("ArtifactRequirement"),
    producerNodeId: z.string().min(1),
    consumerNodeId: z.string().min(1),
    requiredFor: z.enum(["execution", "validation", "integration"]),
    artifactContract: ContractReferenceSchema
  })
  .strict();

export type LegacyArtifactRequirementRelation = z.infer<typeof LegacyArtifactRequirementRelationSchema>;

export const LegacySeamBindingRelationSchema = z
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

export type LegacySeamBindingRelation = z.infer<typeof LegacySeamBindingRelationSchema>;

export const LegacyConflictConstraintRelationSchema = z
  .object({
    id: z.string().min(1),
    type: z.literal("ConflictConstraint"),
    leftNodeId: z.string().min(1),
    rightNodeId: z.string().min(1),
    reason: z.string().min(1),
    risk: z.enum(["low", "medium", "high"])
  })
  .strict();

export type LegacyConflictConstraintRelation = z.infer<typeof LegacyConflictConstraintRelationSchema>;

export const LegacyRelationSchema = z.discriminatedUnion("type", [
  LegacyParentRelationSchema,
  LegacyArtifactRequirementRelationSchema,
  LegacySeamBindingRelationSchema,
  LegacyConflictConstraintRelationSchema
]);

export type LegacyRelation = z.infer<typeof LegacyRelationSchema>;

export function validateLegacyRelationEndpoints(
  relation: LegacyRelation,
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
