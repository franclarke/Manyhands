const APPROVAL_DECISION_PREFIX = "approve_plan:r";

/** Stable identity for the human gate that approves one immutable plan revision. */
export function approvalDecisionId(revision: number): string {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new Error(`Plan revision must be a positive integer; received ${revision}.`);
  }
  return `${APPROVAL_DECISION_PREFIX}${revision}`;
}

/** Returns the canonical revision, or undefined for legacy/unrelated identities. */
export function approvalDecisionRevision(decisionId: string): number | undefined {
  if (!decisionId.startsWith(APPROVAL_DECISION_PREFIX)) return undefined;
  const raw = decisionId.slice(APPROVAL_DECISION_PREFIX.length);
  if (!/^[1-9]\d*$/.test(raw)) return undefined;
  return Number(raw);
}

export function isLegacyApprovalDecisionId(decisionId: string): boolean {
  return decisionId === "approve_plan";
}
