import { z } from "zod";
import { ArtifactContractSchema } from "./artifact-contract.js";
import { ScopeContractSchema } from "./scope-contract.js";
import { SeamContractSchema } from "./seam-contract.js";
import { TaskContractSchema } from "./task-contract.js";
import { ValidationContractSchema } from "./validation-contract.js";

export const TaskContractBundleSchema = z.object({
  schemaVersion: z.literal(2),
  task: TaskContractSchema,
  scope: ScopeContractSchema,
  seams: z.array(SeamContractSchema).default([]),
  artifacts: z.array(ArtifactContractSchema).default([]),
  validation: ValidationContractSchema
}).strict().superRefine((bundle, context) => {
  if (bundle.scope.nodeId !== bundle.task.nodeId) {
    issue(context, ["scope", "nodeId"], "scope must belong to the task node");
  }
  if (bundle.validation.nodeId !== bundle.task.nodeId) {
    issue(context, ["validation", "nodeId"], "validation must belong to the task node");
  }
  requireReference(context, ["task", "scope"], bundle.task.scope, bundle.scope, "scope");
  requireReference(context, ["task", "validation"], bundle.task.validation, bundle.validation, "validation");

  const artifacts = new Map(bundle.artifacts.map((contract) => [contract.id, contract]));
  for (const [field, references] of [
    ["consumes", bundle.task.consumes],
    ["produces", bundle.task.produces]
  ] as const) {
    for (const [index, reference] of references.entries()) {
      const artifact = artifacts.get(reference.id);
      requireReference(context, ["task", field, index], reference, artifact, "artifact");
      if (artifact === undefined) continue;
      if (field === "produces" && artifact.producerNodeId !== bundle.task.nodeId) {
        issue(context, ["task", field, index], "produced artifact must name the task as producer");
      }
      if (field === "consumes" && !artifact.consumerNodeIds.includes(bundle.task.nodeId)) {
        issue(context, ["task", field, index], "consumed artifact must name the task as consumer");
      }
    }
  }

  const seams = new Map(bundle.seams.map((contract) => [contract.id, contract]));
  for (const [index, reference] of bundle.task.seams.entries()) {
    const seam = seams.get(reference.id);
    requireReference(context, ["task", "seams", index], reference, seam, "seam");
    if (
      seam !== undefined &&
      seam.producerNodeId !== bundle.task.nodeId &&
      !seam.consumerNodeIds.includes(bundle.task.nodeId)
    ) {
      issue(context, ["task", "seams", index], "task must participate in every referenced seam");
    }
  }

  const criterionIds = new Set(bundle.task.acceptanceCriteria.map((criterion) => criterion.id));
  const coveredCriteria = new Set<string>();
  for (const [index, obligation] of bundle.validation.obligations.entries()) {
    if (!criterionIds.has(obligation.criterionId)) {
      issue(context, ["validation", "obligations", index, "criterionId"], "validation obligation references an unknown criterion");
    }
    coveredCriteria.add(obligation.criterionId);
  }
  for (const [index, criterion] of bundle.task.acceptanceCriteria.entries()) {
    if (criterion.required && !coveredCriteria.has(criterion.id)) {
      issue(context, ["task", "acceptanceCriteria", index], "required criterion has no validation obligation");
    }
  }
});

export type TaskContractBundle = z.infer<typeof TaskContractBundleSchema>;

function requireReference(
  context: z.RefinementCtx,
  path: Array<string | number>,
  reference: { id: string; revision: string },
  contract: { id: string; revision: string } | undefined,
  kind: string
): void {
  if (contract === undefined) {
    issue(context, path, `${kind} reference does not resolve`);
  } else if (contract.id !== reference.id) {
    issue(context, path, `${kind} reference id does not match`);
  } else if (contract.revision !== reference.revision) {
    issue(context, path, `${kind} reference revision does not match`);
  }
}

function issue(context: z.RefinementCtx, path: Array<string | number>, message: string): void {
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });
}
