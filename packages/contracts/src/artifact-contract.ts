import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  ContractIdentityShape,
  RepoRelativePathSchema,
  addDuplicateIssues
} from "./contract-identity.js";

export const ArtifactMaterializationSchema = z.enum(["commit", "patch", "files", "manifest", "logical"]);

export const ArtifactContractSchema = z.object({
  ...ContractIdentityShape,
  producerNodeId: EntityIdSchema,
  consumerNodeIds: z.array(EntityIdSchema).default([]),
  artifactType: NonEmptyStringSchema,
  mediaType: NonEmptyStringSchema.optional(),
  materialization: ArtifactMaterializationSchema,
  expectedPaths: z.array(RepoRelativePathSchema).default([])
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(contract.consumerNodeIds, context, "consumerNodeIds");
  addDuplicateIssues(contract.expectedPaths, context, "expectedPaths");
  if (contract.consumerNodeIds.includes(contract.producerNodeId)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["consumerNodeIds"],
      message: "producerNodeId cannot consume its own artifact contract"
    });
  }
  if (contract.materialization === "files" && contract.expectedPaths.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["expectedPaths"],
      message: "files materialization requires at least one expected path"
    });
  }
});

export type ArtifactContract = z.infer<typeof ArtifactContractSchema>;
