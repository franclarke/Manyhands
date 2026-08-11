import { describe, expect, it } from "vitest";
import { PILOT_UTILITY_POLICY, selectGranularityStrategy, type GranularityStrategyAssessment } from "@manyhands/decomposer";
import { loadGranularityCorpus } from "./helpers/granularity-corpus.js";

/**
 * What each part of the policy actually contributes.
 *
 * A decision rule can look elaborate and still agree with a trivial one on
 * everything it is ever asked. Before designing runs around this policy, the
 * cheap question is whether it decides anything the corpus can see: the 87
 * recorded cuts are replayed under the full rule and under three mutilations of
 * it, and the variants are compared to each other.
 *
 * Every case is evaluated under condition C. A and B are instructions rather
 * than judgements — A collapses by definition, B expands by definition — so
 * scoring a tree under the label of the run that happened to produce it would
 * measure the instruction, not the rule.
 *
 * Features are decision-independent: `cutFeatures` reads the unit's children and
 * the relations between them, never a verdict, and `selectUnit` assesses every
 * descendant before deciding anything. So one pass produces the inputs for all
 * four variants, and any difference between them is the rule alone.
 */
type Variant = "complete" | "withoutIsolation" | "withoutCost" | "alwaysLeaf";

const VARIANTS: Variant[] = ["complete", "withoutIsolation", "withoutCost", "alwaysLeaf"];

describe("granularity policy ablation", () => {
  const corpus = loadGranularityCorpus();
  const decisions = new Map<Variant, Map<string, "leaf" | "split">>(
    VARIANTS.map((variant) => [variant, new Map()])
  );
  const infeasible = new Set<string>();
  const features = new Map<string, GranularityStrategyAssessment["features"]>();

  for (const item of corpus.cases) {
    const replayed = selectGranularityStrategy({
      condition: "C",
      breakdown: item.breakdown,
      repositorySnapshot: item.repositorySnapshot,
      config: PILOT_UTILITY_POLICY
    });
    for (const assessment of Object.values(replayed.assessments)) {
      if (!assessment.splitViable) continue;
      const key = `${item.caseId}::${assessment.unitKey}`;
      if (!assessment.leafFeasible) infeasible.add(key);
      features.set(key, assessment.features);
      for (const variant of VARIANTS) {
        decisions.get(variant)!.set(key, decide(variant, assessment));
      }
    }
  }

  const keys = [...decisions.get("complete")!.keys()];

  it("has viable cuts to discriminate on", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  it("reports what each part of the rule contributes", () => {
    const counts = VARIANTS.map((variant) => {
      const map = decisions.get(variant)!;
      const split = keys.filter((key) => map.get(key) === "split").length;
      return `  ${variant.padEnd(18)} split=${String(split).padStart(3)}  leaf=${String(keys.length - split).padStart(3)}`;
    });

    const pairs: string[] = [];
    for (let left = 0; left < VARIANTS.length; left += 1) {
      for (let right = left + 1; right < VARIANTS.length; right += 1) {
        const a = decisions.get(VARIANTS[left]!)!;
        const b = decisions.get(VARIANTS[right]!)!;
        const agree = keys.filter((key) => a.get(key) === b.get(key)).length;
        pairs.push(
          `  ${VARIANTS[left]!.padEnd(18)} vs ${VARIANTS[right]!.padEnd(18)} ` +
          `acuerdo ${String(agree).padStart(3)}/${keys.length}  (${((agree / keys.length) * 100).toFixed(1)}%)`
        );
      }
    }

    // A cut whose parent does not fit one attempt is forced open by feasibility,
    // not chosen by the cost model. Separating those shows the space the scoring
    // is actually free to decide in.
    const forced = keys.filter((key) => infeasible.has(key)).length;
    const free = keys.filter((key) => !infeasible.has(key));
    const freeSplit = free.filter((key) => decisions.get("complete")!.get(key) === "split").length;

    console.log(
      `\ncortes viables evaluados: ${keys.length}\n\ndecisiones por variante:\n${counts.join("\n")}\n\n` +
      `acuerdo entre variantes:\n${pairs.join("\n")}\n\n` +
      `espacio real de decision:\n` +
      `  forzados por hoja infactible : ${forced}\n` +
      `  libres para el modelo de costo: ${free.length}  -> split=${freeSplit} leaf=${free.length - freeSplit}\n`
    );
    expect(pairs).toHaveLength(6);
  });

  /**
   * Whether the seven-feature rule is separable from a one-feature one.
   *
   * The rule can only ever remove cuts the planner proposed, so what it
   * contributes is a set of collapses. If a single feature and a threshold
   * reproduce that set, the aggregation is not carrying the decision, and the
   * redesign should start from the feature that is — not from a better way to
   * average seven.
   */
  it("reports the best single-feature rule that imitates the full one", () => {
    const complete = decisions.get("complete")!;
    const rows = FEATURE_KEYS.map((feature) => {
      let best = { threshold: 0, agree: 0 };
      for (let step = 0; step <= 100; step += 1) {
        const threshold = step / 100;
        // Collapse when the feature is at or above the threshold; the cut is
        // kept otherwise. Both directions are tried.
        for (const invert of [false, true]) {
          const agree = keys.filter((key) => {
            const value = features.get(key)![feature];
            const collapse = invert ? value <= threshold : value >= threshold;
            return (collapse ? "leaf" : "split") === complete.get(key);
          }).length;
          if (agree > best.agree) best = { threshold, agree };
        }
      }
      return { feature, ...best };
    }).sort((left, right) => right.agree - left.agree);

    console.log(`\nmejor regla de una sola feature (imitando a la completa):\n${rows
      .map((row) => `  ${row.feature.padEnd(22)} acuerdo ${String(row.agree).padStart(3)}/${keys.length}  (${((row.agree / keys.length) * 100).toFixed(1)}%)`)
      .join("\n")}\n`);
    expect(rows).toHaveLength(FEATURE_KEYS.length);
  });
});

const FEATURE_KEYS = [
  "contextRelief", "parallelism", "faultIsolation", "coordination",
  "pathOverlap", "validationDuplication", "uncertainty"
] as const;

function decide(variant: Variant, assessment: GranularityStrategyAssessment): "leaf" | "split" {
  if (variant === "alwaysLeaf") return "leaf";
  if (variant === "withoutCost") return "split";
  // An infeasible leaf is not a judgement the cost model makes: the unit does
  // not fit one attempt, so the only executable frontier is the cut.
  if (!assessment.leafFeasible) return "split";
  if (assessment.splitAdvantage >= assessment.minimumAdvantage) return "split";
  if (variant === "complete" && assessment.features.faultIsolation >= PILOT_UTILITY_POLICY.minimumFaultIsolation) {
    return "split";
  }
  return "leaf";
}
