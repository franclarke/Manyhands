import {
  SemanticPlanSchema,
  verifyCanonicalDigest,
  validateProofCoverage,
  type DigestHasher,
  type GoalContract,
  type PlanningFinding,
  type ProofStrategy,
  type SemanticPlan,
  type WorkUnit
} from "@manyhands/contracts";
import type { RepositoryView } from "@manyhands/repository-index";

export interface VerifyPlanInput {
  plan: SemanticPlan;
  goal: GoalContract;
  proofStrategies: readonly ProofStrategy[];
  repositoryView: RepositoryView;
  hasher: DigestHasher;
}

export interface PlanVerificationResult {
  ok: boolean;
  findings: PlanningFinding[];
}

export function verifyPlan(input: VerifyPlanInput): PlanVerificationResult {
  const parsed = SemanticPlanSchema.safeParse(input.plan);
  if (!parsed.success) {
    return result(parsed.error.issues.map((issue) => finding(
      "schema_invalid",
      `${issue.path.join(".")}: ${issue.message}`
    )));
  }
  const plan = parsed.data;
  const findings: PlanningFinding[] = [];
  if (!verifyCanonicalDigest(plan, "digest", input.hasher)) {
    findings.push(finding("plan_digest_mismatch", "SemanticPlan digest does not identify its canonical content."));
  }
  if (
    plan.goalContract.id !== input.goal.id ||
    plan.goalContract.revision !== input.goal.revision ||
    plan.goalContract.digest !== input.goal.digest
  ) {
    findings.push(finding("goal_contract_mismatch", "SemanticPlan is not bound to the supplied GoalContract."));
  }
  if (
    plan.repositoryView.digest !== input.repositoryView.digest ||
    plan.repositoryView.treeSha !== input.repositoryView.treeSha ||
    plan.repositoryView.resourceCatalogDigest !== input.repositoryView.catalog.digest
  ) {
    findings.push(finding("repository_view_mismatch", "SemanticPlan is not bound to the exact RepositoryView."));
  }

  for (const proofFinding of validateProofCoverage(input.goal, input.proofStrategies).issues) {
    findings.push(finding(proofFinding.code, proofFinding.message, proofFinding.criterionId));
  }

  verifyHierarchy(plan, findings);
  verifyCriteria(plan, input.goal, findings);
  verifyUnits(plan, input.proofStrategies, findings);
  verifyArtifacts(plan, findings);
  verifySeams(plan, findings);
  verifyResources(plan, input.goal, input.repositoryView, findings);
  return result(findings);
}

function verifyHierarchy(plan: SemanticPlan, out: PlanningFinding[]): void {
  const root = plan.units[plan.rootUnitId];
  if (root?.parentId !== undefined) out.push(finding("invalid_root", "The root unit must be parentless.", root?.id));
  for (const unit of Object.values(plan.units)) {
    if (unit.id !== plan.rootUnitId && unit.parentId === undefined) {
      out.push(finding("missing_parent", `Unit ${unit.id} has no parent.`, unit.id));
    }
  }
  detectCycle(Object.keys(plan.units), (id) => {
    const parentId = plan.units[id]?.parentId;
    return parentId === undefined ? [] : [parentId];
  }, () => out.push(finding("hierarchy_cycle", "Work-unit hierarchy contains a cycle.")));
}

function verifyCriteria(plan: SemanticPlan, goal: GoalContract, out: PlanningFinding[]): void {
  const root = plan.units[plan.rootUnitId];
  if (root === undefined) return;
  const required = goal.acceptanceCriteria.filter((criterion) => criterion.required).map(({ id }) => id);
  const rootSources = new Set(root.criteria.map(({ sourceCriterionId }) => sourceCriterionId));
  for (const criterionId of required) {
    if (!rootSources.has(criterionId)) {
      out.push(finding("missing_root_criterion", `Required criterion ${criterionId} has no root obligation.`, criterionId));
    }
  }
  const goalIds = new Set(goal.acceptanceCriteria.map(({ id }) => id));
  for (const unit of Object.values(plan.units)) {
    const allowedSources = unit.parentId === undefined
      ? goalIds
      : new Set(plan.units[unit.parentId]?.criteria.map(({ criterionId }) => criterionId) ?? []);
    for (const criterion of unit.criteria) {
      if (!allowedSources.has(criterion.sourceCriterionId)) {
        out.push(finding(
          "unknown_criterion_refinement",
          `Unit ${unit.id} refines unknown criterion ${criterion.sourceCriterionId}.`,
          criterion.criterionId
        ));
      }
    }
  }
}

