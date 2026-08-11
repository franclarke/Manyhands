import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import type {
  GranularityAssessment,
  GranularityCondition,
  WorkBreakdown
} from "@manyhands/decomposer";

const CORPUS_PATH = join(process.cwd(), "tests", "fixtures", "granularity-corpus.json");

/**
 * One recorded planner output, as the policy receives it.
 *
 * These were extracted from the journals of runs executed before the granularity
 * policy governed anything, and deliberately carry no outcome: what those runs
 * decided, measured or delivered is not evidence about a policy, because the
 * policy's selection was discarded and the condition labels did not describe
 * what executed. What survives is the part that is independent of any policy —
 * a real cut a planner proposed against a real repository — which is exactly the
 * input a decision rule has to be judged on.
 *
 * The corpus is a fixture, not a derivation: baking the reconstruction in once
 * removes a subtle failure mode where the tree is rebuilt from the wrong event
 * and the acceptance intents shift underneath the features that read them.
 */
export interface GranularityCorpusCase {
  caseId: string;
  condition: GranularityCondition;
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
}

export interface GranularityCorpus {
  cases: GranularityCorpusCase[];
}

export function loadGranularityCorpus(): GranularityCorpus {
  const fixture = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as {
    schemaVersion: number;
    cases: GranularityCorpusCase[];
  };
  if (fixture.schemaVersion !== 1) {
    throw new Error(`Unsupported granularity corpus schemaVersion ${fixture.schemaVersion}.`);
  }
  return { cases: [...fixture.cases].sort((left, right) => left.caseId.localeCompare(right.caseId)) };
}

/** The decision a case produces, reduced to what a regression diff needs to show. */
export interface GranularityDecisionRow {
  caseId: string;
  unitKey: string;
  selected: string;
  leafFeasible: boolean;
  splitViable: boolean;
  doesNotFit: boolean;
  runsInParallel: boolean;
  verifiableApart: boolean;
}

export function decisionRows(
  caseId: string,
  assessments: Record<string, GranularityAssessment>
): GranularityDecisionRow[] {
  return Object.values(assessments)
    .map((assessment) => ({
      caseId,
      unitKey: assessment.unitKey,
      selected: assessment.selected,
      leafFeasible: assessment.leafFeasible,
      splitViable: assessment.splitViable,
      doesNotFit: assessment.reasons.doesNotFit,
      runsInParallel: assessment.reasons.runsInParallel,
      verifiableApart: assessment.reasons.verifiableApart
    }))
    .sort((left, right) => left.unitKey.localeCompare(right.unitKey));
}
