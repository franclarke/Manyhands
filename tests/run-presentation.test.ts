import { describe, expect, it } from "vitest";
import type { RunGraphViewModel } from "@/lib/graph-view-model";
import {
  estimateParallelBatches,
  nodeActionHint,
  operationalMetrics,
  selectionRelations
} from "@/lib/run-presentation";

describe("run presentation helpers", () => {
  it("computes operational metrics from the graph view model", () => {
    const graph = makeGraph();

    expect(operationalMetrics(graph)).toMatchObject({
      totalNodes: 5,
      ready: 1,
      running: 1,
      blocked: 1,
      needsReview: 0,
      failed: 0,
      integrated: 1,
      highRisk: 1,
      parallelBatches: 2
    });
  });

  it("estimates parallel batches from leaf depth groups", () => {
    expect(estimateParallelBatches(makeGraph().nodes)).toBe(2);
  });

  it("highlights ancestors, dependencies and children for selected nodes", () => {
    const relations = selectionRelations(makeGraph(), "child-b");

    expect(relations?.ancestors.has("root")).toBe(true);
    expect(relations?.dependencies.has("child-a")).toBe(true);
    expect(relations?.children.size).toBe(0);
    expect([...relations?.related ?? []].sort()).toEqual(["child-a", "child-b", "root"]);
  });

  it("maps node statuses to action hints", () => {
    expect(nodeActionHint({ status: "ready" })).toBe("Ready to run");
    expect(nodeActionHint({ status: "failed" })).toBe("Inspect failure");
    expect(nodeActionHint({ status: "integrated" })).toBe("Integrated");
  });
});

function makeGraph(): RunGraphViewModel {
  return {
    runId: "run-1",
    featureId: "feature-1",
    mode: "balanced",
    schemaVersion: "1",
    deterministic: false,
    nodes: [
      node("root", "composite", "integrated", 0, null),
      node("child-a", "leaf", "ready", 1, "root", "high"),
      node("child-b", "leaf", "running", 1, "root"),
      node("child-c", "leaf", "blocked", 2, "root"),
      node("child-d", "leaf", "planned", 2, "root")
    ],
    edges: [
      { id: "dep:child-a:child-b", source: "child-a", target: "child-b", kind: "dependency" }
    ],
    status: {
      planned: 1,
      ready: 1,
      running: 1,
      gated: 0,
      done: 0,
      failed: 0,
      blocked: 1,
      generating: 0,
      needs_review: 0,
      approved: 0,
      integrated: 1
    },
    summary: {
      taskCount: 5,
      leafCount: 4,
      dependencyCount: 1,
      riskCount: 0,
      traceEventCount: 0
    }
  };
}

function node(
  id: string,
  kind: string,
  status: RunGraphViewModel["nodes"][number]["status"],
  depth: number,
  parentId: string | null,
  riskLevel?: RunGraphViewModel["nodes"][number]["riskLevel"]
): RunGraphViewModel["nodes"][number] {
  const result: RunGraphViewModel["nodes"][number] = {
    id,
    title: id,
    description: `Description for ${id}`,
    kind,
    status,
    depth,
    parentId
  };
  if (riskLevel !== undefined) {
    result.riskLevel = riskLevel;
  }
  return result;
}
