import { describe, expect, it } from "vitest";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  allocateAcceptanceIntents,
  compileContractBundles,
  PILOT_UTILITY_POLICY,
  selectGranularityStrategy,
  WorkBreakdownSchema,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";

describe("acceptance intent allocation", () => {
  it("compiles each user intent once across A, B and C while keeping every node validatable", () => {
    const breakdown = fiveIntentBreakdown();
    const repositorySnapshot = snapshot();

    for (const condition of ["A", "B", "C"] as const) {
      const selected = selectGranularityStrategy({
        condition,
        breakdown,
        repositorySnapshot,
        config: PILOT_UTILITY_POLICY
      }).selectedBreakdown;
      const compiled = compileContractBundles({
        breakdown: selected,
        repositorySnapshot,
        nodeIdByUnitKey: nodeIds(selected.root)
      }, dependencies);
      const userDescriptions = new Set(breakdown.acceptanceIntents.map((intent) => intent.description));
      const userCriteria = compiled.bundles.flatMap((bundle) =>
        bundle.task.acceptanceCriteria.filter((criterion) => userDescriptions.has(criterion.description))
      );

      expect(userCriteria, condition).toHaveLength(5);
      expect(new Set(userCriteria.map((criterion) => criterion.description)).size, condition).toBe(5);
      expect(compiled.bundles.every((bundle) => bundle.task.acceptanceCriteria.length >= 1), condition).toBe(true);
      expect(compiled.bundles.every((bundle) => bundle.validation.obligations.length >= 1), condition).toBe(true);
      expect(Object.keys(compiled.acceptanceOwnerByIntentId), condition).toHaveLength(5);
    }
  });

  it("owns a shared intent at the lowest common ancestor and an exclusive intent at its leaf", () => {
    const root: WorkUnit = composite("root", [
      leaf("left", "src/left.ts", ["shared", "left-only"]),
      leaf("right", "src/right.ts", ["shared"])
    ], ["shared", "left-only"]);

    expect(allocateAcceptanceIntents(root)).toEqual({
      "left-only": "left",
      shared: "root"
    });
  });

  it("does not synthesize shared relevance from a unit-level test reference", () => {
    const breakdown = fiveIntentBreakdown();
    breakdown.repositoryEvidence.push({
      id: "test-inventory",
      kind: "path",
      reference: "tests/inventory.test.ts",
      observation: "Inventory criterion tests",
      confidence: 1
    });
    const inventory = breakdown.root.kind === "composite"
      ? breakdown.root.children.find((unit) => unit.key === "inventory")
      : undefined;
    inventory?.evidenceIds.push("test-inventory");

    const compiled = compileContractBundles({
      breakdown,
      repositorySnapshot: snapshot(),
      nodeIdByUnitKey: nodeIds(breakdown.root)
    }, dependencies);
    const bundle = compiled.bundles.find((candidate) => candidate.task.nodeId === "node-inventory")!;
    expect(bundle.task.acceptanceCriteria).toHaveLength(2);
    expect(bundle.validation.obligations.map((obligation) => obligation.evidence)).toEqual([
      undefined,
      undefined
    ]);
  });

  it("compiles an exact focused test reference for a unit with one criterion", () => {
    const breakdown = fiveIntentBreakdown();
    breakdown.repositoryEvidence.push({
      id: "test-web",
      kind: "path",
      reference: "tests/web.test.ts",
      observation: "Web criterion test",
      confidence: 1
    });
    const web = breakdown.root.kind === "composite"
      ? breakdown.root.children.find((unit) => unit.key === "web")
      : undefined;
    web?.evidenceIds.push("test-web");

    const compiled = compileContractBundles({
      breakdown,
      repositorySnapshot: snapshot(),
      nodeIdByUnitKey: nodeIds(breakdown.root)
    }, dependencies);
    const bundle = compiled.bundles.find((candidate) => candidate.task.nodeId === "node-web")!;

    expect(bundle.validation.obligations[0]?.evidence).toEqual({
      kind: "focused_command",
      selectors: ["tests/web.test.ts"],
      references: ["tests/web.test.ts"]
    });
  });

  it("does not treat a test directory glob as an exact focused reference", () => {
    const breakdown = fiveIntentBreakdown();
    breakdown.repositoryEvidence.push({
      id: "test-web-glob",
      kind: "path",
      reference: "tests/**",
      observation: "Broad test directory",
      confidence: 1
    });
    const web = breakdown.root.kind === "composite"
      ? breakdown.root.children.find((unit) => unit.key === "web")
      : undefined;
    web?.evidenceIds.push("test-web-glob");

    const compiled = compileContractBundles({
      breakdown,
      repositorySnapshot: snapshot(),
      nodeIdByUnitKey: nodeIds(breakdown.root)
    }, dependencies);
    const bundle = compiled.bundles.find((candidate) => candidate.task.nodeId === "node-web")!;

    expect(bundle.validation.obligations[0]?.evidence).toBeUndefined();
  });
});

