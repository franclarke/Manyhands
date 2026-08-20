import { describe, it, expect } from "vitest";
import { reviewCompiledPlan, type CompiledPlanReviewInput } from "@manyhands/decomposer";

function makeValidBundle(nodeId: string, allowedPaths: string[], coordinationPaths: string[] = []) {
  return {
    schemaVersion: 2 as const,
    task: {
      schemaVersion: 2 as const,
      id: `task-contract:${nodeId}`,
      revision: "task-r1",
      provenance: "compiled" as const,
      nodeId,
      goal: `Goal for ${nodeId}`,
      acceptanceCriteria: [
        {
          id: `criterion:${nodeId}`,
          kind: "integration" as const,
          description: "criterion",
          required: true
        }
      ],
      scope: { id: `scope:${nodeId}`, revision: "scope-r1" },
      consumes: [],
      produces: [{ id: `artifact:${nodeId}`, revision: "artifact-r1" }],
      seams: [],
      validation: { id: `validation:${nodeId}`, revision: "validation-r1" },
      constraints: []
    },
    scope: {
      schemaVersion: 2 as const,
      id: `scope:${nodeId}`,
      revision: "scope-r1",
      provenance: "compiled" as const,
      nodeId,
      allowedPaths,
      forbiddenPaths: [".env"],
      coordinationPaths
    },
    seams: [],
    artifacts: [
      {
        schemaVersion: 2 as const,
        id: `artifact:${nodeId}`,
        revision: "artifact-r1",
        provenance: "compiled" as const,
        producerNodeId: nodeId,
        consumerNodeIds: [],
        artifactType: "node-result",
        materialization: "files" as const,
        expectedPaths: allowedPaths
      }
    ],
    validation: {
      schemaVersion: 2 as const,
      id: `validation:${nodeId}`,
      revision: "validation-r1",
      provenance: "compiled" as const,
      nodeId,
      obligations: [
        {
          id: `obligation:${nodeId}`,
          criterionId: `criterion:${nodeId}`,
          layer: "integration" as const,
          severity: "required" as const,
          acceptableEvidence: ["test_result" as const],
          baselinePolicy: "required" as const,
          negativeControl: "when_feasible" as const,
          flakyPolicy: "forbid" as const
        }
      ]
    }
  };
}

function createMockInput(options: {
  indexedPaths?: string[];
  plannedPaths?: string[];
  contracts?: Array<{
    nodeId: string;
    allowedPaths: string[];
    coordinationPaths?: string[];
  }>;
  conflictConstraints?: Array<{ leftNodeId: string; rightNodeId: string }>;
}): CompiledPlanReviewInput {
  const rootUnit = {
    key: "root",
    kind: "leaf",
    plannedPaths: options.plannedPaths ?? [],
    children: [],
    acceptanceIntentIds: [],
    expectedOutcomes: ["dummy outcome"],
    concerns: ["dummy concern"],
    evidenceIds: []
  };

  const contractSpecs = options.contracts ?? [];
  const contracts = contractSpecs.map(c => makeValidBundle(c.nodeId, c.allowedPaths, c.coordinationPaths ?? []));

  const nodes: Record<string, unknown> = {};
  for (const c of contractSpecs) {
    nodes[c.nodeId] = { id: c.nodeId, parentId: "root", kind: "leaf", title: c.nodeId, goal: c.nodeId };
  }
  nodes["root"] = { id: "root", parentId: null, kind: "root", title: "root", goal: "root" };

  return {
    breakdown: {
      schemaVersion: 2,
      breakdownId: "b1",
      objective: "obj",
      repositorySnapshotId: "snap",
      acceptanceIntents: [],
      root: rootUnit as unknown as CompiledPlanReviewInput["breakdown"]["root"],
      candidateArtifacts: [],
      candidateSeams: [],
      repositoryEvidence: [],
      uncertainties: [],
      questions: []
    },
    repositorySnapshot: {
      schemaVersion: 1,
      snapshotId: "snap",
      repositoryId: "repo",
      rootPath: "/repo",
      targetFingerprint: "tfp",
      baseCommit: "commit1",
      indexSchemaVersion: 1,
      capturedAt: "2026-07-22T00:00:00Z",
      inspectionDisposition: "complete",
      capabilities: { packageManager: { name: "npm", evidence: "package.json" }, scripts: {}, baselineCommands: [], languages: [], stack: [] },
      diagnostics: [],
      indexHash: "hash",
      index: {
        repositoryId: "repo",
        rootPath: "/repo",
        indexedAt: "2026-07-22T00:00:00Z",
        files: (options.indexedPaths ?? []).map(p => ({ path: p, kind: "source", contentHash: "h", exportedSymbols: [], importedSymbols: [], declaredSymbols: [] })),
        symbols: [],
        imports: [],
        exports: [],
        diagnostics: [],
        metadata: { indexer: "test", deterministic: true, fileCount: (options.indexedPaths ?? []).length, symbolCount: 0, importCount: 0, exportCount: 0 }
      }
    } as unknown as CompiledPlanReviewInput["repositorySnapshot"],
    graph: {
      schemaVersion: 2,
      graphId: "g1",
      revision: 1,
      rootId: "root",
      baseCommit: "commit1",
      repositorySnapshotId: "snap",
      nodes,
      conflictConstraints: (options.conflictConstraints ?? []).map(cc => ({
        id: "cc-" + cc.leftNodeId + "-" + cc.rightNodeId,
        type: "ConflictConstraint",
        leftNodeId: cc.leftNodeId,
        rightNodeId: cc.rightNodeId,
        reason: "overlap",
        risk: "medium"
      })),
      artifactRequirements: [],
      seamBindings: [],
      legacyOrderingConstraints: [],
      createdAt: "2026-07-22T00:00:00Z"
    } as unknown as CompiledPlanReviewInput["graph"],
    contracts: contracts as unknown as CompiledPlanReviewInput["contracts"]
  };
}

