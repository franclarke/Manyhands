import { describe, expect, it } from "vitest";
import {
  DecomposerLlmError,
  GRANULARITY_PROFILES,
  runDecomposerGuards,
  type DecomposerLlmOutput
} from "@manyhands/decomposer";

function makeOutput(overrides: Partial<DecomposerLlmOutput> = {}): DecomposerLlmOutput {
  return {
    title: "Example feature",
    summary: "A small feature decomposition",
    assumptions: [],
    risks: [],
    nodes: [
      {
        id: "root",
        parentId: null,
        title: "Root",
        goal: "Implement the feature",
        kind: "composite",
        depth: 0,
        allowedPaths: [],
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: []
      },
      {
        id: "child-1",
        parentId: "root",
        title: "Backend changes",
        goal: "Update the backend",
        kind: "leaf",
        depth: 1,
        allowedPaths: ["src/server/**"],
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: ["Backend endpoints respond"]
      },
      {
        id: "child-2",
        parentId: "root",
        title: "Frontend changes",
        goal: "Update the frontend",
        kind: "leaf",
        depth: 1,
        allowedPaths: ["src/client/**"],
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: ["UI renders the new flow"]
      },
      {
        id: "child-3",
        parentId: "root",
        title: "Tests",
        goal: "Add tests",
        kind: "leaf",
        depth: 1,
        allowedPaths: ["tests/**"],
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: ["All tests pass"]
      }
    ],
    dependencies: [],
    ...overrides
  };
}

describe("runDecomposerGuards", () => {
  it("accepts a valid balanced output", () => {
    expect(() =>
      runDecomposerGuards(makeOutput(), { granularity: "balanced" })
    ).not.toThrow();
  });

  it("rejects duplicate node ids", () => {
    const output = makeOutput();
    output.nodes[2]!.id = "child-1";
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(DecomposerLlmError);
  });

  it("rejects multiple roots", () => {
    const output = makeOutput();
    output.nodes[1]!.parentId = null;
    output.nodes[1]!.depth = 0;
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(DecomposerLlmError);
  });

  it("rejects nodes whose parent is missing", () => {
    const output = makeOutput();
    output.nodes[1]!.parentId = "ghost";
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(DecomposerLlmError);
  });

  it("rejects depth that does not match parent depth + 1", () => {
    const output = makeOutput();
    output.nodes[1]!.depth = 3;
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(DecomposerLlmError);
  });

  it("rejects leaf nodes without acceptance criteria", () => {
    const output = makeOutput();
    output.nodes[1]!.acceptanceCriteria = [];
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(DecomposerLlmError);
  });

  it("rejects dependency cycles", () => {
    const output = makeOutput();
    output.dependencies = [
      { fromTaskId: "child-1", toTaskId: "child-2", type: "logical" },
      { fromTaskId: "child-2", toTaskId: "child-3", type: "logical" },
      { fromTaskId: "child-3", toTaskId: "child-1", type: "logical" }
    ];
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(/cycle/);
  });

  it("rejects self-loop dependencies", () => {
    const output = makeOutput();
    output.dependencies = [{ fromTaskId: "child-1", toTaskId: "child-1", type: "logical" }];
    expect(() => runDecomposerGuards(output, { granularity: "balanced" })).toThrowError(/self-loop/);
  });

  it("rejects node counts above the granularity cap", () => {
    const profile = GRANULARITY_PROFILES.coarse;
    const tooMany = makeOutput();
    while (tooMany.nodes.length <= profile.maxNodes) {
      const id = `extra-${tooMany.nodes.length}`;
      tooMany.nodes.push({
        id,
        parentId: "root",
        title: "Extra",
        goal: "Extra",
        kind: "leaf",
        depth: 1,
        allowedPaths: [],
        forbiddenPaths: [],
        expectedFiles: [],
        acceptanceCriteria: ["Done"]
      });
    }
    expect(() => runDecomposerGuards(tooMany, { granularity: "coarse" })).toThrowError(/exceeds/);
  });

  it("rejects depth above the granularity cap", () => {
    const output = makeOutput({
      nodes: [
        {
          id: "root",
          parentId: null,
          title: "Root",
          goal: "Root",
          kind: "composite",
          depth: 0,
          allowedPaths: [],
          forbiddenPaths: [],
          expectedFiles: [],
          acceptanceCriteria: []
        },
        {
          id: "a",
          parentId: "root",
          title: "a",
          goal: "a",
          kind: "composite",
          depth: 1,
          allowedPaths: [],
          forbiddenPaths: [],
          expectedFiles: [],
          acceptanceCriteria: []
        },
        {
          id: "b",
          parentId: "a",
          title: "b",
          goal: "b",
          kind: "composite",
          depth: 2,
          allowedPaths: [],
          forbiddenPaths: [],
          expectedFiles: [],
          acceptanceCriteria: []
        },
        {
          id: "c",
          parentId: "b",
          title: "c",
          goal: "c",
          kind: "leaf",
          depth: 3,
          allowedPaths: [],
          forbiddenPaths: [],
          expectedFiles: [],
          acceptanceCriteria: ["done"]
        }
      ]
    });
    expect(() => runDecomposerGuards(output, { granularity: "coarse" })).toThrowError(/exceeds/);
  });
});
