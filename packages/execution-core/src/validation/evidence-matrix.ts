import type { ValidationObligation } from "@manyhands/contracts";

export type CriterionEvidenceStatus = "satisfied" | "failed" | "uncovered" | "flaky" | "not_applicable";

export interface ValidationEvidenceObservation {
  evidenceId: string;
  obligationId: string;
  kind: ValidationObligation["acceptableEvidence"][number];
  passed: boolean;
  attempt: number;
  output?: string;
  negativeControlPassed?: boolean;
  baselineDisposition?: "not_run" | "baseline_passed" | "preexisting_failure" | "regression";
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
}

export function buildEvidenceMatrix(input: {
  obligations: ValidationObligation[];
  evidence: ValidationEvidenceObservation[];
  notApplicableObligationIds?: string[];
  integrityFindingRefs?: string[];
}): EvidenceMatrix {
  const notApplicable = new Set(input.notApplicableObligationIds ?? []);
  const criteria = input.obligations.map((obligation): CriterionEvidence => {
    if (notApplicable.has(obligation.id)) return result(obligation, "not_applicable", "Obligation explicitly does not apply to this candidate.", []);
    const evidence = input.evidence
      .filter((item) => item.obligationId === obligation.id && obligation.acceptableEvidence.includes(item.kind))
      .sort((left, right) => left.attempt - right.attempt);
    if (evidence.length === 0) return result(obligation, "uncovered", "No acceptable evidence is linked to this obligation.", []);
    const refs = evidence.map((item) => item.evidenceId);
    const final = evidence.at(-1)!;
    if (obligation.baselinePolicy === "required" && (final.baselineDisposition === undefined || final.baselineDisposition === "not_run")) return result(obligation, "uncovered", "Required baseline evidence was not executed or linked.", refs);
    if (!final.passed) return result(obligation, "failed", final.baselineDisposition === "preexisting_failure" ? "Validation fails, but the same failure exists in the baseline." : "Linked validation evidence failed.", refs);
    if (obligation.negativeControl === "required" && final.negativeControlPassed !== true) return result(obligation, "failed", "Required negative control did not demonstrate test sensitivity.", refs);
    if (evidence.some((item) => !item.passed)) return result(obligation, "flaky", "Validation passed only after a prior failed attempt.", refs);
    return result(obligation, "satisfied", "Acceptable linked evidence passed on the exact candidate.", refs);
  });
  const required = input.obligations.map((obligation, index) => ({ obligation, criterion: criteria[index]! })).filter(({ obligation }) => obligation.severity === "required");
  const integrityFailed = (input.integrityFindingRefs?.length ?? 0) > 0;
  const hardFailure = required.some(({ obligation, criterion }) => criterion.status === "failed" || (criterion.status === "flaky" && obligation.flakyPolicy === "forbid"));
  const uncovered = required.some(({ criterion }) => criterion.status === "uncovered");
  return { criteria, outcome: hardFailure || integrityFailed ? "failed" : uncovered ? "unverified" : "verified" };
}

function result(obligation: ValidationObligation, status: CriterionEvidenceStatus, justification: string, evidenceRefs: string[]): CriterionEvidence {
  return { criterionId: obligation.criterionId, obligationId: obligation.id, status, justification, evidenceRefs };
}
