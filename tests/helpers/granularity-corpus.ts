import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  ADAPTIVE_UTILITY_POLICY_VERSION,
  WorkBreakdownSchema,
  projectSemanticPlanForLegacyCompiler,
  resolveGranularityCondition,
  type GranularityStrategyAssessment,
  type SemanticPlan,
  type UtilityGranularityCondition,
  type UtilityPolicyConfig,
  type WorkBreakdown
} from "@manyhands/decomposer";

const EVIDENCE_ROOT = join(process.cwd(), "docs", "tesis", "evidence");

/**
 * One replayable granularity decision recovered from a persisted run.
 *
 * The corpus exists because every input the policy consumes was already
 * journalled: `repository.inspected` carries the whole snapshot including the
 * file index, and `planning.completed` carries the semantic plan the policy was
 * handed. Reconstructing from those two events reproduces the exact call the
 * run made, so a policy change can be measured against ~100 real decisions
 * without spending a single model call.
 */
export interface GranularityCorpusCase {
  caseId: string;
  condition: UtilityGranularityCondition;
  config: UtilityPolicyConfig;
  breakdown: WorkBreakdown;
  repositorySnapshot: RepositorySnapshot;
  /** What the run actually recorded, keyed by unit. The fidelity oracle. */
  recordedAssessments: Record<string, GranularityStrategyAssessment>;
  /**
   * The version that produced `recordedAssessments`. Only cases recorded under
   * the version this build implements can be held to an exact replay; the rest
   * are still valid *inputs* for measuring a change, but their recorded output
   * came from code that no longer exists.
   */
  recordedPolicyVersion: string;
  replaysExactly: boolean;
}

export interface GranularityCorpus {
  cases: GranularityCorpusCase[];
  /** Runs found but not replayable, with the reason. Never silently dropped. */
  excluded: Array<{ caseId: string; reason: string }>;
}

