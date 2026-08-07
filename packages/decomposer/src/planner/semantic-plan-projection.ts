import { createHash } from "node:crypto";
import type { CandidatePlan } from "./candidate-plan.js";
import { WorkBreakdownSchema, type WorkBreakdown, type WorkUnit } from "./schema.js";
import { flattenSemanticWorkUnits, type SemanticPlan, type SemanticWorkUnit } from "./semantic-plan.js";

/**
 * Temporary compiler projection. The productive route persists and exchanges
 * only SemanticPlan; legacy compiler structures are reconstructed here from
 * that one source until their historical compiler path is removed.
 */
export function projectSemanticPlanForLegacyCompiler(plan: SemanticPlan): { breakdown: WorkBreakdown; candidatePlan: CandidatePlan } {
  const evidenceById = new Map(plan.repositoryEvidence.map((item) => [item.id, item]));
  const units = flattenSemanticWorkUnits(plan.root);
  const ownerByCriterion = new Map<string, SemanticWorkUnit>();
  for (const unit of units) for (const outcome of unit.outcomes) for (const criterionId of outcome.criterionIds) ownerByCriterion.set(criterionId, unit);
  const breakdown = WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: plan.planId,
    objective: plan.goal,
    repositorySnapshotId: plan.repositorySnapshotId,
    acceptanceIntents: plan.criteria.map((criterion) => ({ id: criterion.id, description: criterion.description, required: criterion.required })),
    root: projectUnit(plan.root),
    candidateArtifacts: plan.seams
      .filter((seam) => seam.interface.materialization !== "logical")
      .map((seam) => ({
        id: `${seam.id}-artifact`,
        artifactType: seam.interface.kind,
        producerUnitKey: seam.producerUnitKey,
        consumerUnitKeys: seam.consumerUnitKeys,
        purpose: seam.purpose,
        materializationHint: seam.interface.materialization,
        evidenceIds: seam.evidenceIds
      })),
    candidateSeams: plan.seams.map((seam) => ({
      id: seam.id,
      kind: seam.interface.kind,
      specification: seam.interface.promise,
      producerUnitKey: seam.producerUnitKey,
      consumerUnitKeys: seam.consumerUnitKeys,
      evidenceIds: seam.evidenceIds
    })),
    repositoryEvidence: plan.repositoryEvidence,
    uncertainties: plan.uncertainties,
    questions: plan.questions
  });
  const scopes = units.map((unit) => ({
    unitKey: unit.key,
    paths: unit.evidenceIds
      .map((evidenceId) => evidenceById.get(evidenceId))
      .filter((evidence): evidence is NonNullable<typeof evidence> => evidence?.kind === "path")
      .map((evidence) => evidence.reference)
      .concat(unit.plannedPaths ?? [])
  })).filter((scope) => scope.paths.length > 0);
  const acceptanceOwnership = plan.criteria.map((criterion) => {
    const owner = ownerByCriterion.get(criterion.id);
    if (owner === undefined) throw new Error(`Criterion ${criterion.id} has no semantic owner.`);
    return {
      intentId: criterion.id,
      ownerUnitKey: owner.key,
      role: owner.kind === "leaf" ? "local" as const : "global" as const,
      rationale: "Derived from the unique semantic outcome that covers this criterion."
    };
  });
  const acceptanceCriteria = plan.criteria.map((criterion) => {
    const owner = ownerByCriterion.get(criterion.id)!;
    return {
      intentId: criterion.id,
      kind: owner.kind === "leaf" ? "leafAcceptance" as const : "globalAcceptance" as const,
      description: criterion.description
    };
  });
  const seamSpecifications = plan.seams.map((seam) => ({
    seamId: seam.id,
    producerUnitKey: seam.producerUnitKey,
    consumerUnitKeys: seam.consumerUnitKeys,
    compatibility: seam.interface.compatibility,
    materialization: seam.interface.materialization,
    validation: seam.interface.verification.references.join(", ")
  }));
  const contractObligations = plan.seams.map((seam) => ({
    obligationId: `${seam.id}-contract`,
    kind: seam.interface.materialization === "logical" ? "cross_layer_contract" as const : "artifact_requirement" as const,
    ownerUnitKey: seam.producerUnitKey,
    producerUnitKey: seam.producerUnitKey,
    consumerUnitKeys: seam.consumerUnitKeys,
    validation: seam.interface.verification.references.join(", ")
  }));
  const leafValidations = units.filter((unit) => unit.kind === "leaf").map((unit) => ({
    unitKey: unit.key,
    command: unit.outcomes.map((outcome) => outcome.verification.references.join(" ")).join(" && "),
    evidenceRefs: [...new Set(unit.outcomes.flatMap((outcome) => outcome.verification.references))]
  }));
  const candidateContent = {
    candidateId: plan.planId,
    repositorySnapshotId: plan.repositorySnapshotId,
    goalDigest: `sha256:${createHash("sha256").update(plan.goal).digest("hex")}`,
    breakdown,
    scopes,
    acceptanceCriteria,
    acceptanceOwnership,
    seamSpecifications,
    contractObligations,
    leafValidations
  };
  return {
    breakdown,
    candidatePlan: {
      ...candidateContent,
      candidateHash: `sha256:${createHash("sha256").update(JSON.stringify(candidateContent)).digest("hex")}`
    }
  };
}

function projectUnit(unit: SemanticWorkUnit): WorkUnit {
  const shared = {
    key: unit.key,
    title: unit.title,
    objective: unit.objective,
    concerns: unit.concerns,
    expectedOutcomes: unit.outcomes.map((outcome) => outcome.description),
    acceptanceIntentIds: unit.outcomes.flatMap((outcome) => outcome.criterionIds),
    evidenceIds: unit.evidenceIds,
    ...(unit.plannedPaths === undefined ? {} : { plannedPaths: unit.plannedPaths }),
    ...(unit.complexitySignals === undefined ? {} : { complexitySignals: unit.complexitySignals })
  };
  return unit.kind === "leaf"
    ? { ...shared, kind: "leaf" }
    : { ...shared, kind: "composite", cut: unit.cut, children: unit.children.map(projectUnit) };
}
