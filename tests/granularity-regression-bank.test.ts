import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { selectGranularityStrategy } from "@manyhands/decomposer";
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

  it("recovers a corpus large enough to discriminate, and names what it excludes", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(80);
    expect(corpus.cases.filter((item) => item.replaysExactly).length).toBeGreaterThanOrEqual(80);
    // Exclusions are asserted as data so a shrinking corpus cannot pass quietly.
    expect(corpus.excluded.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it("replays every recorded decision exactly under the policy that produced it", () => {
    const drift: string[] = [];

    for (const item of corpus.cases.filter((candidate) => candidate.replaysExactly)) {
      const replayed = selectGranularityStrategy({
        condition: item.condition,
        breakdown: item.breakdown,
        repositorySnapshot: item.repositorySnapshot,
        config: item.config
      });

      for (const [unitKey, recorded] of Object.entries(item.recordedAssessments)) {
        const actual = replayed.assessments[unitKey];
        if (actual === undefined) {
          drift.push(`${item.caseId} :: ${unitKey} :: unit absent from replay`);
          continue;
        }
        if (actual.selected !== recorded.selected) {
          drift.push(`${item.caseId} :: ${unitKey} :: selected ${recorded.selected} -> ${actual.selected}`);
        }
        if (actual.splitAdvantage !== recorded.splitAdvantage) {
          drift.push(
            `${item.caseId} :: ${unitKey} :: advantage ${recorded.splitAdvantage} -> ${actual.splitAdvantage}`
          );
        }
        for (const [feature, value] of Object.entries(recorded.features)) {
          const replayedValue = actual.features[feature as keyof typeof actual.features];
          if (replayedValue !== value) {
            drift.push(`${item.caseId} :: ${unitKey} :: ${feature} ${value} -> ${replayedValue}`);
          }
        }
      }
    }

    expect(drift).toEqual([]);
  });

  it("produces a decision row for every assessed unit", () => {
    const rows = corpus.cases.flatMap((item) => decisionRows(item.caseId, item.recordedAssessments));
    expect(rows.length).toBeGreaterThan(corpus.cases.length);
    expect(rows.every((row) => ["leaf", "split", "semantic_replan"].includes(row.selected))).toBe(true);
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
        config: item.config
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
