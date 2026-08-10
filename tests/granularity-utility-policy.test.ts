import { describe, expect, it } from "vitest";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  ADAPTIVE_UTILITY_POLICY_VERSION,
  PILOT_UTILITY_POLICY,
  selectGranularityStrategy,
  WorkBreakdownSchema,
  type UtilityPolicyConfig,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";

describe("C utility strategy selection", () => {
  it("keeps a viable small task as one leaf", () => {
    const breakdown = candidate(leaf("small", ["src/small.ts"], ["intent-a"]));

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({ "src/small.ts": 400 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(result.requiresSemanticReplan).toBe(false);
    expect(result.selectedBreakdown.root.kind).toBe("leaf");
    expect(result.assessments.small).toMatchObject({ selected: "leaf", leafFeasible: true });
  });

  it("selects independent children when parallelism and isolation outweigh cost", () => {
    const breakdown = candidate(composite("root", [
      leaf("domain", ["src/domain.ts"], ["intent-a"]),
      leaf("web", ["src/web.ts"], ["intent-b"])
    ], ["intent-a", "intent-b"]));

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({ "src/domain.ts": 4_000, "src/web.ts": 4_000 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.selectedBreakdown.root.kind).toBe("composite");
    expect(result.assessments.root?.selected).toBe("split");
    // 2000 tokens split into two of 1000 relieves a twelfth of one leaf's
    // budget: real, and correctly negligible. What carries this cut is that the
    // children neither order nor invalidate each other.
    expect(result.assessments.root?.features.contextRelief).toBe(0.0417);
    expect(result.assessments.root?.features.parallelism).toBe(1);
    expect(result.assessments.root?.features.faultIsolation).toBe(1);
    expect(result.assessments.root?.splitAdvantage).toBeGreaterThanOrEqual(0.15);
  });

  it("preserves a required root-only intent at the integration composite", () => {
    const breakdown = WorkBreakdownSchema.parse({
      schemaVersion: 2,
      breakdownId: "root-only-intent",
      objective: "Deliver independent modules",
      repositorySnapshotId: "snapshot-1",
      acceptanceIntents: [
        { id: "intent-root-only", description: "Integrated constraints hold", required: true },
        { id: "intent-a", description: "Module A works", required: true },
        { id: "intent-b", description: "Module B works", required: true }
      ],
      repositoryEvidence: [
        { id: "path-src-a-ts", kind: "path", reference: "src/a.ts", observation: "Module A", confidence: 1 },
        { id: "path-src-b-ts", kind: "path", reference: "src/b.ts", observation: "Module B", confidence: 1 }
      ],
      root: attachEvidence(composite("root", [
        leaf("a", ["src/a.ts"], ["intent-a"]),
        leaf("b", ["src/b.ts"], ["intent-b"])
      ], ["intent-root-only"]))
    });

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({ "src/a.ts": 4_000, "src/b.ts": 4_000 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.selectedBreakdown.root.kind).toBe("composite");
    if (result.selectedBreakdown.root.kind !== "composite") throw new Error("expected split root");
    expect(result.selectedBreakdown.root.acceptanceIntentIds).toEqual(["intent-root-only"]);
    expect(result.selectedBreakdown.root.children.map((unit) => unit.acceptanceIntentIds)).toEqual([
      ["intent-a"],
      ["intent-b"]
    ]);
  });

  it("keeps overlapping tightly coordinated siblings together", () => {
    const breakdown = candidate(
      composite("root", [
        leaf("edit-a", ["src/shared.ts"], ["intent-a"]),
        leaf("edit-b", ["src/shared.ts"], ["intent-a"])
      ], ["intent-a"]),
      {
        candidateSeams: [{
          id: "shared-api",
          kind: "api",
          specification: "Both edits bind the same API",
          producerUnitKey: "edit-a",
          consumerUnitKeys: ["edit-b"],
          evidenceIds: ["path-src-shared-ts"]
        }]
      }
    );

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({ "src/shared.ts": 4_000 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.selectedBreakdown.root.kind).toBe("leaf");
    expect(result.assessments.root?.selected).toBe("leaf");
    // Two units editing the same file are held together by the file they both
    // claim and by the criterion neither owns alone — not by the seam, which
    // compiles to no requirement and orders nothing.
    expect(result.assessments.root?.features.pathOverlap).toBe(1);
    expect(result.assessments.root?.features.faultIsolation).toBe(0);
    expect(result.assessments.root?.features.coordination).toBe(0);
    expect(result.selectedBreakdown.candidateSeams).toEqual([]);
  });

  it("does not treat a unary proposal as a split and requests semantic replan when leaf is infeasible", () => {
    const breakdown = candidate(composite("root", [
      leaf("only-child", ["src/large.ts"], ["intent-a"])
    ], ["intent-a"]));

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({ "src/large.ts": 20_000 }),
      config: { ...PILOT_UTILITY_POLICY, maxLeafContextTokens: 1_000 }
    });

    expect(result.requiresSemanticReplan).toBe(true);
    expect(result.assessments.root).toMatchObject({
      selected: "semantic_replan",
      leafFeasible: false,
      splitViable: false
    });
    expect(keys(result.selectedBreakdown.root)).toEqual(["root", "only-child"]);
  });

  /**
   * Warehouse pilot W2 is the case this exists for. After W1 the repository was
   * small, so the root read almost nothing and was judged a feasible leaf — but
   * it had to CREATE an entire Vite/React application. The Architect had offered
   * a three-way cut; the policy collapsed it on a -0.2576 advantage, and the
   * merged leaf then burned a thirty-minute budget without delivering.
   *
   * Feasibility measured only what a unit must read. A unit is equally
   * infeasible when it must produce more than one budgeted attempt can produce,
   * and `plannedPathCount` already measures exactly that.
   */
  it("refuses a leaf that must create more than one attempt can produce", () => {
    const created = Array.from({ length: 24 }, (_, index) => `src/app/created-${index}.ts`);
    const breakdown = candidate(composite("root", [
      leaf("app", created.slice(0, 12), ["intent-a"]),
      leaf("probe", created.slice(12), ["intent-b"])
    ], ["intent-a", "intent-b"]));

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      // Nothing exists yet: reading is free, producing is not.
      repositorySnapshot: snapshot({}),
      config: { ...PILOT_UTILITY_POLICY, maxLeafPlannedPaths: 12 }
    });

    expect(result.assessments.root.leafFeasible).toBe(false);
    expect(result.assessments.root.selected).not.toBe("leaf");
  });

  it("still allows a leaf whose production stays inside the budget", () => {
    const breakdown = candidate(composite("root", [
      leaf("only", ["src/a.ts", "src/b.ts"], ["intent-a"])
    ], ["intent-a"]));

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({}),
      config: { ...PILOT_UTILITY_POLICY, maxLeafPlannedPaths: 12 }
    });

    expect(result.assessments.root.leafFeasible).toBe(true);
  });

  it("can expand one branch while retaining another as a cohesive leaf", () => {
    const breakdown = candidate(composite("root", [
      composite("domain", [
        leaf("domain-a", ["src/domain-a.ts"], ["intent-a"]),
        leaf("domain-b", ["src/domain-b.ts"], ["intent-a"])
      ], ["intent-a"]),
      composite("realtime", [
        leaf("api", ["src/api.ts"], ["intent-b"]),
        leaf("web", ["src/web.ts"], ["intent-c"])
      ], ["intent-b", "intent-c"])
    ], ["intent-a", "intent-b", "intent-c"]));

    const result = selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({
        "src/domain-a.ts": 400,
        "src/domain-b.ts": 400,
        "src/api.ts": 8_000,
        "src/web.ts": 8_000
      }),
      config: { ...PILOT_UTILITY_POLICY, minimumAdvantage: 0.4 }
    });

    const selectedRoot = result.selectedBreakdown.root;
    expect(selectedRoot.kind).toBe("composite");
    if (selectedRoot.kind !== "composite") throw new Error("expected composite root");
    expect(selectedRoot.children.find((unit) => unit.key === "domain")?.kind).toBe("leaf");
    expect(selectedRoot.children.find((unit) => unit.key === "realtime")?.kind).toBe("composite");
  });

  it("defines A as one root leaf and B as the finest valid semantic frontier", () => {
    const breakdown = candidate(composite("root", [
      leaf("domain", ["src/domain.ts"], ["intent-a"]),
      composite("web", [
        leaf("view", ["src/view.ts"], ["intent-b"]),
        leaf("stream", ["src/stream.ts"], ["intent-c"])
      ], ["intent-b", "intent-c"])
    ], ["intent-a", "intent-b", "intent-c"]));
    const repositorySnapshot = snapshot({
      "src/domain.ts": 400,
      "src/view.ts": 400,
      "src/stream.ts": 400
    });

    const conditionA = selectGranularityStrategy({
      condition: "A", breakdown, repositorySnapshot, config: PILOT_UTILITY_POLICY
    });
    const conditionB = selectGranularityStrategy({
      condition: "B", breakdown, repositorySnapshot, config: PILOT_UTILITY_POLICY
    });

    expect(conditionA.selectedBreakdown.root.kind).toBe("leaf");
    expect(keys(conditionA.selectedBreakdown.root)).toEqual(["root"]);
    expect(keys(conditionB.selectedBreakdown.root)).toEqual(["root", "domain", "web", "view", "stream"]);
    expect(conditionB.assessments.web?.selected).toBe("split");
  });

  it("is deterministic and never invents semantic keys or paths", () => {
    const breakdown = candidate(composite("root", [
      leaf("a", ["src/a.ts"], ["intent-a"]),
      leaf("b", ["src/b.ts"], ["intent-b"])
    ], ["intent-a", "intent-b"]));
    const input = {
      condition: "C" as const,
      breakdown,
      repositorySnapshot: snapshot({ "src/a.ts": 4_000, "src/b.ts": 4_000 }),
      config: PILOT_UTILITY_POLICY
    };

    const first = selectGranularityStrategy(input);
    const second = selectGranularityStrategy(input);

    expect(second).toEqual(first);
    expect(first.candidateTreeHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(new Set(keys(first.selectedBreakdown.root))).toEqual(new Set(keys(breakdown.root)));
    expect(allPaths(first.selectedBreakdown.root).every((path) => allPaths(breakdown.root).includes(path))).toBe(true);
  });

  it("rejects invalid policy configuration", () => {
    const breakdown = candidate(leaf("small", ["src/small.ts"], ["intent-a"]));
    const invalid = { ...PILOT_UTILITY_POLICY, minimumAdvantage: Number.NaN } as UtilityPolicyConfig;

    expect(() => selectGranularityStrategy({
      condition: "C",
      breakdown,
      repositorySnapshot: snapshot({ "src/small.ts": 400 }),
      config: invalid
    })).toThrow(/minimumAdvantage must be a finite number/u);
  });
});