interface JournalEvent {
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Loads every replayable granularity decision under `docs/tesis/evidence`.
 *
 * Exclusions are returned rather than skipped: a corpus that quietly drops the
 * cases it cannot handle reads as full coverage when it is not. The historical
 * `C1`/`C2` conditions are the main exclusion — this build does not implement
 * the policy that produced them, and `resolveGranularityCondition` refuses to
 * pretend otherwise.
 */
export function loadGranularityCorpus(): GranularityCorpus {
  const cases: GranularityCorpusCase[] = [];
  const excluded: Array<{ caseId: string; reason: string }> = [];

  for (const journalPath of journalFiles(EVIDENCE_ROOT)) {
    const caseId = relative(EVIDENCE_ROOT, journalPath).split(sep).join("/");
    const events = readJournal(journalPath);
    const strategy = events.find((event) => event.type === "planning.granularity_strategy_selected");
    if (strategy === undefined) continue;

    const inspected = events.find((event) => event.type === "repository.inspected");
    const planned = events.find((event) => event.type === "planning.completed");
    if (inspected === undefined || planned === undefined) {
      excluded.push({ caseId, reason: "journal lacks repository.inspected or planning.completed" });
      continue;
    }
    const snapshot = inspected.payload.snapshot as RepositorySnapshot | undefined;
    const recordedPlan = planned.payload.breakdown as Record<string, unknown> | undefined;
    if (snapshot?.index === undefined || recordedPlan === undefined) {
      excluded.push({ caseId, reason: "recorded snapshot has no file index, or no plan was journalled" });
      continue;
    }

    let condition: UtilityGranularityCondition;
    try {
      condition = resolveGranularityCondition(strategy.payload.condition as string) as UtilityGranularityCondition;
    } catch (error) {
      excluded.push({ caseId, reason: (error as Error).message.split(":")[0]! });
      continue;
    }

    // The tree the policy actually received is journalled on the event itself.
    // Re-deriving it from `planning.completed` is not equivalent: acceptance
    // intents are allocated between the two, so a re-derived tree changes
    // `faultIsolation` and `validationDuplication` and the replay stops being a
    // replay. `candidateTree` is authoritative for structure and relations;
    // everything else the schema needs comes from the recorded plan.
    const candidateTree = strategy.payload.candidateTree as Record<string, unknown> | undefined;
    if (candidateTree?.root === undefined) {
      excluded.push({ caseId, reason: "event predates candidateTree; the exact policy input was not journalled" });
      continue;
    }
    let breakdown: WorkBreakdown;
    try {
      const base = "planId" in recordedPlan
        ? projectSemanticPlanForLegacyCompiler(recordedPlan as unknown as SemanticPlan).breakdown
        : (recordedPlan as unknown as WorkBreakdown);
      breakdown = WorkBreakdownSchema.parse({
        ...base,
        repositorySnapshotId: snapshot.snapshotId,
        root: candidateTree.root,
        candidateArtifacts: candidateTree.candidateArtifacts ?? [],
        candidateSeams: candidateTree.candidateSeams ?? []
      });
    } catch (error) {
      excluded.push({ caseId, reason: `recorded tree does not satisfy the schema: ${(error as Error).message.slice(0, 70)}` });
      continue;
    }

    // The version lives on the payload, not inside `config`; older events also
    // predate `maxLeafPlannedPaths`. Supplying a default for it would silently
    // change `isLeafFeasible`, so those cases are excluded rather than guessed.
    const recordedConfig = strategy.payload.config as Partial<UtilityPolicyConfig>;
    if (recordedConfig.maxLeafPlannedPaths === undefined) {
      excluded.push({ caseId, reason: "config predates maxLeafPlannedPaths; a default would change leaf feasibility" });
      continue;
    }
    const recordedPolicyVersion = String(strategy.payload.policyVersion ?? "unknown");

    cases.push({
      caseId,
      condition,
      config: { ...recordedConfig, policyVersion: recordedPolicyVersion } as UtilityPolicyConfig,
      breakdown,
      repositorySnapshot: snapshot,
      recordedAssessments: byUnitKey(strategy.payload.assessments as GranularityStrategyAssessment[]),
      recordedPolicyVersion,
      replaysExactly: recordedPolicyVersion === ADAPTIVE_UTILITY_POLICY_VERSION
    });
  }

  cases.sort((left, right) => left.caseId.localeCompare(right.caseId));
  excluded.sort((left, right) => left.caseId.localeCompare(right.caseId));
  return { cases, excluded };
}

/** The decision a case produces, reduced to what a regression diff needs to show. */
export interface GranularityDecisionRow {
  caseId: string;
  unitKey: string;
  selected: string;
  leafFeasible: boolean;
  splitViable: boolean;
  splitAdvantage: number;
  minimumAdvantage: number;
}

export function decisionRows(
  caseId: string,
  assessments: Record<string, GranularityStrategyAssessment>
): GranularityDecisionRow[] {
  return Object.values(assessments)
    .map((assessment) => ({
      caseId,
      unitKey: assessment.unitKey,
      selected: assessment.selected,
      leafFeasible: assessment.leafFeasible,
      splitViable: assessment.splitViable,
      splitAdvantage: assessment.splitAdvantage,
      minimumAdvantage: assessment.minimumAdvantage
    }))
    .sort((left, right) => left.unitKey.localeCompare(right.unitKey));
}

function byUnitKey(
  assessments: readonly GranularityStrategyAssessment[]
): Record<string, GranularityStrategyAssessment> {
  return Object.fromEntries(assessments.map((assessment) => [assessment.unitKey, assessment]));
}

function journalFiles(root: string): string[] {
  const output: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith(".jsonl")) output.push(path);
    }
  };
  visit(root);
  return output.sort();
}

function readJournal(path: string): JournalEvent[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        const record = JSON.parse(line) as { event?: JournalEvent } & JournalEvent;
        return [record.event ?? record];
      } catch {
        return [];
      }
    })
    .filter((event): event is JournalEvent => typeof event?.type === "string");
}
