import { describe, expect, it } from "vitest";
import {
  InMemoryThesisMetricsStore,
  ThesisMetricsCollector,
  compileAdaptiveWorkUnitTree,
  compressContext,
  evaluateIntrinsicComplexity,
  reviewGranularityProposal
} from "@manyhands/decomposer";

describe("adaptive granularity decomposer v3", () => {
  it("stops immediately at one leaf for a simple typo correction", () => {
    const compilation = compileAdaptiveWorkUnitTree({
      nodeId: "fix-typo",
      title: "Fix typo",
      goal: "Correct a typo in one message",
      targetScopePaths: ["packages/decomposer/src/index.ts"],
      complexity: {
        scopeRadius: 1,
        interfaceImpact: 0.5,
        validationSurface: 1,
        contextTokenMass: 0.5
      }
    });

    expect(compilation.root.kind).toBe("leaf");
    expect(compilation.units).toHaveLength(1);
    expect(compilation.assessments["fix-typo"]?.isLeaf).toBe(true);
  });

  it("builds adaptive sub-composites for a complex module", () => {
    const compilation = compileAdaptiveWorkUnitTree({
      nodeId: "complete-module",
      title: "Complete module",
      goal: "Implement a complete module across public API, runtime and validation",
      targetScopePaths: ["src/api.ts", "src/runtime.ts", "src/store.ts", "tests/module.test.ts"],
      complexity: {
        scopeRadius: 8,
        interfaceImpact: 8,
        validationSurface: 7,
        contextTokenMass: 8
      },
      proposedUnits: [
        {
          nodeId: "public-api",
          title: "Public API",
          goal: "Implement the public API",
          targetScopePaths: ["src/api.ts", "src/types.ts", "tests/api.test.ts", "tests/types.test.ts"],
          complexity: {
            scopeRadius: 6,
            interfaceImpact: 8,
            validationSurface: 6,
            contextTokenMass: 6
          }
        },
        {
          nodeId: "runtime",
          title: "Runtime",
          goal: "Implement runtime and storage behavior",
          targetScopePaths: ["src/runtime.ts", "src/store.ts"],
          complexity: {
            scopeRadius: 3,
            interfaceImpact: 3,
            validationSurface: 4,
            contextTokenMass: 4
          }
        }
      ]
    });

    expect(compilation.root.kind).toBe("composite");
    expect(compilation.assessments["complete-module"]?.recommendedBranchingFactor).toBeGreaterThanOrEqual(2);
    // Both proposals survive as the composite's children.
    expect(compilation.root.kind === "composite" && compilation.root.children.map((unit) => unit.key).sort())
      .toEqual(["public-api", "runtime"]);
    expect(compilation.units.some((unit) => unit.kind === "leaf")).toBe(true);
    // `public-api` is itself above the leaf threshold, but the Architect
    // proposed no sub-units for it, so the policy records the tension instead
    // of fabricating a decomposition it cannot justify.
    expect(compilation.criticDecisions.some((decision) => decision.kind === "resplit_declined")).toBe(true);
  });

  it("coalesces trivial sibling tasks that touch the same file", () => {
    const review = reviewGranularityProposal([
      {
        nodeId: "rename",
        title: "Rename symbol",
        goal: "Rename the local symbol",
        targetScopePaths: ["src/parser.ts"],
        expectedDependencies: [],
        complexity: {
          scopeRadius: 1,
          interfaceImpact: 1,
          validationSurface: 1,
          contextTokenMass: 1
        }
      },
      {
        nodeId: "fix-import",
        title: "Fix import",
        goal: "Update the matching import",
        targetScopePaths: ["src/parser.ts"],
        expectedDependencies: [],
        complexity: {
          scopeRadius: 1,
          interfaceImpact: 1,
          validationSurface: 1,
          contextTokenMass: 1
        }
      }
    ]);

    expect(review.units).toHaveLength(1);
    expect(review.units[0]?.nodeId).toBe("rename:fix-import");
    expect(review.units[0]?.forceComposite).toBe(false);
    expect(review.coalescedUnitsCount).toBe(1);
  });

  it("forces re-splitting when an apparent leaf spans more than three modules", () => {
    const review = reviewGranularityProposal([
      {
        nodeId: "wide-leaf",
        title: "Wide leaf",
        goal: "Touch four otherwise simple modules",
        targetScopePaths: ["a/index.ts", "b/index.ts", "c/index.ts", "d/index.ts"],
        complexity: {
          scopeRadius: 4,
          interfaceImpact: 0,
          validationSurface: 0,
          contextTokenMass: 0
        }
      }
    ]);

    expect(review.units[0]?.assessment.isLeaf).toBe(true);
    expect(review.units[0]?.forceComposite).toBe(true);
    expect(review.decisions).toContainEqual(expect.objectContaining({ kind: "resplit_required" }));
  });

  it("compresses scope, signatures and immutable inputs deterministically", () => {
    const scope = {
      schemaVersion: 2 as const,
      id: "scope-1",
      revision: "revision-1",
      provenance: "compiled" as const,
      nodeId: "node-1",
      allowedPaths: ["src/**"],
      forbiddenPaths: [],
      coordinationPaths: []
    };
    const compressed = compressContext({
      scope,
      files: [
        {
          path: "src/api.ts",
          content: "export interface User { id: string }\nexport function load(id: string) { return { id }; }\nconst secret = 1;"
        },
        { path: "private/secret.ts", content: "export const secret = true;" }
      ],
      inputs: { baseCommit: "abc", contractRevision: "revision-1" }
    });

    expect(compressed.files.map((file) => file.path)).toEqual(["src/api.ts"]);
    expect(compressed.interfaceSignatures).toContain("export interface User");
    expect(compressed.interfaceSignatures).toContain("export function load(id: string);");
    expect(compressed.interfaceSignatures).not.toContain("return { id }");
    expect(compressed.inputFingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(compressContext({
      scope,
      files: [...compressed.files],
      inputs: { contractRevision: "revision-1", baseCommit: "abc" }
    }).inputFingerprint).toBe(compressed.inputFingerprint);
  });

  it("persists thesis metrics per run", async () => {
    const store = new InMemoryThesisMetricsStore();
    const collector = new ThesisMetricsCollector(store);
    const assessment = evaluateIntrinsicComplexity({
      nodeId: "leaf",
      scopeRadius: 1,
      interfaceImpact: 1,
      validationSurface: 1,
      contextTokenMass: 1
    });

    const metrics = await collector.collect({
      runId: "run-1",
      executionTimeSeconds: 10,
      tokenCost: 2,
      coalescedUnitsCount: 1,
      nodes: [
        { nodeId: "root", parentId: null, complexityScore: 8, isLeaf: false, successful: true },
        { nodeId: "leaf", parentId: "root", complexityScore: assessment.complexityScore, isLeaf: true, successful: true }
      ]
    });

    expect(metrics.granularityEfficiencyIndex).toBe(5);
    expect(metrics.maxGraphDepth).toBe(1);
    expect(metrics.averageBranchingFactor).toBe(1);
    expect(store.get("run-1")).toEqual(metrics);
  });
});
