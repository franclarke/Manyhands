import { describe, expect, it } from "vitest";
import {
  DEFAULT_GRANULARITY_POLICY,
  WorkBreakdownSchema,
  selectGranularityStrategy,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";
import type { RepositorySnapshot } from "@manyhands/repository-index";

/**
 * The granularity policy: three reasons to split, each a property of the cut
 * rather than a score.
 *
 * The rule it replaces averaged three benefits against four costs into a
 * dimensionless number compared to a threshold. Measured against 83 recorded
 * cuts, everything that apparatus contributed over "split whenever the cut is
 * viable" was ten collapses, spread across features with none dominating, and
 * its threshold decided identically anywhere in [0, 0.20]. A number that small
 * and that diffuse cannot be calibrated and cannot be defended.
 *
 * What replaces it has no free parameter at all. Each reason is a categorical
 * property, so there is nothing to fit:
 *
 *  - the unit does not fit one attempt, so a cut is the only executable frontier;
 *  - two children can start at the same time, so the cut buys wall-clock;
 *  - every child owns an acceptance criterion no sibling owns, so a failure in
 *    one does not void the verified evidence of another.
 *
 * The only numbers left are the three feasibility bounds, and those are not
 * judgements: they describe what one attempt can hold and produce.
 */
describe("granularity policy — a unit that does not fit", () => {
  it("splits, because a cut is the only executable frontier", () => {
    // The root reads 37_500 tokens against a 24_000 budget; each child reads
    // 12_500 and fits. A cut whose children also overflow would not help, and
    // the policy asks for a replan instead — the case below.
    const assessment = assess(cut([50_000, 50_000, 50_000], {
      childCriteria: [["intent-a"], ["intent-a"], ["intent-a"]],
      edges: [[0, 1], [1, 2]]
    }));

    expect(assessment.leafFeasible).toBe(false);
    expect(assessment.reasons.doesNotFit).toBe(true);
    expect(assessment.selected).toBe("split");
  });

  it("asks for a semantic replan when it does not fit and has no cut to take", () => {
    const assessment = assess(cut([200_000], { childCriteria: [["intent-a"]] }));

    expect(assessment.leafFeasible).toBe(false);
    expect(assessment.splitViable).toBe(false);
    expect(assessment.selected).toBe("semantic_replan");
  });
});

describe("granularity policy — children that run at the same time", () => {
  it("splits when at least two children can start at once", () => {
    const assessment = assess(cut([400, 400, 400]));

    expect(assessment.reasons.runsInParallel).toBe(true);
    expect(assessment.selected).toBe("split");
  });

  it("credits no concurrency to a chain, because the scheduler runs it in order", () => {
    // domain -> application -> api: each waits for the artifact before it.
    const assessment = assess(cut([400, 400, 400], { edges: [[0, 1], [1, 2]] }));

    expect(assessment.reasons.runsInParallel).toBe(false);
  });

  it("credits concurrency to a fan-out, where the consumers proceed together", () => {
    const assessment = assess(cut([400, 400, 400], { edges: [[0, 1], [0, 2]] }));

    expect(assessment.reasons.runsInParallel).toBe(true);
  });

  it("credits concurrency across a seam, which compiles to no requirement", () => {
    const assessment = assess(cut([400, 400], { edges: [[0, 1]], asSeams: true }));

    expect(assessment.reasons.runsInParallel).toBe(true);
  });

  it("credits none to a cut its own dependencies cannot schedule", () => {
    const assessment = assess(cut([400, 400, 400], { edges: [[0, 1], [1, 2], [2, 0]] }));

    expect(assessment.reasons.runsInParallel).toBe(false);
  });
});

describe("granularity policy — children that can be verified apart", () => {
  it("splits when every child owns a criterion no sibling owns", () => {
    const assessment = assess(cut([400, 400, 400], { edges: [[0, 1], [1, 2]] }));

    expect(assessment.reasons.verifiableApart).toBe(true);
    expect(assessment.selected).toBe("split");
  });

  it("credits nothing when a child owns no criterion of its own", () => {
    const assessment = assess(cut([400, 400], {
      edges: [[0, 1]],
      childCriteria: [["intent-a", "intent-b"], ["intent-a"]]
    }));

    expect(assessment.reasons.verifiableApart).toBe(false);
  });
});

describe("granularity policy — the collapse", () => {
  it("collapses a cut that buys none of the three", () => {
    const assessment = assess(cut([400, 400], {
      edges: [[0, 1]],
      childCriteria: [["intent-a"], ["intent-a"]]
    }));

    expect(assessment.reasons).toEqual({
      doesNotFit: false,
      runsInParallel: false,
      verifiableApart: false
    });
    expect(assessment.selected).toBe("leaf");
  });

  it("names in its rationale which reasons carried the decision", () => {
    const assessment = assess(cut([400, 400, 400]));

    expect(assessment.rationale).toContain("at the same time");
  });
});

describe("granularity policy — condition A", () => {
  it("collapses the goal into one unit whatever the reasons say", () => {
    const result = selectGranularityStrategy({
      condition: "A",
      breakdown: cut([400, 400, 400]).breakdown,
      repositorySnapshot: cut([400, 400, 400]).snapshot,
      config: DEFAULT_GRANULARITY_POLICY
    });

    expect(result.selectedBreakdown.root.kind).toBe("leaf");
    expect(result.assessments.root?.selected).toBe("leaf");
  });
});

function assess(input: { breakdown: WorkBreakdown; snapshot: RepositorySnapshot }) {
  const result = selectGranularityStrategy({
    condition: "C",
    breakdown: input.breakdown,
    repositorySnapshot: input.snapshot,
    config: DEFAULT_GRANULARITY_POLICY
  });
  const assessment = result.assessments.root;
  if (assessment === undefined) throw new Error("expected a root assessment");
  return assessment;
}

const INTENTS = ["intent-a", "intent-b", "intent-c", "intent-d"];

/** A one-level cut whose children own existing files of the given byte sizes. */
function cut(
  byteSizes: readonly number[],
  options: {
    edges?: ReadonlyArray<readonly [number, number]>;
    asSeams?: boolean;
    childCriteria?: ReadonlyArray<readonly string[]>;
  } = {}
): { breakdown: WorkBreakdown; snapshot: RepositorySnapshot } {
  const childKeys = byteSizes.map((_, index) => `child-${index}`);
  const paths = childKeys.map((key) => `src/${key}.ts`);
  const criteria = options.childCriteria
    ?? byteSizes.map((_, index) => [INTENTS[index % INTENTS.length]!]);
  const children = childKeys.map((key, index) => leaf(key, paths[index]!, [...criteria[index]!]));
  const relations = (options.edges ?? []).map(([producer, consumer], index) => ({
    id: `relation-${index}`,
    producerUnitKey: childKeys[producer]!,
    consumerUnitKeys: [childKeys[consumer]!],
    evidenceIds: []
  }));

  const allCriteria = [...new Set(criteria.flat())];
  const breakdown = WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: "candidate-1",
    objective: "Build the increment",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: INTENTS.map((id) => ({ id, description: id, required: true })),
    repositoryEvidence: paths.map((path) => ({
      id: evidenceId(path),
      kind: "path",
      reference: path,
      observation: `Existing ${path}`,
      confidence: 1
    })),
    root: {
      key: "root",
      kind: "composite",
      title: "root",
      objective: "Deliver the increment",
      concerns: ["root"],
      expectedOutcomes: ["the increment works"],
      acceptanceIntentIds: allCriteria,
      evidenceIds: [],
      cut: { criterion: "cohesion", rationale: "root has semantic children" },
      children
    },
    ...(options.asSeams === true
      ? { candidateSeams: relations.map((relation) => ({ ...relation, kind: "api", specification: "Agreed interface" })) }
      : {
        candidateArtifacts: relations.map((relation) => ({
          ...relation,
          artifactType: "module",
          purpose: "Hand work to the consumer",
          materializationHint: "files"
        }))
      })
  }) as WorkBreakdown;

  return { breakdown, snapshot: snapshot(Object.fromEntries(paths.map((path, index) => [path, byteSizes[index]!]))) };
}