function verifyUnits(plan: SemanticPlan, strategies: readonly ProofStrategy[], out: PlanningFinding[]): void {
  const strategiesById = new Map(strategies.map((strategy) => [strategy.id, strategy]));
  for (const unit of Object.values(plan.units)) {
    if (unit.expansion === "frontier" || unit.granularity.disposition === "frontier") {
      out.push(finding("ready_plan_frontier", `Ready plan retains frontier ${unit.id}.`, unit.id));
    }
    if (unit.role === "leaf") {
      if (unit.expansion !== "leaf" || unit.granularity.disposition !== "leaf") {
        out.push(finding("infeasible_leaf", `Leaf ${unit.id} does not carry a leaf feasibility decision.`, unit.id));
      }
      if (unit.validation.length === 0) {
        out.push(finding("missing_leaf_validation", `Leaf ${unit.id} has no validation obligation.`, unit.id));
      }
    } else if (unit.integration === undefined) {
      out.push(finding("missing_composite_integration", `Composite ${unit.id} has no integration obligation.`, unit.id));
    }
    for (const uncertainty of unit.uncertainty) {
      if (uncertainty.disposition !== "bounded") {
        out.push(finding("unresolved_uncertainty", uncertainty.statement, unit.id, uncertainty.evidenceRefs));
      }
    }
    for (const obligation of unit.validation) {
      const strategy = strategiesById.get(obligation.proofStrategyId);
      if (strategy === undefined) {
        out.push(finding("missing_proof_strategy", `Validation ${obligation.obligationId} has no ProofStrategy.`, obligation.obligationId));
      } else if (strategy.obligationId !== obligation.obligationId) {
        out.push(finding("proof_obligation_mismatch", `Proof ${strategy.id} is bound to ${strategy.obligationId}, not ${obligation.obligationId}.`, obligation.obligationId));
      } else if (strategy.criterionId !== rootCriterionFor(plan, unit, obligation.criterionId)) {
        out.push(finding("proof_criterion_mismatch", `Proof ${strategy.id} does not cover validation ${obligation.obligationId}.`, obligation.obligationId));
      }
    }
    if (unit.integration !== undefined) {
      if (!unit.validation.some(({ obligationId }) => obligationId === unit.integration?.obligationId)) {
        out.push(finding("missing_integration_validation", `Integration ${unit.integration.obligationId} is not a validation obligation.`, unit.id));
      }
      if (!strategiesById.has(unit.integration.proofStrategyId)) {
        out.push(finding("missing_proof_strategy", `Integration ${unit.integration.obligationId} has no ProofStrategy.`, unit.id));
      } else if (strategiesById.get(unit.integration.proofStrategyId)?.obligationId !== unit.integration.obligationId) {
        out.push(finding("proof_obligation_mismatch", `Integration ${unit.integration.obligationId} uses a ProofStrategy bound to another obligation.`, unit.id));
      }
    }
  }
}