const dependencies = {
  idFor: (kind: string, key: string) => `${kind}-${key}`.replace(/[^A-Za-z0-9._:-]/gu, "-")
};

function fiveIntentBreakdown(): WorkBreakdown {
  const root = composite("root", [
    leaf("inventory", "src/inventory.ts", ["intent-1", "intent-2"]),
    leaf("orders", "src/orders.ts", ["intent-3", "intent-4"]),
    leaf("web", "src/web.ts", ["intent-5"])
  ], ["intent-1", "intent-2", "intent-3", "intent-4", "intent-5"]);
  return WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: "acceptance-allocation",
    objective: "Deliver warehouse slice",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: [1, 2, 3, 4, 5].map((number) => ({
      id: `intent-${number}`,
      description: `User criterion ${number}`,
      required: true
    })),
    repositoryEvidence: ["inventory", "orders", "web"].map((name) => ({
      id: `path-${name}`,
      kind: "path",
      reference: `src/${name}.ts`,
      observation: `${name} module`,
      confidence: 1
    })),
    root
  });
}

function leaf(key: string, path: string, acceptanceIntentIds: string[]): WorkUnit {
  return {
    key,
    kind: "leaf",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    expectedOutcomes: [`${key} local outcome`],
    acceptanceIntentIds,
    evidenceIds: [`path-${key}`]
  };
}

function composite(key: string, children: WorkUnit[], acceptanceIntentIds: string[]): WorkUnit {
  return {
    key,
    kind: "composite",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    expectedOutcomes: [`${key} integrated outcome`],
    acceptanceIntentIds,
    evidenceIds: [],
    cut: { criterion: "cohesion", rationale: "Independent warehouse capabilities" },
    children
  };
}

function nodeIds(root: WorkUnit): Record<string, string> {
  const output: Record<string, string> = {};
  const visit = (unit: WorkUnit): void => {
    output[unit.key] = `node-${unit.key}`;
    if (unit.kind === "composite") unit.children.forEach(visit);
  };
  visit(root);
  return output;
}

function snapshot(): RepositorySnapshot {
  const files = ["inventory", "orders", "web"].map((name) => ({
    path: `src/${name}.ts`,
    kind: "source" as const,
    contentHash: "a".repeat(64),
    byteSize: 8_000,
    lineCount: 200,
    exportedSymbols: [], importedSymbols: [], declaredSymbols: []
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
      repositoryId: "warehouse", rootPath: "C:/warehouse",
      indexedAt: "2026-07-24T00:00:00.000Z", files,
      symbols: [], imports: [], exports: [], diagnostics: [],
      metadata: {
        indexer: "test", deterministic: true, fileCount: files.length,
        symbolCount: 0, importCount: 0, exportCount: 0
      }
    }
  } as RepositorySnapshot;
}
