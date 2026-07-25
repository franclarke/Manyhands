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

describe("C2 utility strategy selection", () => {
  it("keeps a viable small task as one leaf", () => {
    const breakdown = candidate(leaf("small", ["src/small.ts"], ["intent-a"]));

    const result = selectGranularityStrategy({
      condition: "C2",
      breakdown,
      repositorySnapshot: snapshot({ "src/small.ts": 400 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.policyVersion).toBe(ADAPTIVE_UTILITY_POLICY_VERSION);
    expect(result.requiresSemanticReplan).toBe(false);
    expect(result.selectedBreakdown.root.kind).toBe("leaf");
    expect(result.assessments.small).toMatchObject({ selected: "leaf", leafFeasible: true });
  });

  it("selects independent children when context relief and parallelism outweigh cost", () => {
    const breakdown = candidate(composite("root", [
      leaf("domain", ["src/domain.ts"], ["intent-a"]),
      leaf("web", ["src/web.ts"], ["intent-b"])
    ], ["intent-a", "intent-b"]));

    const result = selectGranularityStrategy({
      condition: "C2",
      breakdown,
      repositorySnapshot: snapshot({ "src/domain.ts": 4_000, "src/web.ts": 4_000 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.selectedBreakdown.root.kind).toBe("composite");
    expect(result.assessments.root?.selected).toBe("split");
    expect(result.assessments.root?.features.contextRelief).toBe(0.5);
    expect(result.assessments.root?.features.parallelism).toBe(1);
    expect(result.assessments.root?.splitAdvantage).toBeGreaterThanOrEqual(0.15);
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
      condition: "C2",
      breakdown,
      repositorySnapshot: snapshot({ "src/shared.ts": 4_000 }),
      config: PILOT_UTILITY_POLICY
    });

    expect(result.selectedBreakdown.root.kind).toBe("leaf");
    expect(result.assessments.root?.selected).toBe("leaf");
    expect(result.assessments.root?.features.pathOverlap).toBe(1);
    expect(result.assessments.root?.features.coordination).toBeGreaterThan(0);
    expect(result.selectedBreakdown.candidateSeams).toEqual([]);
  });

  it("does not treat a unary proposal as a split and requests semantic replan when leaf is infeasible", () => {
    const breakdown = candidate(composite("root", [
      leaf("only-child", ["src/large.ts"], ["intent-a"])
    ], ["intent-a"]));

    const result = selectGranularityStrategy({
      condition: "C2",
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
      condition: "C2",
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
      condition: "C2" as const,
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
      condition: "C2",
      breakdown,
      repositorySnapshot: snapshot({ "src/small.ts": 400 }),
      config: invalid
    })).toThrow(/minimumAdvantage must be a finite number/u);
  });
});

const INTENTS = ["intent-a", "intent-b", "intent-c"];

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