function verifyArtifacts(plan: SemanticPlan, out: PlanningFinding[]): void {
  const edges: Array<readonly [string, string]> = [];
  for (const artifact of Object.values(plan.artifacts)) {
    if (plan.units[artifact.producerUnitId] === undefined) {
      out.push(finding("artifact_missing_producer", `Artifact ${artifact.id} has no producer unit.`, artifact.id));
    }
    if (!plan.units[artifact.producerUnitId]?.produces.includes(artifact.id)) {
      out.push(finding("artifact_producer_mismatch", `Producer ${artifact.producerUnitId} does not declare ${artifact.id}.`, artifact.id));
    }
    for (const consumerId of artifact.consumerUnitIds) {
      if (plan.units[consumerId] === undefined) {
        out.push(finding("artifact_missing_consumer", `Artifact ${artifact.id} references missing consumer ${consumerId}.`, artifact.id));
      } else if (!plan.units[consumerId]!.consumes.includes(artifact.id)) {
        out.push(finding("artifact_consumer_mismatch", `Consumer ${consumerId} does not declare ${artifact.id}.`, artifact.id));
      }
      edges.push([artifact.producerUnitId, consumerId]);
    }
  }
  for (const unit of Object.values(plan.units)) {
    for (const artifactId of [...unit.produces, ...unit.consumes]) {
      if (plan.artifacts[artifactId] === undefined) {
        out.push(finding("artifact_unresolved", `Unit ${unit.id} references missing artifact ${artifactId}.`, unit.id));
      }
    }
  }
  detectCycle(Object.keys(plan.units), (id) => edges.filter(([producer]) => producer === id).map(([, consumer]) => consumer),
    () => out.push(finding("artifact_cycle", "Artifact dataflow contains a cycle.")));
}

function verifySeams(plan: SemanticPlan, out: PlanningFinding[]): void {
  const obligations = new Set(Object.values(plan.units).flatMap((unit) => unit.validation.map(({ obligationId }) => obligationId)));
  for (const seam of Object.values(plan.seams)) {
    if (plan.units[seam.producerUnitId] === undefined) {
      out.push(finding("seam_missing_producer", `Seam ${seam.id} has no producer.`, seam.id));
    }
    if (!plan.units[seam.producerUnitId]?.seamRefs.includes(seam.id)) {
      out.push(finding("seam_producer_mismatch", `Producer ${seam.producerUnitId} does not declare seam ${seam.id}.`, seam.id));
    }
    for (const consumerId of seam.consumerUnitIds) {
      if (plan.units[consumerId] === undefined) out.push(finding("seam_missing_consumer", `Seam ${seam.id} has missing consumer ${consumerId}.`, seam.id));
      else if (!plan.units[consumerId]!.seamRefs.includes(seam.id)) out.push(finding("seam_consumer_mismatch", `Consumer ${consumerId} does not declare seam ${seam.id}.`, seam.id));
    }
    if (Object.keys(seam.semanticFacts).length === 0 || seam.compatibility.rules.length === 0) {
      out.push(finding("seam_semantics_missing", `Seam ${seam.id} lacks observable semantics or compatibility rules.`, seam.id));
    }
    if (plan.artifacts[seam.artifactId] === undefined) {
      out.push(finding("seam_artifact_missing", `Seam ${seam.id} references missing artifact ${seam.artifactId}.`, seam.id));
    }
    for (const obligationId of seam.validationObligationIds) {
      if (!obligations.has(obligationId)) {
        out.push(finding("seam_validation_missing", `Seam ${seam.id} references missing validation ${obligationId}.`, seam.id));
      }
    }
  }
}

