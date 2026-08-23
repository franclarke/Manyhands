import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GRANULARITY_POLICY, selectGranularityStrategy } from "@manyhands/decomposer";
import { loadGranularityCorpus, decisionRows, type GranularityDecisionRow } from "./helpers/granularity-corpus.js";

const BASELINE_PATH = join(process.cwd(), "tests", "fixtures", "granularity-bank-baseline.json");

/**
 * The offline regression bank for the granularity policy.
 *
 * Every input the policy consumes was already journalled, so a change to the
 * decision rule can be measured against the decisions real runs actually made,
 * at no model cost. The fidelity test below is what makes the bank trustworthy:
 * it proves the reconstruction reproduces the recorded assessment exactly, so a
 * later diff can be attributed to the policy change rather than to a
 * reconstruction that drifted.
 *
 * When the policy version changes, this fidelity expectation is retired on
 * purpose and replaced by a frozen decision table for the new version. Do not
 * relax it to make a change pass — regenerate the table and review the diff.
 */
describe("granularity regression bank", () => {
  const corpus = loadGranularityCorpus();

  it("carries a corpus large enough to discriminate", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(80);
    expect(corpus.cases.every((item) => item.breakdown.root !== undefined)).toBe(true);
  });

  /**
   * The policy stops descending once it collapses a composite, so it does not
   * assess every unit of the input — and should not. What must hold is that it
   * reaches a verdict on the root of every case and never invents a unit key,
   * which is what would happen if the corpus and the tree it walks drifted apart.
   */
  it("reaches a verdict on every case without inventing units", () => {
    const problems: string[] = [];

    for (const item of corpus.cases) {
      const replayed = selectGranularityStrategy({
        condition: item.condition,
        breakdown: item.breakdown,
        repositorySnapshot: item.repositorySnapshot,
        config: DEFAULT_GRANULARITY_POLICY
      });
      const known = new Set(unitKeys(item.breakdown.root));
      if (replayed.assessments[item.breakdown.root.key] === undefined) {
        problems.push(`${item.caseId} :: root unassessed`);
      }
      for (const unitKey of Object.keys(replayed.assessments)) {
        if (!known.has(unitKey)) problems.push(`${item.caseId} :: ${unitKey} :: not a unit of the input tree`);
      }
    }

    expect(problems).toEqual([]);
  });

  /**
   * The frozen decision table.
   *
   * This is the instrument Phase 1 needs: change a feature, regenerate with
   * `UPDATE_GRANULARITY_BANK=1`, and `git diff` shows exactly which of the
   * recorded decisions moved and in which direction. Regenerating without
   * reading that diff defeats the point — the table is the review surface, not
   * a chore.
   */
  it("matches the frozen decision table for every replayable case", () => {
    const current: GranularityDecisionRow[] = corpus.cases.flatMap((item) => {
      const replayed = selectGranularityStrategy({
        condition: item.condition,
        breakdown: item.breakdown,
        repositorySnapshot: item.repositorySnapshot,
        config: DEFAULT_GRANULARITY_POLICY
      });
      return decisionRows(item.caseId, replayed.assessments);
    });

    if (process.env.UPDATE_GRANULARITY_BANK === "1") {
      mkdirSync(dirname(BASELINE_PATH), { recursive: true });
      writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    }

    expect(existsSync(BASELINE_PATH)).toBe(true);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as GranularityDecisionRow[];
    expect(current).toEqual(baseline);
  });
});

function unitKeys(unit: { key: string; kind: string; children?: Array<{ key: string; kind: string }> }): string[] {
  return unit.kind === "leaf"
    ? [unit.key]
    : [unit.key, ...(unit.children ?? []).flatMap((child) => unitKeys(child as Parameters<typeof unitKeys>[0]))];
}
