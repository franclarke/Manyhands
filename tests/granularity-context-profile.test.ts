import { describe, expect, it } from "vitest";
import type { RepositorySnapshot } from "@manyhands/repository-index";
import {
  CONTEXT_ESTIMATOR_VERSION,
  buildRepositoryContextProfiles,
  WorkBreakdownSchema,
  type WorkBreakdown,
  type WorkUnit
} from "@manyhands/decomposer";

describe("repository context profiles", () => {
  it("measures indexed UTF-8 bytes and keeps planned paths explicitly uncertain", () => {
    const breakdown = breakdownWith(leaf("inventory", {
      evidenceIds: ["path-inventory"],
      plannedPaths: ["src/new-api.ts", "tests/new-api.test.ts"]
    }));

    const profiles = buildRepositoryContextProfiles({
      breakdown,
      repositorySnapshot: snapshot([
        file("src/inventory.ts", { byteSize: 400, lineCount: 20 })
      ])
    });

    expect(profiles.inventory).toMatchObject({
      estimatorVersion: CONTEXT_ESTIMATOR_VERSION,
      scopePaths: ["src/inventory.ts", "src/new-api.ts", "tests/new-api.test.ts"],
      measuredExistingBytes: 400,
      measuredExistingTokens: 100,
      measuredExistingPathCount: 1,
      unmeasuredExistingPathCount: 0,
      plannedPathCount: 2,
      unmeasuredPlannedPathCount: 2,
      uncertainty: 0.6667
    });
    expect(profiles.inventory?.evidenceRefs).toEqual(["path-inventory", "snapshot-1"]);
  });

  it("treats historical index entries without byte size as unmeasured", () => {
    const breakdown = breakdownWith(leaf("historical", { evidenceIds: ["path-inventory"] }));

    const profiles = buildRepositoryContextProfiles({
      breakdown,
      repositorySnapshot: snapshot([file("src/inventory.ts")])
    });

    expect(profiles.historical).toMatchObject({
      measuredExistingBytes: 0,
      measuredExistingTokens: 0,
      measuredExistingPathCount: 0,
      unmeasuredExistingPathCount: 1,
      uncertainty: 1
    });
  });

  it("aggregates descendant paths for a composite leaf alternative", () => {
    const root: WorkUnit = {
      key: "root",
      kind: "composite",
      title: "Warehouse increment",
      objective: "Deliver inventory and API",
      concerns: ["warehouse"],
      expectedOutcomes: ["Increment works"],
      acceptanceIntentIds: ["intent-1"],
      evidenceIds: [],
      cut: { criterion: "cohesion", rationale: "Domain and API are separable" },
      children: [
        leaf("domain", { evidenceIds: ["path-inventory"] }),
        leaf("api", { plannedPaths: ["src/api.ts"] })
      ]
    };

    const profiles = buildRepositoryContextProfiles({
      breakdown: breakdownWith(root),
      repositorySnapshot: snapshot([
        file("src/inventory.ts", { byteSize: 800, lineCount: 40 })
      ])
    });

    expect(profiles.root).toMatchObject({
      scopePaths: ["src/api.ts", "src/inventory.ts"],
      measuredExistingTokens: 200,
      plannedPathCount: 1,
      uncertainty: 0.5
    });
    expect(profiles.domain?.scopePaths).toEqual(["src/inventory.ts"]);
    expect(profiles.api?.scopePaths).toEqual(["src/api.ts"]);
  });

  it("marks unavailable snapshots as fully uncertain without throwing", () => {
    const profiles = buildRepositoryContextProfiles({
      breakdown: breakdownWith(leaf("unknown", { evidenceIds: ["path-inventory"] })),
      repositorySnapshot: {
        ...snapshot([]),
        inspectionDisposition: "unavailable",
        index: undefined,
        indexHash: undefined
      }
    });

    expect(profiles.unknown).toMatchObject({
      measuredExistingBytes: 0,
      unmeasuredExistingPathCount: 1,
      uncertainty: 1,
      snapshotDisposition: "unavailable"
    });
  });
});

function breakdownWith(root: WorkUnit): WorkBreakdown {
  return WorkBreakdownSchema.parse({
    schemaVersion: 2,
    breakdownId: "breakdown-context",
    objective: "Build warehouse increment",
    repositorySnapshotId: "snapshot-1",
    acceptanceIntents: [{ id: "intent-1", description: "Increment works", required: true }],
    repositoryEvidence: [
      {
        id: "path-inventory",
        kind: "path",
        reference: "src/inventory.ts",
        observation: "Inventory implementation",
        confidence: 1
      }
    ],
    root
  });
}

function leaf(
  key: string,
  input: { evidenceIds?: string[]; plannedPaths?: string[] }
): WorkUnit {
  return {
    key,
    kind: "leaf",
    title: key,
    objective: `Implement ${key}`,
    concerns: [key],
    expectedOutcomes: [`${key} works`],
    acceptanceIntentIds: ["intent-1"],
    evidenceIds: input.evidenceIds ?? [],
    ...(input.plannedPaths === undefined ? {} : { plannedPaths: input.plannedPaths })
  };
}

function file(
  path: string,
  metrics: { byteSize?: number; lineCount?: number } = {}
): NonNullable<RepositorySnapshot["index"]>["files"][number] {
  return {
    path,
    kind: "source",
    contentHash: "a".repeat(64),
    exportedSymbols: [],
    importedSymbols: [],
    declaredSymbols: [],
    ...metrics
  };
}

function snapshot(files: NonNullable<RepositorySnapshot["index"]>["files"]): RepositorySnapshot {
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
    capabilities: {
      scripts: {},
      baselineCommands: [],
      languages: [],
      stack: []
    },
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
        indexer: "test",
        deterministic: true,
        fileCount: files.length,
        symbolCount: 0,
        importCount: 0,
        exportCount: 0
      }
    }
  } as RepositorySnapshot;
}
