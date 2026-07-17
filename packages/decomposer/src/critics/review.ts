import { TaskContractBundleSchema, type TaskContractBundle } from "@manyhands/contracts";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import { validateGraphRevision, type GraphRevision } from "@manyhands/task-graph";
import type { WorkBreakdown, WorkUnit } from "../planner/schema.js";

export const PLAN_CRITIC_KINDS = [
  "completeness",
  "atomicity",
  "contract_compatibility",
  "dag_validity",
  "scope_isolation",
  "artifact_coverage",
  "risk_uncertainty",
  "validation_coverage"
] as const;

export type PlanCriticKind = typeof PLAN_CRITIC_KINDS[number];

export interface PlanFinding {
  critic: PlanCriticKind;
  severity: "error" | "warning";
  code: string;
  message: string;
  repair: string;
  evidenceIds: string[];
  nodeId?: string;
  contractId?: string;
}

export interface PlanReview {
  checkedCritics: PlanCriticKind[];
  findings: PlanFinding[];
  approvable: boolean;
}

export interface CompiledPlanReviewInput {
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
  graph: GraphRevision;
  contracts: TaskContractBundle[];
}

export function reviewCompiledPlan(input: CompiledPlanReviewInput): PlanReview {
  const findings: PlanFinding[] = [];
  reviewCompleteness(input, findings);
  reviewAtomicity(input, findings);
  reviewContractCompatibility(input, findings);
  reviewDag(input, findings);
  reviewScopes(input, findings);
  reviewArtifacts(input, findings);
  reviewRisk(input, findings);
  reviewValidation(input, findings);
  return {
    checkedCritics: [...PLAN_CRITIC_KINDS],
    findings,
    approvable: findings.every((finding) => finding.severity !== "error")
  };
}

export function assertPlanReview(review: PlanReview): void {
  const errors = review.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    throw new Error(`Compiled plan review failed: ${errors.map((finding) => `${finding.code}: ${finding.message}`).join("; ")}`);
  }
}

function reviewCompleteness(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  const leafIntentIds = new Set(flattenUnits(input.breakdown.root).filter((unit) => unit.kind === "leaf").flatMap((unit) => unit.acceptanceIntentIds));
  for (const intent of input.breakdown.acceptanceIntents) {
    if (intent.required && !leafIntentIds.has(intent.id)) findings.push(finding("completeness", "error", "unowned_acceptance", `Required acceptance intent ${intent.id} has no leaf owner.`, "Assign the intent to a cohesive leaf.", [intent.id]));
  }
  const expectedLeafCount = flattenUnits(input.breakdown.root).filter((unit) => unit.kind === "leaf").length;
  if (input.contracts.length !== expectedLeafCount) findings.push(finding("completeness", "error", "missing_task_contract", `Expected ${expectedLeafCount} leaf contract bundles, found ${input.contracts.length}.`, "Compile one contract bundle for every leaf.", []));
}

function reviewAtomicity(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  for (const unit of flattenUnits(input.breakdown.root)) {
    if (unit.kind === "leaf" && (unit.expectedOutcomes.length === 0 || unit.concerns.length === 0)) findings.push(finding("atomicity", "error", "ambiguous_leaf", `Leaf ${unit.key} has no cohesive concern or observable outcome.`, "Refine or split the leaf around a verifiable outcome.", unit.evidenceIds));
  }
}

function reviewContractCompatibility(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  for (const bundle of input.contracts) {
    const parsed = TaskContractBundleSchema.safeParse(bundle);
    if (!parsed.success) findings.push(finding("contract_compatibility", "error", "invalid_contract_bundle", `Contract bundle for ${bundle.task.nodeId} is invalid: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`, "Regenerate the bundle from a single set of versioned contracts.", [], bundle.task.nodeId, bundle.task.id));
  }
  for (const binding of input.graph.seamBindings) {
    const participants = input.contracts.filter((bundle) => bundle.task.nodeId === binding.producerNodeId || bundle.task.nodeId === binding.consumerNodeId);
    if (participants.length !== 2 || participants.some((bundle) => !bundle.seams.some((seam) => seam.id === binding.seamContract.id && seam.revision === binding.seamContract.revision))) findings.push(finding("contract_compatibility", "error", "unresolved_seam_binding", `Seam binding ${binding.id} does not resolve to the same contract revision for both participants.`, "Compile and bind one shared seam revision.", [], undefined, binding.seamContract.id));
  }
}

