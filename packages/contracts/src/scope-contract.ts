import { EntityIdSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  ContractIdentityShape,
  RepoRelativePathSchema,
  addDuplicateIssues
} from "./contract-identity.js";

/**
 * A directory under which the node may CREATE files it did not pre-declare.
 *
 * Bounded by construction: a root must name at least one real directory
 * segment, so it can never widen to the repository root, and it carries no
 * glob — a root is a subtree, not a pattern. Creation is the only authority a
 * root grants; modifying a pre-existing file still requires `allowedPaths`, and
 * `forbiddenPaths` overrides a root unconditionally.
 */
export const OutputRootSchema = RepoRelativePathSchema.superRefine((value, context) => {
  const candidate = value.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  if (candidate === "" || candidate === ".") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "an output root must name a directory below the repository root"
    });
  }
  if (candidate.includes("*")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "an output root is a directory, not a glob"
    });
  }
});

export const ScopeContractSchema = z.object({
  ...ContractIdentityShape,
  nodeId: EntityIdSchema,
  allowedPaths: z.array(RepoRelativePathSchema).min(1),
  forbiddenPaths: z.array(RepoRelativePathSchema).default([]),
  coordinationPaths: z.array(RepoRelativePathSchema).default([]),
  outputRoots: z.array(OutputRootSchema).default([])
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(contract.allowedPaths, context, "allowedPaths");
  addDuplicateIssues(contract.forbiddenPaths, context, "forbiddenPaths");
  addDuplicateIssues(contract.coordinationPaths, context, "coordinationPaths");
  addDuplicateIssues(contract.outputRoots, context, "outputRoots");
});

export type ScopeContract = z.infer<typeof ScopeContractSchema>;