/**
 * Warehouse pilot W2 is why these two terms are measured, and measured this way.
 *
 * The Architect proposed a three-way cut of an entire Vite/React control tower.
 * The policy collapsed it and the merged leaf burned a thirty-minute budget
 * without delivering. The recorded root assessment reported `parallelism: 0` and
 * `coordination: 1` — the two extremes at once — for a cut of three largely
 * independent units.
 *
 * Neither number described the cut. Both were artifacts of how they were
 * computed:
 *
 *  - `1 - edges / (children - 1)` divides by the edge count of a spanning tree,
 *    which is the MINIMUM any connected cut can have. So every connected cut
 *    scored zero, and a fan-out — where every consumer can proceed at once after
 *    one producer — was indistinguishable from a strict chain, where nothing can.
 *
 *  - `edges / children` charged a connected cut at least `(n-1)/n` and rose
 *    toward 1 as the cut grew. The cleaner and larger the decomposition, the more
 *    coordination it was charged for.
 *
 * Together they gave a structural bias against exactly the shape layered
 * software takes: domain, then interface, then instrumentation.
 */
describe("C policy — concurrency and coupling of a cut", () => {
  it("credits the concurrency a cut has, not the edges it has", () => {
    const chain = assessRoot(cutOf(4, [[0, 1], [1, 2], [2, 3]]));
    const fanOut = assessRoot(cutOf(4, [[0, 1], [0, 2], [0, 3]]));
    const independent = assessRoot(cutOf(4, []));

    // Both cuts have three edges. Only one of them can run three units at once.
    expect(chain.features.parallelism).toBe(0);
    expect(fanOut.features.parallelism).toBe(0.6667);
    expect(independent.features.parallelism).toBe(1);
  });

  it("measures concurrency on production order alone, since a seam is agreed before either side is written", () => {
    const throughArtifacts = assessRoot(cutOf(3, [[0, 1], [1, 2]]));
    const throughSeams = assessRoot(cutOf(3, [[0, 1], [1, 2]], { asSeams: true }));

    expect(throughArtifacts.features.parallelism).toBe(0);
    expect(throughSeams.features.parallelism).toBe(1);
  });

  it("does not charge coordination for a dependency another already implies", () => {
    const chain = assessRoot(cutOf(4, [[0, 1], [1, 2], [2, 3]]));
    // The same order, with every implied edge also declared.
    const transitive = assessRoot(cutOf(4, [
      [0, 1], [1, 2], [2, 3], [0, 2], [0, 3], [1, 3]
    ]));

    expect(transitive.features.coordination).toBe(chain.features.coordination);
  });

  it("charges coupling density, so a clean cut does not cost more for being larger", () => {
    const four = assessRoot(cutOf(4, [[0, 1], [1, 2], [2, 3]]));
    const eight = assessRoot(cutOf(8, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]]));
    const coupled = assessRoot(cutOf(4, [[0, 2], [0, 3], [1, 2], [1, 3]]));

    expect(four.features.coordination).toBe(0.5);
    expect(eight.features.coordination).toBe(0.25);
    expect(coupled.features.coordination).toBeGreaterThan(four.features.coordination);
  });

  it("treats a cut its own dependencies cannot schedule as unschedulable", () => {
    const cyclic = assessRoot(cutOf(3, [[0, 1], [1, 2], [2, 0]]));

    expect(cyclic.features.parallelism).toBe(0);
    expect(cyclic.features.coordination).toBe(1);
  });
});

