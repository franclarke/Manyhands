/**
 * Policy C, the adaptive granularity policy this thesis contributes.
 *
 * 3.0.0 adds a production bound to leaf feasibility. Until 2.x, feasibility
 * asked only what a unit had to READ; Warehouse pilot W2 was judged a feasible
 * leaf on a nearly empty repository and then failed to create a whole
 * application inside one attempt. The condition label `C2` survives in the
 * persisted journals of runs already executed and is not renamed there: those
 * events are immutable evidence.
 *
 * 3.1.0 rebuilds the two terms that decide a cut. Both counted edges, and both
 * were extreme for any connected cut: `parallelism` divided by the edge count of
 * a spanning tree, so a fan-out and a chain both scored zero, and `coordination`
 * charged at least `(n-1)/n` and rose toward 1 as the cut grew. They now measure
 * what they are named after — the depth of the production order and the share of
 * child pairs that must coordinate directly, net of dependencies another already
 * implies. See `strategy-selector.ts` for the derivation.
 *
 * 3.2.0 makes the policy price the graph the compiler will build, and gives
 * fault isolation a decision of its own.
 *
 *  - `contextRelief` is measured against the execution budget rather than
 *    against the parent. Against the parent it reported two thirds of a maximum
 *    on a target whose entire source is 4% of one leaf's budget, and its value
 *    moved with nothing but how the planner distributed files.
 *  - `coordination` is charged on the relations that compile to an
 *    execution-blocking requirement. It previously included seams, which compile
 *    to no requirement, so declaring an interface contract strictly worsened the
 *    score of the cut that declared it.
 *  - `minimumFaultIsolation` admits a cut whose children own disjoint acceptance
 *    criteria. Averaged with two other benefits, a perfect isolation was diluted
 *    to a third and layered work could be collapsed for want of concurrency a
 *    chain was never going to have.
 */
export const ADAPTIVE_UTILITY_POLICY_VERSION = "adaptive-utility/3.2.0-pilot";

export interface UtilityPolicyConfig {
  policyVersion: string;
  minimumAdvantage: number;
  maxLeafContextTokens: number;
  maxLeafScopePaths: number;
  /** Upper bound on paths a single leaf may bring into existence. */
  maxLeafPlannedPaths: number;
  /**
   * Isolation at or above which a viable cut is admitted regardless of its
   * aggregate advantage. Set at 1 — every child owning acceptance criteria no
   * sibling shares — because that is the only value on the scale whose meaning
   * is categorical rather than a magnitude, and so the only one that is not a
   * threshold fitted to an observation.
   */
  minimumFaultIsolation: number;
}

export const PILOT_UTILITY_POLICY: Readonly<UtilityPolicyConfig> = Object.freeze({
  policyVersion: ADAPTIVE_UTILITY_POLICY_VERSION,
  // Swept across the 83 viable cuts in the regression bank: every value in
  // [0, 0.20] produces the identical 67 split / 16 leaf split, and the first
  // decision moves at 0.25. The recorded corpus therefore cannot discriminate
  // within that region, and this value is inherited rather than derived — what
  // decides these cases is whether the planner proposed a multi-child cut at
  // all, and the isolation floor. Calibrating it needs a corpus separate from
  // the one used to evaluate, on targets where context pressure is real.
  minimumAdvantage: 0.15,
  maxLeafContextTokens: 24_000,
  maxLeafScopePaths: 40,
  // Provisional. W1 delivered with 10 planned paths and W2 failed with 6, so
  // these observations cannot anchor a discriminating value. Keep this fixed
  // pilot ceiling rather than tuning it per run.
  maxLeafPlannedPaths: 12,
  minimumFaultIsolation: 1
});

export interface GranularityStrategyFeatures {
  contextRelief: number;
  parallelism: number;
  faultIsolation: number;
  coordination: number;
  pathOverlap: number;
  validationDuplication: number;
  uncertainty: number;
}

export type GranularityStrategyDecision = "leaf" | "split" | "semantic_replan";

export interface GranularityStrategyAssessment {
  unitKey: string;
  candidateTreeHash: string;
  selected: GranularityStrategyDecision;
  leafFeasible: boolean;
  splitViable: boolean;
  features: GranularityStrategyFeatures;
  benefit: number;
  cost: number;
  splitAdvantage: number;
  minimumAdvantage: number;
  evidenceRefs: string[];
  rationale: string;
}

export function validateUtilityPolicyConfig(config: UtilityPolicyConfig): UtilityPolicyConfig {
  assertNonEmpty(config.policyVersion, "policyVersion");
  assertFinite(config.minimumAdvantage, "minimumAdvantage");
  assertNonNegative(config.maxLeafContextTokens, "maxLeafContextTokens");
  assertPositiveInteger(config.maxLeafScopePaths, "maxLeafScopePaths");
  assertPositiveInteger(config.maxLeafPlannedPaths, "maxLeafPlannedPaths");
  assertUnitInterval(config.minimumFaultIsolation, "minimumFaultIsolation");
  return { ...config };
}

function assertUnitInterval(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0 || value > 1) throw new RangeError(`${label} must lie in [0, 1].`);
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} must be non-empty.`);
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number.`);
}

function assertNonNegative(value: number, label: string): void {
  assertFinite(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative.`);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}
