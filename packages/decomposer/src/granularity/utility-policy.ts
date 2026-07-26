/**
 * Policy C, the adaptive granularity policy this thesis contributes.
 *
 * 3.0.0 adds a production bound to leaf feasibility. Until 2.x, feasibility
 * asked only what a unit had to READ; Warehouse pilot W2 was judged a feasible
 * leaf on a nearly empty repository and then failed to create a whole
 * application inside one attempt. The condition label `C2` survives in the
 * persisted journals of runs already executed and is not renamed there: those
 * events are immutable evidence.
 */
export const ADAPTIVE_UTILITY_POLICY_VERSION = "adaptive-utility/3.0.0-pilot";

export interface UtilityPolicyConfig {
  policyVersion: string;
  minimumAdvantage: number;
  maxLeafContextTokens: number;
  maxLeafScopePaths: number;
  /** Upper bound on paths a single leaf may bring into existence. */
  maxLeafPlannedPaths: number;
}

export const PILOT_UTILITY_POLICY: Readonly<UtilityPolicyConfig> = Object.freeze({
  policyVersion: ADAPTIVE_UTILITY_POLICY_VERSION,
  minimumAdvantage: 0.15,
  maxLeafContextTokens: 24_000,
  maxLeafScopePaths: 40,
  // Provisional. Anchoring this on delivered increments is a pilot task: W1
  // succeeded and W2 did not, so the bound belongs between their planned
  // counts. It is declared here rather than tuned per run.
  maxLeafPlannedPaths: 12
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
  return { ...config };
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
