export const ADAPTIVE_UTILITY_POLICY_VERSION = "adaptive-utility/2.0.0-pilot";

export interface UtilityPolicyConfig {
  policyVersion: string;
  minimumAdvantage: number;
  maxLeafContextTokens: number;
  maxLeafScopePaths: number;
}

export const PILOT_UTILITY_POLICY: Readonly<UtilityPolicyConfig> = Object.freeze({
  policyVersion: ADAPTIVE_UTILITY_POLICY_VERSION,
  minimumAdvantage: 0.15,
  maxLeafContextTokens: 24_000,
  maxLeafScopePaths: 40
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