/**
 * Context relief is what a cut removes from the execution budget, not how the
 * planner happened to distribute files.
 *
 * The final experiment measured `1 - maxChildTokens / parentTokens` on a target
 * whose entire source is 999 tokens — 4% of `maxLeafContextTokens`. The two
 * repetitions of the same multi-layer task scored 0.5075 and 0.0671, and that
 * difference alone was 100% of the gap between `split` and `leaf`. The term was
 * reading file distribution as if it were context pressure, on a repository
 * where no context pressure exists.
 *
 * Anchoring to the budget makes the term say what it is named after: how much of
 * the parent's overflow the cut actually removes.
 */
describe("C policy — context relief is measured against the execution budget", () => {
  it("credits no relief when the whole unit already fits the budget", () => {
    // Three children of 100 tokens each: 1.25% of the budget between them.
    const assessment = assessRoot(cutWithSizes([400, 400, 400]));

    expect(assessment.features.contextRelief).toBeLessThan(0.05);
  });

  it("credits relief in proportion to the overflow the cut removes", () => {
    // Parent at 2x the budget, best child at half of it.
    const assessment = assessRoot(cutWithSizes([64_000, 64_000, 64_000]));

    expect(assessment.features.contextRelief).toBeGreaterThan(0.9);
  });

  it("does not change its verdict because the same files were distributed differently", () => {
    const even = assessRoot(cutWithSizes([400, 400, 400]));
    const skewed = assessRoot(cutWithSizes([1120, 40, 40]));

    expect(Math.abs(even.features.contextRelief - skewed.features.contextRelief)).toBeLessThan(0.05);
  });
});

