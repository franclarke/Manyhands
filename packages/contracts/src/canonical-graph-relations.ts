import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import { CanonicalContractRefSchema, CanonicalDigestSchema } from "./canonical-reference.js";
import { EpistemicAssessmentSchema } from "./semantic-plan.js";

export const ArtifactRequirementSchema = z.object({
  id: EntityIdSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeId: EntityIdSchema,
  artifactContract: CanonicalContractRefSchema,
  consumerInputName: NonEmptyStringSchema,
  acceptedManifestKinds: z.array(z.enum(["change_set", "candidate_tree"])).min(1)
}).strict();
export type ArtifactRequirement = z.infer<typeof ArtifactRequirementSchema>;

export const SeamBindingSchema = z.object({
  id: EntityIdSchema,
  producerNodeId: EntityIdSchema,
  consumerNodeId: EntityIdSchema,
  seamContract: CanonicalContractRefSchema,
  artifactRequirementId: EntityIdSchema,
  validationObligationIds: z.array(EntityIdSchema).min(1)
}).strict();
export type SeamBinding = z.infer<typeof SeamBindingSchema>;

export const ResourceVersionRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("repository_view"), digest: CanonicalDigestSchema }).strict(),
  z.object({ kind: z.literal("artifact_contract"), ref: CanonicalContractRefSchema }).strict()
]);
export type ResourceVersionRef = z.infer<typeof ResourceVersionRefSchema>;

const ResourceClaimCommonShape = {
  id: EntityIdSchema,
  nodeId: EntityIdSchema,
  resourceId: EntityIdSchema,
  source: z.enum(["planner", "compiler", "repository_policy"]),
  evidenceRefs: z.array(NonEmptyStringSchema).default([]),
  epistemic: EpistemicAssessmentSchema
};

export const ResourceClaimSchema = z.discriminatedUnion("access", [
  z.object({
    ...ResourceClaimCommonShape,
    access: z.literal("observe"),
    inputVersion: ResourceVersionRefSchema
  }).strict(),
  z.object({
    ...ResourceClaimCommonShape,
    access: z.literal("modify"),
    ownerPhase: z.enum(["implementation", "integration"]),
    inputVersion: ResourceVersionRefSchema,
    outputArtifact: CanonicalContractRefSchema
  }).strict()
]);
export type ResourceClaim = z.infer<typeof ResourceClaimSchema>;

export const RuntimeLeaseClaimSchema = z.object({
  id: EntityIdSchema,
  nodeId: EntityIdSchema,
  provider: NonEmptyStringSchema,
  resourceKey: NonEmptyStringSchema,
  mode: z.enum(["shared", "exclusive"]),
  phase: z.enum(["implementation", "validation", "integration", "delivery"])
}).strict();
export type RuntimeLeaseClaim = z.infer<typeof RuntimeLeaseClaimSchema>;
