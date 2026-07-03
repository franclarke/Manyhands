import { describe, expect, it } from "vitest";
import { buildLeafInstructions } from "@manyhands/execution-core";
import type { TaskNode } from "@manyhands/task-graph";

function leafNode(): TaskNode {
  return {
    id: "leaf-1",
    parentId: "root",
    kind: "leaf",
    title: "Implement parser",
    goal: "Implement the expression parser",
    status: "planned",
    granularity: "auto",
    depth: 1,
    childrenIds: [],
    dependencies: []
  } as unknown as TaskNode;
}

describe("buildLeafInstructions", () => {
  it("teaches the MH_STATUS send-to-user protocol", () => {
    const instructions = buildLeafInstructions(leafNode());

    expect(instructions).toContain("MH_STATUS");
    expect(instructions).toContain('"message"');
  });

  it("keeps the no-commit rule as the final instruction", () => {
    const instructions = buildLeafInstructions(leafNode());

    expect(instructions.trimEnd().endsWith("Do not commit — the orchestrator will commit your changes.")).toBe(
      true
    );
  });
});
