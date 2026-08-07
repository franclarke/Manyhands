import type { WorkBreakdown } from "./schema.js";

/**
 * The compiler-facing projection of a plan.
 *
 * This used to be one half of a candidate-set protocol: the planner returned
 * several of these, an envelope constrained them, and a policy scored one.
 * Stage 3F of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`
 * retired that protocol — a run has exactly one plan, produced by cutting one
 * unit at a time — so what survives is only the shape the contract compiler
 * reads, reconstructed from the SemanticPlan by
 * `projectSemanticPlanForLegacyCompiler`.
 *
 * These are types, not schemas, on purpose: nothing parses them at a trust
 * boundary any more. The trust boundary is the cut contract, and the compiler
 * receives this structure from code it owns.
 */

export interface AcceptanceOwnership {
  intentId: string;
  ownerUnitKey: string;
  role: "local" | "seam" | "global";
  rationale: string;
}

export interface AcceptanceCriterion {
  intentId: string;
  kind: "leafAcceptance" | "seamAcceptance" | "globalAcceptance";
  description: string;
}

export interface CandidateScope {
  unitKey: string;
  paths: string[];
}

export interface CandidateSeamSpecification {
  seamId: string;
  producerUnitKey: string;
  consumerUnitKeys: string[];
  compatibility: string;
  materialization: "logical" | "files" | "manifest" | "commit";
  validation: string;
}

export interface ContractObligation {
  obligationId: string;
  kind: "cross_layer_contract" | "artifact_requirement" | "validation";
  ownerUnitKey: string;
  producerUnitKey: string;
  consumerUnitKeys: string[];
  validation: string;
}

export interface LeafValidation {
  unitKey: string;
  command: string;
  evidenceRefs: string[];
}

export interface CandidatePlan {
  candidateId: string;
  repositorySnapshotId: string;
  goalDigest: string;
  candidateHash: string;
  breakdown: WorkBreakdown;
  scopes: CandidateScope[];
  acceptanceCriteria: AcceptanceCriterion[];
  acceptanceOwnership: AcceptanceOwnership[];
  seamSpecifications: CandidateSeamSpecification[];
  contractObligations: ContractObligation[];
  leafValidations: LeafValidation[];
}
