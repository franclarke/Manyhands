import { EntityIdSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  ContractIdentityShape,
  ContractReferenceSchema,
  addDuplicateIssues
} from "./contract-identity.js";

export const TaskAcceptanceCriterionKindSchema = z.enum([
  "static",
  "unit",
  "integration",
  "e2e",
  "security",
  "accessibility",
  "manual",
  "custom"
]);

export const TaskAcceptanceCriterionSchema = z.object({
  id: EntityIdSchema,
  kind: TaskAcceptanceCriterionKindSchema,
  description: NonEmptyStringSchema,
  required: z.boolean()
}).strict();

export type TaskAcceptanceCriterion = z.infer<typeof TaskAcceptanceCriterionSchema>;

export const TaskContractSchema = z.object({
  ...ContractIdentityShape,
  nodeId: EntityIdSchema,
  goal: NonEmptyStringSchema,
  acceptanceCriteria: z.array(TaskAcceptanceCriterionSchema).min(1),
  scope: ContractReferenceSchema,
  consumes: z.array(ContractReferenceSchema).default([]),
  produces: z.array(ContractReferenceSchema).default([]),
  seams: z.array(ContractReferenceSchema).default([]),
  validation: ContractReferenceSchema,
  constraints: z.array(NonEmptyStringSchema).default([])
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(contract.acceptanceCriteria.map((criterion) => criterion.id), context, "acceptanceCriteria");
  addDuplicateIssues(contract.consumes.map((reference) => reference.id), context, "consumes");
  addDuplicateIssues(contract.produces.map((reference) => reference.id), context, "produces");
  addDuplicateIssues(contract.seams.map((reference) => reference.id), context, "seams");
});

export type TaskContract = z.infer<typeof TaskContractSchema>;