/**
 * The policy prices the graph the compiler will actually build.
 *
 * `compileGraphRevision` creates an execution-blocking `ArtifactRequirement`
 * only for a candidate artifact whose materialization is not `logical`, and
 * `explainReadiness` blocks a consumer on those requirements alone. A seam
 * compiles to no requirement at all. Charging either of them as coordination
 * prices a constraint the scheduler will never impose — and made declaring an
 * interface contract strictly worsen the score of the cut that declared it.
 */
describe("C policy — coordination prices the relations that compile", () => {
  it("does not charge coordination for a seam, which compiles to no requirement", () => {
    const throughSeams = assessRoot(cutOf(3, [[0, 1], [1, 2]], { asSeams: true }));

    expect(throughSeams.features.coordination).toBe(0);
  });

  it("does not serialize on a logical artifact, which compiles to no requirement", () => {
    const logical = assessRoot(cutOf(3, [[0, 1], [1, 2]], { materialization: "logical" }));

    expect(logical.features.parallelism).toBe(1);
    expect(logical.features.coordination).toBe(0);
  });

  it("still serializes on a materialized artifact, which does block the consumer", () => {
    const materialized = assessRoot(cutOf(3, [[0, 1], [1, 2]]));

    expect(materialized.features.parallelism).toBe(0);
    expect(materialized.features.coordination).toBeGreaterThan(0);
  });
});

