import type { ValidationObligation } from "@manyhands/contracts";
import type { TestIntegrityFinding } from "./test-integrity";

export type CriterionEvidenceStatus = "satisfied" | "failed" | "uncovered" | "flaky" | "not_applicable";

export interface ValidationEvidenceObservation {
  evidenceId: string;
  obligationId: string;
  criterionId?: string;
  kind: ValidationObligation["acceptableEvidence"][number];
  passed: boolean;
  attempt: number;
  commandDigest?: string;
  durationMs?: number;
  references?: string[];
  output?: string;
  negativeControl?: NegativeControlEvidence;
  baselineDisposition?: "not_run" | "baseline_passed" | "preexisting_failure" | "regression";
}

export interface NegativeControlEvidence {
  evidenceId: string;
  obligationId: string;
  detectedFailure: boolean;
  outputDigest: string;
}

export interface CriterionEvidence {
  criterionId: string;
  obligationId: string;
  status: CriterionEvidenceStatus;
  justification: string;
  evidenceRefs: string[];
}

export interface EvidenceMatrix {
  criteria: CriterionEvidence[];
  outcome: "verified" | "unverified" | "failed";
  observations: CriterionAwareObservation[];
  integrityFindings: TestIntegrityFinding[];
  negativeControls: NegativeControlEvidence[];
}

export interface CriterionAwareObservation {
  evidenceId: string;
  kind: ValidationObligation["acceptableEvidence"][number];
  commandDigest: string;
  durationMs: number;
  criterionIds: string[];
  obligationIds: string[];
  references: string[];
}

export function buildEvidenceMatrix(input: {
  obligations: ValidationObligation[];
  evidence: ValidationEvidenceObservation[];
  notApplicableObligationIds?: string[];
  integrityFindings?: TestIntegrityFinding[];
}): EvidenceMatrix {
  const notApplicable = new Set(input.notApplicableObligationIds ?? []);
  const integrityFindings = input.integrityFindings ?? [];
  const criteria = input.obligations.map((obligation): CriterionEvidence => {
    if (notApplicable.has(obligation.id)) return result(obligation, "not_applicable", "Obligation explicitly does not apply to this candidate.", []);
    const evidence = input.evidence
      .filter((item) =>
        item.obligationId === obligation.id
        && obligation.acceptableEvidence.includes(item.kind)
        && isRelevantEvidence(obligation, item)
      )
      .sort((left, right) => left.attempt - right.attempt);
    if (evidence.length === 0) return result(obligation, "uncovered", "No acceptable evidence is linked to this obligation.", []);
    const refs = evidence.flatMap((item) => [item.evidenceId, ...(item.negativeControl === undefined ? [] : [item.negativeControl.evidenceId])]);
    if (obligation.acceptableEvidence.includes("test_result")) refs.push(...integrityFindings.map((finding) => finding.findingId));
    const final = evidence.at(-1)!;
    if (obligation.baselinePolicy === "required" && (final.baselineDisposition === undefined || final.baselineDisposition === "not_run")) return result(obligation, "uncovered", "Required baseline evidence was not executed or linked.", refs);
    if (!final.passed) return result(obligation, "failed", final.baselineDisposition === "preexisting_failure" ? "Validation fails, but the same failure exists in the baseline." : "Linked validation evidence failed.", refs);
    if (obligation.negativeControl === "required" && final.negativeControl?.detectedFailure !== true) return result(obligation, "failed", "Required negative control did not demonstrate test sensitivity.", refs);
    if (obligation.negativeControl === "when_feasible" && final.negativeControl?.detectedFailure === false) return result(obligation, "failed", "Feasible negative control did not demonstrate test sensitivity.", refs);
    if (evidence.some((item) => !item.passed)) return result(obligation, "flaky", "Validation passed only after a prior failed attempt.", refs);
    return result(obligation, "satisfied", "Acceptable linked evidence passed on the exact candidate.", refs);
  });
  const required = input.obligations.map((obligation, index) => ({ obligation, criterion: criteria[index]! })).filter(({ obligation }) => obligation.severity === "required");
  const integrityFailed = integrityFindings.length > 0;
  const hardFailure = required.some(({ obligation, criterion }) => criterion.status === "failed" || (criterion.status === "flaky" && obligation.flakyPolicy === "forbid"));
  const uncovered = required.some(({ criterion }) => criterion.status === "uncovered");
  return {
    criteria,
    outcome: hardFailure || integrityFailed ? "failed" : uncovered ? "unverified" : "verified",
    observations: criterionAwareObservations(input.evidence),
    integrityFindings: integrityFindings.map((finding) => ({ ...finding })),
    negativeControls: input.evidence.flatMap((item) => item.negativeControl === undefined ? [] : [{ ...item.negativeControl }])
  };
}

function isRelevantEvidence(obligation: ValidationObligation, evidence: ValidationEvidenceObservation): boolean {
  const binding = obligation.evidence;
  if (binding === undefined) return false;
  if (evidence.criterionId !== obligation.criterionId || evidence.commandDigest === undefined || evidence.durationMs === undefined) return false;
  if (binding.kind === "shared_command" && !binding.criterionIds.includes(obligation.criterionId)) return false;
  const observedReferences = new Set(evidence.references ?? []);
  return binding.references.every((reference) => observedReferences.has(reference));
}

function criterionAwareObservations(evidence: readonly ValidationEvidenceObservation[]): CriterionAwareObservation[] {
  const observations = new Map<string, CriterionAwareObservation>();
  for (const item of evidence) {
    if (item.commandDigest === undefined || item.durationMs === undefined) continue;
    const key = `${item.evidenceId}:${item.commandDigest}`;
    const current = observations.get(key) ?? {
      evidenceId: item.evidenceId,
      kind: item.kind,
      commandDigest: item.commandDigest,
      durationMs: item.durationMs,
      criterionIds: [],
      obligationIds: [],
      references: []
    };
    if (item.criterionId !== undefined && !current.criterionIds.includes(item.criterionId)) current.criterionIds.push(item.criterionId);
    if (!current.obligationIds.includes(item.obligationId)) current.obligationIds.push(item.obligationId);
    for (const reference of item.references ?? []) if (!current.references.includes(reference)) current.references.push(reference);
    observations.set(key, current);
  }
  return [...observations.values()];
}

function result(obligation: ValidationObligation, status: CriterionEvidenceStatus, justification: string, evidenceRefs: string[]): CriterionEvidence {
  return { criterionId: obligation.criterionId, obligationId: obligation.id, status, justification, evidenceRefs };
}