describe("ScopeCritic Calibration (MH-REM-004)", () => {
  it("approves leaves with well-delimited scopes", () => {
    const input = createMockInput({
      indexedPaths: ["src/app.ts"],
      contracts: [
        { nodeId: "node1", allowedPaths: ["src/app.ts"] }
      ]
    });
    const review = reviewCompiledPlan(input);
    const scopeFindings = review.findings.filter(f => f.critic === "scope_isolation");
    expect(scopeFindings).toEqual([]);
  });

  it("normalizes Windows and POSIX paths for comparison", () => {
    const input = createMockInput({
      indexedPaths: ["src/file.ts"],
      contracts: [
        { nodeId: "nodeA", allowedPaths: ["src/file.ts"] },
        { nodeId: "nodeB", allowedPaths: ["src\\file.ts"] }
      ]
    });
    const review = reviewCompiledPlan(input);
    const scopeFindings = review.findings.filter(f => f.critic === "scope_isolation" && f.code === "unmodeled_scope_overlap");
    expect(scopeFindings.length).toBe(1);
    expect(scopeFindings[0]!.message).toContain("nodeA and nodeB overlap");
  });

  it("rejects modification overlap without conflictConstraint", () => {
    const input = createMockInput({
      indexedPaths: ["src/common.ts"],
      contracts: [
        { nodeId: "nodeA", allowedPaths: ["src/common.ts"] },
        { nodeId: "nodeB", allowedPaths: ["src/common.ts"] }
      ]
    });
    const review = reviewCompiledPlan(input);
    const scopeFindings = review.findings.filter(f => f.critic === "scope_isolation" && f.code === "unmodeled_scope_overlap");
    expect(scopeFindings.length).toBe(1);
  });

  it("allows modification overlap when conflictConstraint is present", () => {
    const input = createMockInput({
      indexedPaths: ["src/common.ts"],
      contracts: [
        { nodeId: "nodeA", allowedPaths: ["src/common.ts"] },
        { nodeId: "nodeB", allowedPaths: ["src/common.ts"] }
      ],
      conflictConstraints: [{ leftNodeId: "nodeA", rightNodeId: "nodeB" }]
    });
    const review = reviewCompiledPlan(input);
    const scopeFindings = review.findings.filter(f => f.critic === "scope_isolation" && f.code === "unmodeled_scope_overlap");
    expect(scopeFindings).toEqual([]);
  });

  it("detects scope path not grounded in repository snapshot", () => {
    const input = createMockInput({
      indexedPaths: ["src/existing.ts"],
      contracts: [
        { nodeId: "nodeA", allowedPaths: ["src/unreal.ts"] }
      ]
    });
    const review = reviewCompiledPlan(input);
    const ungrounded = review.findings.filter(f => f.code === "scope_path_not_grounded");
    expect(ungrounded.length).toBe(1);
  });
});