function reviewDag(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  for (const issue of validateGraphRevision(input.graph)) findings.push(finding("dag_validity", issue.severity, issue.code, issue.message, "Repair the typed graph relation or hierarchy before approval.", [], issue.nodeId));
}

function reviewScopes(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  const indexedPaths = new Set(input.repositorySnapshot.index?.files.map((file) => file.path) ?? []);
  for (const bundle of input.contracts) {
    for (const path of bundle.scope.allowedPaths) if (!indexedPaths.has(path)) findings.push(finding("scope_isolation", "error", "scope_path_not_grounded", `Scope path ${path} for ${bundle.task.nodeId} is absent from the repository snapshot.`, "Ground the scope in repository evidence or request a fresh snapshot.", [], bundle.task.nodeId, bundle.scope.id));
  }
  for (let leftIndex = 0; leftIndex < input.contracts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < input.contracts.length; rightIndex += 1) {
      const left = input.contracts[leftIndex]!;
      const right = input.contracts[rightIndex]!;
      const overlap = left.scope.allowedPaths.filter((path) => right.scope.allowedPaths.includes(path));
      if (overlap.length === 0) continue;
      const constrained = input.graph.conflictConstraints.some((constraint) => new Set([constraint.leftNodeId, constraint.rightNodeId]).size === 2 && [constraint.leftNodeId, constraint.rightNodeId].includes(left.task.nodeId) && [constraint.leftNodeId, constraint.rightNodeId].includes(right.task.nodeId));
      if (!constrained) findings.push(finding("scope_isolation", "error", "unmodeled_scope_overlap", `${left.task.nodeId} and ${right.task.nodeId} overlap on ${overlap.join(", ")} without a conflict constraint.`, "Add a scheduling conflict constraint or redraw scopes.", [], left.task.nodeId));
    }
  }
}

function reviewArtifacts(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  for (const bundle of input.contracts) {
    for (const artifact of bundle.artifacts.filter((candidate) => candidate.producerNodeId === bundle.task.nodeId)) {
      if (artifact.consumerNodeIds.length === 0) findings.push(finding("artifact_coverage", "error", "orphan_output", `Artifact ${artifact.id} has no consumer or declared final purpose.`, "Declare a consumer or model it as a final root artifact.", [], bundle.task.nodeId, artifact.id));
      for (const consumerId of artifact.consumerNodeIds) {
        const consumer = input.contracts.find((candidate) => candidate.task.nodeId === consumerId);
        if (consumer === undefined || !consumer.task.consumes.some((reference) => reference.id === artifact.id)) findings.push(finding("artifact_coverage", "error", "artifact_consumer_missing", `Artifact ${artifact.id} names ${consumerId} but that task does not consume it.`, "Compile matching producer and consumer artifact references.", [], consumerId, artifact.id));
      }
    }
  }
}

function reviewRisk(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  for (const question of input.breakdown.questions) findings.push(finding("risk_uncertainty", "error", "unresolved_human_question", `Consequential question ${question.id} is unresolved: ${question.question}`, "Resolve the question and create a new WorkBreakdown revision.", question.evidenceIds));
  for (const uncertainty of input.breakdown.uncertainties) findings.push(finding("risk_uncertainty", uncertainty.requiresHumanDecision ? "error" : "warning", "unresolved_uncertainty", uncertainty.description, uncertainty.requiresHumanDecision ? "Obtain the required human decision." : "Expose the uncertainty and mitigation to approval.", uncertainty.evidenceIds));
}

function reviewValidation(input: CompiledPlanReviewInput, findings: PlanFinding[]): void {
  for (const bundle of input.contracts) {
    const covered = new Set(bundle.validation.obligations.map((obligation) => obligation.criterionId));
    for (const criterion of bundle.task.acceptanceCriteria) if (criterion.required && !covered.has(criterion.id)) findings.push(finding("validation_coverage", "error", "criterion_without_obligation", `Required criterion ${criterion.id} for ${bundle.task.nodeId} has no validation obligation.`, "Compile an evidence obligation without inventing an exact command.", [], bundle.task.nodeId, bundle.validation.id));
  }
}

function finding(critic: PlanCriticKind, severity: "error" | "warning", code: string, message: string, repair: string, evidenceIds: string[], nodeId?: string, contractId?: string): PlanFinding {
  return { critic, severity, code, message, repair, evidenceIds, ...(nodeId !== undefined ? { nodeId } : {}), ...(contractId !== undefined ? { contractId } : {}) };
}

function flattenUnits(root: WorkUnit): WorkUnit[] {
  return root.kind === "leaf" ? [root] : [root, ...root.children.flatMap(flattenUnits)];
}
