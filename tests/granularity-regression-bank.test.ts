import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PILOT_UTILITY_POLICY, selectGranularityStrategy } from "@manyhands/decomposer";
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
    // Exclusions are asserted as data so a shrinking corpus cannot pass quietly.
    expect(corpus.excluded.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  /**
   * Structural fidelity: the reconstruction is a well-formed policy input that
   * covers exactly the units the run assessed.
   *
   * Value fidelity — replaying reproduces every recorded selection, advantage
   * and feature exactly — was proven against all 87 cases while the build still
   * implemented `adaptive-utility/3.1.0-pilot`, the version that recorded them
   * (commit 2f6b64bf). It cannot be asserted across a version bump without
   * asserting that the policy never changes, so what carries it forward is the
   * frozen decision table below, whose first revision was generated from that
   * proven-faithful reconstruction.
   */
  it("reconstructs every case into a well-formed policy input", () => {
    const missing: string[] = [];

    for (const item of corpus.cases) {
      const replayed = selectGranularityStrategy({
        condition: item.condition,
        breakdown: item.breakdown,
        repositorySnapshot: item.repositorySnapshot,
        config: PILOT_UTILITY_POLICY
      });
      for (const unitKey of Object.keys(item.recordedAssessments)) {
        if (replayed.assessments[unitKey] === undefined) {
          missing.push(`${item.caseId} :: ${unitKey} :: unit absent from replay`);
        }
      }
    }

    expect(missing).toEqual([]);
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
        config: PILOT_UTILITY_POLICY
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
