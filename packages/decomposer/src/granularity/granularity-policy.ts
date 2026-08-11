/**
 * The granularity policy: three reasons to split, none of them a score.
 *
 * Its predecessor averaged three benefits against four costs into a
 * dimensionless number and compared it to a threshold. Replayed over 83
 * recorded cuts, everything that apparatus contributed over the one-line rule
 * "split whenever the cut is viable" was ten collapses; no single feature
 * accounted for them; and the threshold decided identically at any value in
 * [0, 0.20]. An effect that small and that diffuse can be neither calibrated
 * nor defended, and a cut could not be said to cost anything, because the
 * number had no units.
 *
 * What replaces it has no free parameter. Each reason is a categorical property
 * of the cut, so there is nothing to fit and every decision has a sentence
 * behind it:
 *
 *  - **It does not fit.** The unit exceeds what one attempt can hold or
 *    produce, so a cut is the only executable frontier. Not a judgement.
 *  - **It runs in parallel.** Two children can start at the same time, so the
 *    cut buys wall-clock. The scheduler blocks a consumer until its producer's
 *    artifact exists, so a layered chain buys none of this and is likely slower
 *    than one attempt.
 *  - **It can be verified apart.** Every child owns an acceptance criterion no
 *    sibling owns, so one child's failure cannot void another's evidence. This
 *    is what a layered cut buys instead of speed.
 *
 * The cut collapses when it buys none of the three. The only numbers left are
 * the feasibility bounds, and those describe what one attempt can do rather
 * than what is worth doing.
 */
export const GRANULARITY_POLICY_VERSION = "granularity/4.0.0";

export interface GranularityPolicyConfig {
  policyVersion: string;
  /** Context a single attempt can hold, in estimated tokens. */
  maxLeafContextTokens: number;
  /** Distinct paths a single attempt may claim. */
  maxLeafScopePaths: number;
  /**
   * Paths a single attempt may bring into existence.
   *
   * Reading and producing are separate limits. Warehouse pilot W2 showed why:
   * after W1 the repository was tiny, so the root read almost nothing and
   * passed both context bounds, yet it had to create a whole application. It
   * was judged feasible, its three-way cut was collapsed, and the merged leaf
   * spent a thirty-minute budget without delivering.
   */
  maxLeafPlannedPaths: number;
}

export const DEFAULT_GRANULARITY_POLICY: Readonly<GranularityPolicyConfig> = Object.freeze({
  policyVersion: GRANULARITY_POLICY_VERSION,
  maxLeafContextTokens: 24_000,
  maxLeafScopePaths: 40,
  maxLeafPlannedPaths: 12
});

export type GranularityDecision = "leaf" | "split" | "semantic_replan";

export interface GranularitySplitReasons {
  /** The unit exceeds what one attempt can hold or produce. */
  doesNotFit: boolean;
  /** At least two children can start at the same time. */
  runsInParallel: boolean;
  /** Every child owns an acceptance criterion no sibling owns. */
  verifiableApart: boolean;
}

export interface GranularityAssessment {
  unitKey: string;
  candidateTreeHash: string;
  selected: GranularityDecision;
  leafFeasible: boolean;
  splitViable: boolean;
  reasons: GranularitySplitReasons;
  evidenceRefs: string[];
  rationale: string;
}

export const NO_SPLIT_REASONS: Readonly<GranularitySplitReasons> = Object.freeze({
  doesNotFit: false,
  runsInParallel: false,
  verifiableApart: false
});

export function anyReasonHolds(reasons: GranularitySplitReasons): boolean {
  return reasons.doesNotFit || reasons.runsInParallel || reasons.verifiableApart;
}

/** The sentence behind the decision, naming the reasons that carried it. */
export function describeDecision(
  selected: GranularityDecision,
  reasons: GranularitySplitReasons,
  splitViable: boolean
): string {
  if (selected === "semantic_replan") {
    return "The unit exceeds one attempt and the candidate contains no cut to take.";
  }
  if (selected === "leaf") {
    return splitViable
      ? "The cut fits one attempt, runs in order, and its children share the criteria that prove them."
      : "No cut with two or more children is available; the unit stays whole.";
  }
  const carried = [
    reasons.doesNotFit ? "the unit exceeds one attempt" : undefined,
    reasons.runsInParallel ? "two children can start at the same time" : undefined,
    reasons.verifiableApart ? "every child owns a criterion no sibling owns" : undefined
  ].filter((item): item is string => item !== undefined);
  return `Split because ${carried.join("; ")}.`;
}

export function validateGranularityPolicyConfig(
  config: GranularityPolicyConfig
): GranularityPolicyConfig {
  if (config.policyVersion.trim().length === 0) {
    throw new TypeError("policyVersion must be non-empty.");
  }
  assertPositiveInteger(config.maxLeafContextTokens, "maxLeafContextTokens");
  assertPositiveInteger(config.maxLeafScopePaths, "maxLeafScopePaths");
  assertPositiveInteger(config.maxLeafPlannedPaths, "maxLeafPlannedPaths");
  return { ...config };
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}