/**
 * Fault isolation admits a cut on its own.
 *
 * Averaging isolation with two other benefits dilutes a perfect result to a
 * third, so a cut whose children cannot invalidate each other's evidence could
 * still be collapsed for want of concurrency it was never going to have. Layered
 * work is the case: `domain -> application -> api` is a chain, so its
 * concurrency is genuinely zero, and on a small repository its context relief is
 * genuinely zero too. What splitting buys there is that a failure in one layer
 * does not void the verified evidence of another.
 *
 * The floor is 1 rather than a tuned value because only 1 has a meaning that is
 * not a magnitude: every child owns acceptance criteria no sibling shares.
 */
describe("C policy — perfect fault isolation admits a cut", () => {
  it("admits a viable cut whose children own disjoint acceptance criteria", () => {
    // A layered chain that also touches a common file: no concurrency, no
    // relief, and enough overlap that the aggregate falls short. Only the
    // disjoint ownership of criteria distinguishes it.
    const disjoint = assessRoot(cutWithSizes([400, 400, 400], {
      edges: [[0, 1], [1, 2]],
      sharedPath: true
    }));

    expect(disjoint.features.faultIsolation).toBe(1);
    expect(disjoint.splitAdvantage).toBeLessThan(disjoint.minimumAdvantage);
    expect(disjoint.selected).toBe("split");
  });

  it("does not admit a cut on isolation grounds when the children share criteria", () => {
    const shared = assessRoot(cutWithSizes([400, 400, 400], {
      edges: [[0, 1], [1, 2]],
      sharedIntent: true
    }));

    expect(shared.features.faultIsolation).toBeLessThan(1);
    expect(shared.selected).toBe("leaf");
  });
});

/** A one-level cut whose children own existing files of the given byte sizes. */
function cutWithSizes(
  byteSizes: readonly number[],
  options: {
    edges?: ReadonlyArray<readonly [number, number]>;
    sharedIntent?: boolean;
    sharedPath?: boolean;
  } = {}
) {
  const childKeys = byteSizes.map((_, index) => `child-${index}`);
  const paths = childKeys.map((key) => `src/${key}.ts`);
  const shared = options.sharedPath === true ? ["src/shared.ts"] : [];
  const children = childKeys.map((key, index) =>
    leaf(key, [paths[index]!, ...shared], options.sharedIntent === true
      ? [INTENTS[0]!, INTENTS[index % INTENTS.length]!]
      : [INTENTS[index % INTENTS.length]!])
  );
  const relations = (options.edges ?? []).map(([producer, consumer], index) => ({
    id: `relation-${index}`,
    producerUnitKey: childKeys[producer]!,
    consumerUnitKeys: [childKeys[consumer]!],
    evidenceIds: [],
    artifactType: "module",
    purpose: "Hand work to the consumer",
    materializationHint: "files" as const
  }));
  const breakdown = candidate(
    composite("root", children, [...new Set(children.flatMap((child) => child.acceptanceIntentIds))]),
    { candidateArtifacts: relations }
  );
  const sizes = Object.fromEntries([
    ...paths.map((path, index) => [path, byteSizes[index]!] as const),
    ...shared.map((path) => [path, 40] as const)
  ]);
  return { breakdown, snapshot: snapshot(sizes) };
}

function assessRoot(input: WorkBreakdown | { breakdown: WorkBreakdown; snapshot: RepositorySnapshot }) {
  const { breakdown, repositorySnapshot } = "breakdown" in input
    ? { breakdown: input.breakdown, repositorySnapshot: input.snapshot }
    : { breakdown: input, repositorySnapshot: snapshot({}) };
  const result = selectGranularityStrategy({
    condition: "C",
    breakdown,
    repositorySnapshot,
    config: PILOT_UTILITY_POLICY
  });
  const assessment = result.assessments.root;
  if (assessment === undefined) throw new Error("expected a root assessment");
  return assessment;
}