function leaf(key: string, path: string, acceptanceIntentIds: string[]): WorkUnit {
  return {
    key,
    kind: "leaf",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    expectedOutcomes: [`${key} works`],
    acceptanceIntentIds,
    evidenceIds: [evidenceId(path)],
    plannedPaths: [path]
  };
}

function evidenceId(path: string): string {
  return `path-${path.replace(/[^A-Za-z0-9]/gu, "-")}`;
}

function snapshot(byteSizeByPath: Record<string, number>): RepositorySnapshot {
  const files = Object.entries(byteSizeByPath).map(([path, byteSize]) => ({
    path,
    kind: "source" as const,
    contentHash: "a".repeat(64),
    byteSize,
    lineCount: Math.max(1, Math.ceil(byteSize / 40)),
    exportedSymbols: [],
    importedSymbols: [],
    declaredSymbols: []
  }));
  return {
    schemaVersion: 1,
    snapshotId: "snapshot-1",
    repositoryId: "demo",
    rootPath: "C:/demo",
    targetFingerprint: "target-1",
    baseCommit: "a".repeat(40),
    indexSchemaVersion: 1,
    capturedAt: "2026-08-11T00:00:00.000Z",
    inspectionDisposition: "complete",
    capabilities: { scripts: {}, baselineCommands: [], languages: [], stack: [] },
    diagnostics: [],
    indexHash: "index-hash",
    index: {
      repositoryId: "demo",
      rootPath: "C:/demo",
      indexedAt: "2026-08-11T00:00:00.000Z",
      files,
      symbols: [],
      imports: [],
      exports: [],
      diagnostics: [],
      metadata: {
        indexer: "test", deterministic: true, fileCount: files.length,
        symbolCount: 0, importCount: 0, exportCount: 0
      }
    }
  } as RepositorySnapshot;
}
