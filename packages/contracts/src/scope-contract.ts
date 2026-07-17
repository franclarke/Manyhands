import { EntityIdSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  ContractIdentityShape,
  RepoRelativePathSchema,
  addDuplicateIssues
} from "./contract-identity.js";

export const ScopeContractSchema = z.object({
  ...ContractIdentityShape,
  nodeId: EntityIdSchema,
  allowedPaths: z.array(RepoRelativePathSchema).min(1),
  forbiddenPaths: z.array(RepoRelativePathSchema).default([]),
  coordinationPaths: z.array(RepoRelativePathSchema).default([])
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(contract.allowedPaths, context, "allowedPaths");
  addDuplicateIssues(contract.forbiddenPaths, context, "forbiddenPaths");
  addDuplicateIssues(contract.coordinationPaths, context, "coordinationPaths");
});

export type ScopeContract = z.infer<typeof ScopeContractSchema>;