function verifyResources(
  plan: SemanticPlan,
  goal: GoalContract,
  view: RepositoryView,
  out: PlanningFinding[]
): void {
  const claims = Object.values(plan.units).flatMap((unit) => unit.resourceIntents.map((intent) => ({ unit, intent })));
  for (const { unit, intent } of claims) {
    const resolved = view.catalog.resolve(intent.resourceId);
    if (resolved.state !== "known") {
      out.push(finding("resource_unresolved", `Resource ${intent.resourceId} is ${resolved.state}.`, unit.id));
      continue;
    }
    if (intent.access === "modify" && resolved.resource.generated.state === "generated") {
      out.push(finding("generated_resource_write", `Unit ${unit.id} writes generated resource ${intent.resourceId}.`, unit.id, resolved.evidenceRefs));
    }
    if (intent.access === "modify" && plan.artifacts[intent.outputArtifactId] === undefined) {
      out.push(finding("resource_output_missing", `Write ${intent.resourceId} has no output artifact.`, unit.id));
    }
    if (intent.inputArtifactId !== undefined && !unit.consumes.includes(intent.inputArtifactId)) {
      out.push(finding("resource_input_unordered", `Resource input ${intent.inputArtifactId} is not consumed by ${unit.id}.`, unit.id));
    }
  }
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < claims.length; rightIndex += 1) {
      const left = claims[leftIndex]!;
      const right = claims[rightIndex]!;
      if (left.intent.access !== "modify" && right.intent.access !== "modify") continue;
      const overlap = view.catalog.overlaps(left.intent.resourceId, right.intent.resourceId);
      if (overlap === "unknown") {
        out.push(finding("resource_overlap_unknown", `Resource overlap for ${left.unit.id} and ${right.unit.id} is unknown.`));
      } else if (
        overlap === "yes" && left.intent.access === "modify" && right.intent.access === "modify" &&
        !orderedByArtifacts(plan, left.unit.id, right.unit.id)
      ) {
        out.push(finding("resource_double_writer", `Writers ${left.unit.id} and ${right.unit.id} are not artifact-ordered.`));
      }
    }
  }
  const protectedPaths = goal.acceptanceCriteria.flatMap(({ protectedReferences }) => protectedReferences)
    .filter((reference) => reference.startsWith("path:"))
    .map((reference) => reference.slice("path:".length));
  for (const { unit, intent } of claims) {
    if (intent.access !== "modify") continue;
    for (const path of unit.repositorySurface.pathHints) {
      if (protectedPaths.some((protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`))) {
        out.push(finding("protected_path_write", `Unit ${unit.id} writes protected path ${path}.`, unit.id));
      }
    }
  }
}

function rootCriterionFor(plan: SemanticPlan, unit: WorkUnit, criterionId: string): string {
  let current: WorkUnit | undefined = unit;
  let currentCriterion = criterionId;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    const refinement = current.criteria.find(({ criterionId: id }) => id === currentCriterion);
    if (refinement === undefined) return currentCriterion;
    currentCriterion = refinement.sourceCriterionId;
    current = current.parentId === undefined ? undefined : plan.units[current.parentId];
  }
  return currentCriterion;
}

function orderedByArtifacts(plan: SemanticPlan, leftId: string, rightId: string): boolean {
  return reachable(plan, leftId, rightId) || reachable(plan, rightId, leftId);
}

function reachable(plan: SemanticPlan, from: string, target: string): boolean {
  const pending = [from];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current === target) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const artifact of Object.values(plan.artifacts)) {
      if (artifact.producerUnitId === current) pending.push(...artifact.consumerUnitIds);
    }
  }
  return false;
}

function detectCycle(ids: readonly string[], edges: (id: string) => readonly string[], onCycle: () => void): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (edges(id).some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  if (ids.some(visit)) onCycle();
}

function result(findings: PlanningFinding[]): PlanVerificationResult {
  const unique = [...new Map(findings.map((item) => [`${item.code}\0${item.subjectId ?? ""}\0${item.message}`, item])).values()]
    .sort((left, right) => `${left.code}\0${left.subjectId ?? ""}\0${left.message}`.localeCompare(`${right.code}\0${right.subjectId ?? ""}\0${right.message}`));
  return { ok: !unique.some(({ severity }) => severity === "error"), findings: unique };
}

function finding(code: string, message: string, subjectId?: string, evidenceRefs: readonly string[] = []): PlanningFinding {
  return {
    code,
    severity: "error",
    authority: "deterministic",
    message,
    ...(subjectId === undefined ? {} : { subjectId }),
    evidenceRefs: [...new Set(evidenceRefs)].sort(),
    resolution: "none"
  };
}
