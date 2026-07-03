import { describe, expect, it } from "vitest";
import {
  DecomposerLlmOutputSchema,
  normalizeLlmDecomposition,
  type DecomposerLlmOutput
} from "@manyhands/decomposer";
import { validateTaskGraph } from "@manyhands/task-graph";

const validOutput: DecomposerLlmOutput = DecomposerLlmOutputSchema.parse({
  title: "Add login",
  summary: "Implement a passwordless login flow",
  assumptions: [],
  risks: [],
  nodes: [
    {
      id: "root",
      parentId: null,
      title: "Add login",
      goal: "Implement passwordless login end-to-end",
      kind: "composite",
      depth: 0,
      allowedPaths: ["src/**"],
      forbiddenPaths: [],
      expectedFiles: [],
      acceptanceCriteria: []
    },
    {
      id: "magic-link",
      parentId: "root",
      title: "Magic link issuance",
      goal: "Generate one-time tokens",
      kind: "leaf",
      depth: 1,
      objective: "Implement the magic link generation endpoint",
      allowedPaths: ["src/auth/**"],
      forbiddenPaths: ["src/db/migrations/**"],
      expectedFiles: ["src/auth/magic-link.ts"],
      acceptanceCriteria: ["Endpoint emits signed token"]
    },
    {
      id: "session",
      parentId: "root",
      title: "Session lifecycle",
      goal: "Establish session cookies after redemption",
      kind: "leaf",
      depth: 1,
      allowedPaths: ["src/auth/**"],
      forbiddenPaths: [],
      expectedFiles: ["src/auth/session.ts"],
      acceptanceCriteria: ["Session cookie set after redemption"]
    }
  ],
  dependencies: [
    {
      fromTaskId: "magic-link",
      toTaskId: "session",
      type: "logical",
      rationale: "Session relies on magic link issuance"
    }
  ]
});

describe("normalizeLlmDecomposition", () => {
  it("converts the LLM output into a valid TaskGraph", () => {
    const result = normalizeLlmDecomposition({
      feature: {
        id: "login",
        title: "Add login",
        description: "Passwordless login feature",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Magic link works", "Session persists"]
      },
      output: validOutput,
      mode: "balanced",
      generatedAt: "2026-05-26T00:00:00.000Z",
      decomposerLabel: "anthropic:test",
      baseBranch: "main",
      baseCommit: "test-commit",
      repo: "test-repo"
    });

    expect(result.metadata.deterministic).toBe(false);
    expect(result.metadata.decomposer).toBe("anthropic:test");
    expect(result.graph.rootId).toBe("root");
    expect(Object.keys(result.graph.nodes).sort()).toEqual(["magic-link", "root", "session"]);
    expect(result.graph.dependencies).toHaveLength(1);
    expect(result.contracts.map((entry) => entry.taskId).sort()).toEqual(["magic-link", "session"]);
    for (const node of Object.values(result.graph.nodes)) {
      expect(node.metadata?.authoredBy).toBe("ai");
    }
    const issues = validateTaskGraph(result.graph);
    expect(issues).toEqual([]);
  });

  it("derives V2 executionScope and forbiddenPaths on leaf contracts", () => {
    const result = normalizeLlmDecomposition({
      feature: {
        id: "login",
        title: "Add login",
        description: "Passwordless login feature",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Magic link works"]
      },
      output: validOutput,
      mode: "balanced",
      generatedAt: "2026-05-26T00:00:00.000Z",
      decomposerLabel: "anthropic:test",
      baseBranch: "main",
      baseCommit: "test-commit",
      repo: "test-repo"
    });

    const magicLink = result.contracts.find((c) => c.taskId === "magic-link");
    expect(magicLink?.executionScope?.implementationPaths).toEqual(["src/auth/**"]);
    expect(magicLink?.forbiddenPaths).toEqual(["src/db/migrations/**"]);
  });

  it("falls back to a non-empty implementationPaths when the LLM gives no allowedPaths", () => {
    const output = DecomposerLlmOutputSchema.parse({
      title: "x",
      summary: "x",
      nodes: [
        { id: "root", parentId: null, title: "x", goal: "x", kind: "composite", depth: 0 },
        { id: "only", parentId: "root", title: "y", goal: "y", kind: "leaf", depth: 1, acceptanceCriteria: ["done"] }
      ],
      dependencies: []
    });
    const result = normalizeLlmDecomposition({
      feature: { id: "f", title: "f", description: "f", targetStack: [], constraints: [], acceptanceCriteria: ["a"] },
      output,
      mode: "balanced",
      generatedAt: "2026-05-26T00:00:00.000Z",
      decomposerLabel: "anthropic:test",
      baseBranch: "main",
      baseCommit: "c",
      repo: "r"
    });
    const leaf = result.contracts.find((c) => c.taskId === "only");
    // Empty allowedPaths must NOT yield an empty scope (that would reject everything).
    expect(leaf?.executionScope?.implementationPaths.length).toBeGreaterThan(0);
  });
});
