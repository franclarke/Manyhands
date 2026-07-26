import {
  DEFAULT_COMPLEXITY_WEIGHTS,
  LEAF_COMPLEXITY_THRESHOLD,
  type ComplexityWeights
} from "./complexity-evaluator.js";

/**
 * The granularity policy as effective, per-run configuration.
 *
 * The comparative study needs conditions A, B and C to differ by configuration
 * a run records about itself, not by a code edit between runs: a persisted run
 * whose policy is implicit cannot be attributed to a condition afterwards.
 *
 * `leafThreshold` stays finite in every named policy. A complexity score is a
 * weighted mean of four 0..10 dimensions whose weights sum to one, so it can
 * never leave [0, 10]: a threshold of 10 makes every unit a leaf and -1 makes
 * none. Infinities would be the more literal encoding but they do not survive
 * JSON, and the policy travels inside a persisted domain event.
 */
export interface GranularityPolicy {
  /** A unit stays a leaf when its C_task score is at or below this value. */
  leafThreshold: number;
  weights: ComplexityWeights;
  /** When false the coalescing critic never merges siblings. */
  coalescingEnabled: boolean;
  /** Suffix appended to the formula version, so a run is self-describing. */
  versionSuffix: string;
}

/** Condition C: the productive policy. Its absence must change nothing. */
export const ADAPTIVE_GRANULARITY_POLICY: GranularityPolicy = Object.freeze({
  leafThreshold: LEAF_COMPLEXITY_THRESHOLD,
  weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
  coalescingEnabled: true,
  versionSuffix: ""
});

/** Condition A: decomposition forbidden — one agent takes the whole goal. */
export const SINGLE_LEAF_POLICY: GranularityPolicy = Object.freeze({
  leafThreshold: 10,
  weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
  coalescingEnabled: false,
  versionSuffix: "+condA"
});

/**
 * Condition B: split every unit the Architect proposed, never coalesce.
 *
 * This is a fixed *fine* split, not an unbounded one: like the adaptive policy,
 * it cannot invent a semantic cut the Architect did not propose, so a unit with
 * no proposed sub-units stays a cohesive leaf and records `resplit_declined`.
 * Fabricating parts by partitioning paths is what the canonical run showed to
 * produce incoherent scopes.
 */
export const FINE_SPLIT_POLICY: GranularityPolicy = Object.freeze({
  leafThreshold: -1,
  weights: { ...DEFAULT_COMPLEXITY_WEIGHTS },
  coalescingEnabled: false,
  versionSuffix: "+condB"
});

export const GRANULARITY_CONDITIONS = ["A", "B", "C"] as const;
export type GranularityCondition = (typeof GRANULARITY_CONDITIONS)[number];

const LEGACY_POLICY_BY_CONDITION: Record<"A" | "B" | "C1", GranularityPolicy> = {
  A: SINGLE_LEAF_POLICY,
  B: FINE_SPLIT_POLICY,
  C1: ADAPTIVE_GRANULARITY_POLICY
};

/** Maps historical C1/C2 records onto the current productive C policy. */
export function resolveGranularityCondition(condition: string | undefined): GranularityCondition {
  if (condition === undefined || condition === "C" || condition === "C1" || condition === "C2") return "C";
  if (GRANULARITY_CONDITIONS.includes(condition as GranularityCondition)) return condition as GranularityCondition;
  throw new Error(`Unknown granularity condition "${condition}"; expected one of ${GRANULARITY_CONDITIONS.join(", ")}.`);
}

/** Resolves only the historical C_task policies kept for C1 replay. */
export function granularityPolicyFor(condition: string | undefined): GranularityPolicy {
  const normalized = condition === "C" || condition === undefined ? "C1" : condition;
  const policy = LEGACY_POLICY_BY_CONDITION[normalized as keyof typeof LEGACY_POLICY_BY_CONDITION];
  if (policy === undefined) {
    throw new Error(`Condition "${condition}" does not use the historical C_task policy.`);
  }
  return policy;
}