/** A one-level cut of `childCount` units wired by the given producer→consumer edges. */
function cutOf(
  childCount: number,
  edges: ReadonlyArray<readonly [number, number]>,
  options: { asSeams?: boolean; materialization?: "logical" | "files" } = {}
): WorkBreakdown {
  const childKeys = Array.from({ length: childCount }, (_, index) => `child-${index}`);
  const children = childKeys.map((key, index) =>
    leaf(key, [`src/${key}.ts`], [INTENTS[index % INTENTS.length]!])
  );
  const relations = edges.map(([producer, consumer], index) => ({
    id: `relation-${index}`,
    producerUnitKey: childKeys[producer]!,
    consumerUnitKeys: [childKeys[consumer]!],
    evidenceIds: []
  }));
  return candidate(
    composite("root", children, [...new Set(children.flatMap((child) => child.acceptanceIntentIds))]),
    options.asSeams === true
      ? {
        candidateSeams: relations.map((relation) => ({
          ...relation, kind: "api" as const, specification: "Agreed interface"
        }))
      }
      : {
        candidateArtifacts: relations.map((relation) => ({
          ...relation,
          artifactType: "module",
          purpose: "Hand work to the consumer",
          materializationHint: options.materialization ?? "files"
        }))
      }
  );
}

const INTENTS = [
  "intent-a", "intent-b", "intent-c", "intent-d",
  "intent-e", "intent-f", "intent-g", "intent-h"
];

function candidate(
  root: WorkUnit,
  extras: Partial<Pick<WorkBreakdown, "candidateArtifacts" | "candidateSeams">> = {}
): WorkBreakdown {
  const paths = [...new Set(allPaths(root))];
  return WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: "candidate-1",
    objective: "Build warehouse increment",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: INTENTS.map((id) => ({ id, description: id, required: true })),
    repositoryEvidence: paths.map((path) => ({
      id: evidenceId(path),
      kind: "path",
      reference: path,
      observation: `Existing ${path}`,
      confidence: 1
    })),
    root: attachEvidence(root),
    ...extras
  });
}

function leaf(key: string, paths: string[], acceptanceIntentIds: string[]): WorkUnit {
  return {
    key,
    kind: "leaf",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    expectedOutcomes: [`${key} works`],
    acceptanceIntentIds,
    evidenceIds: [],
    plannedPaths: paths
  };
}

function composite(
  key: string,
  children: WorkUnit[],
  acceptanceIntentIds: string[]
): WorkUnit {
  return {
    key,
    kind: "composite",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    expectedOutcomes: [`${key} works`],
    acceptanceIntentIds,
    evidenceIds: [],
    cut: { criterion: "cohesion", rationale: `${key} has semantic children` },
    children
  };
}

function attachEvidence(unit: WorkUnit): WorkUnit {
  if (unit.kind === "leaf") {
    const paths = unit.plannedPaths ?? [];
    return {
      ...unit,
      evidenceIds: paths.map(evidenceId)
    };
  }
  return { ...unit, children: unit.children.map(attachEvidence) };
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
    repositoryId: "warehouse",
    rootPath: "C:/warehouse",
    targetFingerprint: "target-1",
    baseCommit: "a".repeat(40),
    indexSchemaVersion: 1,
    capturedAt: "2026-07-24T00:00:00.000Z",
    inspectionDisposition: "complete",
    capabilities: { scripts: {}, baselineCommands: [], languages: [], stack: [] },
    diagnostics: [],
    indexHash: "index-hash",
    index: {
      repositoryId: "warehouse",
      rootPath: "C:/warehouse",
      indexedAt: "2026-07-24T00:00:00.000Z",
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

function keys(root: WorkUnit): string[] {
  return root.kind === "leaf" ? [root.key] : [root.key, ...root.children.flatMap(keys)];
}

function allPaths(root: WorkUnit): string[] {
  if (root.kind === "leaf") return root.plannedPaths ?? [];
  return [...(root.plannedPaths ?? []), ...root.children.flatMap(allPaths)];
}
