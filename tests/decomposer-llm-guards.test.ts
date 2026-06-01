import { describe, expect, it } from "vitest";
import {
  DecomposerLlmError,
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
      runDecomposerGuards(makeOutput())
    ).not.toThrow();
  });

  it("rejects duplicate node ids", () => {
    const output = makeOutput();
    output.nodes[2]!.id = "child-1";
    expect(() => runDecomposerGuards(output)).toThrowError(DecomposerLlmError);
  });

  it("rejects multiple roots", () => {
    const output = makeOutput();
    output.nodes[1]!.parentId = null;
    output.nodes[1]!.depth = 0;
    expect(() => runDecomposerGuards(output)).toThrowError(DecomposerLlmError);
  });

  it("rejects nodes whose parent is missing", () => {
    const output = makeOutput();
    output.nodes[1]!.parentId = "ghost";
    expect(() => runDecomposerGuards(output)).toThrowError(DecomposerLlmError);
  });

  it("rejects depth that does not match parent depth + 1", () => {
    const output = makeOutput();
    output.nodes[1]!.depth = 3;
    expect(() => runDecomposerGuards(output)).toThrowError(DecomposerLlmError);
  });

  it("rejects leaf nodes without acceptance criteria", () => {
    const output = makeOutput();
    output.nodes[1]!.acceptanceCriteria = [];
    expect(() => runDecomposerGuards(output)).toThrowError(DecomposerLlmError);
  });

  it("rejects dependency cycles", () => {
    const output = makeOutput();
    output.dependencies = [
      { fromTaskId: "child-1", toTaskId: "child-2", type: "logical" },
      { fromTaskId: "child-2", toTaskId: "child-3", type: "logical" },
      { fromTaskId: "child-3", toTaskId: "child-1", type: "logical" }
    ];
    expect(() => runDecomposerGuards(output)).toThrowError(/cycle/);
  });

  it("rejects self-loop dependencies", () => {
    const output = makeOutput();
    output.dependencies = [{ fromTaskId: "child-1", toTaskId: "child-1", type: "logical" }];
    expect(() => runDecomposerGuards(output)).toThrowError(/self-loop/);
  });

  it("accepts an asymmetric tree: one branch atomic at depth 1, a sibling nested to depth 4", () => {
    // Granularity is aggressiveness, not a depth cap. A shallow branch and a deep
    // branch must coexist in the same plan without being rejected.
    const output = makeOutput({
      nodes: [
        node("root", null, 0, "composite"),
        // shallow branch: atomic immediately
        leaf("shallow", "root", 1),
        // deep branch: composite chain down to depth 4
        node("a", "root", 1, "composite"),
        node("b", "a", 2, "composite"),
        node("c", "b", 3, "composite"),
        leaf("d", "c", 4)
      ]
    });
    expect(() => runDecomposerGuards(output)).not.toThrow();
  });

  it("rejects an output above the anti-runaway node safety rail", () => {
    const tooMany = makeOutput();
    while (tooMany.nodes.length <= 200) {
      tooMany.nodes.push(leaf(`extra-${tooMany.nodes.length}`, "root", 1));
    }
    expect(() => runDecomposerGuards(tooMany)).toThrowError(/safety rail/);
  });
});

function node(
  id: string,
  parentId: string | null,
  depth: number,
  kind: "composite" | "leaf"
): DecomposerLlmOutput["nodes"][number] {
  return {
    id,
    parentId,
    title: id,
    goal: id,
    kind,
    depth,
    allowedPaths: [],
    forbiddenPaths: [],
    expectedFiles: [],
    acceptanceCriteria: kind === "leaf" ? ["done"] : []
  };
}

function leaf(id: string, parentId: string, depth: number): DecomposerLlmOutput["nodes"][number] {
  return node(id, parentId, depth, "leaf");
}
