import { ADAPTIVE_UTILITY_POLICY_VERSION } from "./utility-policy.js";

export const GRANULARITY_CONDITIONS = ["A", "B", "C"] as const;
export type GranularityCondition = (typeof GRANULARITY_CONDITIONS)[number];

/**
 * Resolves the condition a run plans under.
 *
 * `C1` and `C2` are labels of policies this build no longer implements: `C1` was
 * the `C_task` complexity index and `C2` its utility successor, now productive as
 * plain `C` under `adaptive-utility`. Journals that carry those labels are
 * immutable evidence and stay readable, but planning under them is refused rather
 * than silently resolved to `C` — replaying historical evidence under today's
 * semantics would attribute to an old run numbers it never produced.
 */
export function resolveGranularityCondition(condition: string | undefined): GranularityCondition {
  if (condition === undefined || condition === "C") return "C";
  if (condition === "C1" || condition === "C2") {
    throw new Error(
      `Granularity conditions "C1" and "C2" are historical labels and are not replayable: `
      + `this build implements ${ADAPTIVE_UTILITY_POLICY_VERSION}, not the policy that produced them. `
      + `Read the journal as recorded, or plan a new run under "C".`
    );
  }
  if (GRANULARITY_CONDITIONS.includes(condition as GranularityCondition)) return condition as GranularityCondition;
  throw new Error(`Unknown granularity condition "${condition}"; expected one of ${GRANULARITY_CONDITIONS.join(", ")}.`);
}
