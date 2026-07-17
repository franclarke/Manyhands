import { describe, expect, it } from "vitest";
import type { AgentTaskContract } from "@manyhands/contracts";
import type { PlanningFlowResult as MockPlanningFlowResult } from "@manyhands/orchestrator-graph";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { resolveExecutionGraph } from "@/lib/server/runs/execution-state";
import type { RunPatch } from "@/lib/server/runs/patches";
import type { RunRecord } from "@/lib/server/runs/schema";

const now = "2026-07-15T00:00:00.000Z";

describe("plan graph storage compatibility", () => {
  it("keeps an unmarked legacy baked replan and replays only safe later edits", () => {
    const baked = bakedReplanGraph();
    const run = record(baked, [oldSubtreePatch(), renamedTargetPatch()]);

    const graph = resolveExecutionGraph(run);

    expect((run.planning as MockPlanningFlowResult).decomposition.graph.nodes.target?.kind).toBe("composite");
    expect((run.planning as MockPlanningFlowResult).decomposition.graph.nodes["target-r2-new"]).toBeDefined();
    expect(graph.nodes.target?.kind).toBe("composite");
    expect(graph.nodes.target?.title).toBe("Edited after the baked replan");
    expect(graph.nodes["target-r2-new"]).toBeDefined();
    expect(graph.nodes["target-r1-old"]).toBeUndefined();
    const snapshot = projectRunRecordToSnapshot(run);
    expect(snapshot?.graphSnapshot.nodes["target-r2-new"]).toBeDefined();
    expect(snapshot?.graphSnapshot.nodes["target-r1-old"]).toBeUndefined();
    expect(snapshot?.graphSnapshot.nodes.target?.title).toBe("Edited after the baked replan");
  });

  it("replays the ordered patch log when the immutable-base representation is explicit", () => {
    const run = record(baseGraph(), [oldSubtreePatch(), currentSubtreePatch()], {
      version: 1,
      mode: "immutable_base_patch_log"
    });

    const graph = resolveExecutionGraph(run);

    expect(graph.nodes.target?.kind).toBe("composite");
    expect(graph.nodes.target?.childrenIds).toEqual(["target-r2-new"]);
    expect(graph.nodes["target-r2-new"]?.parentId).toBe("target");
    expect(graph.nodes["target-r1-old"]).toBeUndefined();
  });

  it("keeps pre-marker non-replan records readable when their base is unambiguously immutable", () => {
    const run = record(baseGraph(), [{
      id: "patch-title",
      createdAt: now,
      actor: "human",
      type: "NODE_RENAMED",
      taskId: "target",
      title: "Edited target"
    }]);

    expect(resolveExecutionGraph(run).nodes.target?.title).toBe("Edited target");
  });

  it("rejects a seam amendment whose first durable transition does not start at r1", () => {
    const graph = seamGraph();
    const run = record(graph, [seamPatch("patch-bad-r9", 9, 10)], {
      version: 1,
      mode: "immutable_base_patch_log"
    });

    expect(() => resolveExecutionGraph(run)).toThrow(
      /revision chain is stale: expected r1 -> r2, received r9 -> r10/u
    );
  });

  it("rejects duplicate r1 -> r2 seam transitions in one ordered patch chain", () => {
    const graph = seamGraph();
    const run = record(graph, [
      seamPatch("patch-first-r2", 1, 2),
      seamPatch("patch-duplicate-r2", 1, 2)
    ], {
      version: 1,
      mode: "immutable_base_patch_log"
    });

    expect(() => resolveExecutionGraph(run)).toThrow(
      /revision chain is stale: expected r2 -> r3, received r1 -> r2/u
    );
  });
});

function record(
  graph: TaskGraph,
  patches: RunPatch[],
  planGraphStorage?: RunRecord["planGraphStorage"]
): RunRecord {
  return {
    runId: "run-plan-storage",
    workspaceId: "workspace-1",
    userPrompt: "Build feature",
    title: "Build feature",
    model: "gpt-5.5",
    granularity: "balanced",
    status: "needs_review",
    version: 1,
    planRevision: 3,
    planning: planning(graph),
    ...(planGraphStorage !== undefined ? { planGraphStorage } : {}),
    patches,
    createdAt: now,
    updatedAt: now
  } as RunRecord;
}

function planning(graph: TaskGraph): MockPlanningFlowResult {
  return {
    decomposition: {
      feature: {
        id: "feature-1",
        title: "Feature",
        description: "Feature",
        repositoryPath: "repo",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["Done"]
      },
      graph,
      contracts: Object.values(graph.nodes).flatMap((node) => node.contract === undefined ? [] : [node.contract])
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { batches: [] },
    traces: [],
    summary: { mode: "balanced" }
  } as MockPlanningFlowResult;
}

function baseGraph(): TaskGraph {
  return graph({
    root: node({ id: "root", kind: "root", depth: 0, childrenIds: ["target"] }),
    target: node({ id: "target", kind: "leaf", depth: 1, parentId: "root", contract: contract("target") })
  });
}

function seamGraph(): TaskGraph {
  const graph = baseGraph();
  const target = graph.nodes.target!;
  target.contract = {
    ...target.contract!,
    producedInterfaces: [{
      id: "TargetApi",
      kind: "function",
      signature: "load(): Item",
      description: "Loads the target"
    }]
  };
  return graph;
}

function seamPatch(
  id: string,
  fromRevision: number,
  toRevision: number
): Extract<RunPatch, { type: "SEAM_AMENDED" }> {
  return {
    id,
    createdAt: now,
    actor: "human",
    type: "SEAM_AMENDED",
    seamId: "TargetApi",
    fromRevision,
    toRevision,
    changeKind: "signature",
    signature: `loadV${toRevision}(): Item`
  };
}

function bakedReplanGraph(): TaskGraph {
  return graph({
    root: node({ id: "root", kind: "root", depth: 0, childrenIds: ["target"] }),
    target: node({
      id: "target",
      kind: "composite",
      depth: 1,
      parentId: "root",
      childrenIds: ["target-r2-new"],
      metadata: { replanRevision: 2 }
    }),
    "target-r2-new": node({
      id: "target-r2-new",
      kind: "leaf",
      depth: 2,
      parentId: "target",
      contract: contract("target-r2-new")
    })
  });
}

function graph(nodes: Record<string, TaskNode>): TaskGraph {
  return {
    id: "graph-1",
    planId: "plan-1",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "base",
    featureRequest: "Feature",
    rootId: "root",
    createdAt: now,
    nodes,
    dependencies: []
  };
}

function oldSubtreePatch(): Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> {
  const target = node({
    id: "target",
    kind: "composite",
    depth: 1,
    parentId: "root",
    childrenIds: ["target-r1-old"],
    metadata: { replanRevision: 1 }
  });
  const old = node({
    id: "target-r1-old",
    kind: "leaf",
    depth: 2,
    parentId: "target",
    contract: contract("target-r1-old")
  });
  return {
    id: "patch-old-subtree",
    createdAt: "2026-07-14T00:00:00.000Z",
    actor: "human",
    type: "SUBTREE_REGENERATED",
    taskId: "target",
    removedTaskIds: ["target"],
    nodes: { target, "target-r1-old": old },
    dependencies: [],
    contracts: [old.contract!]
  };
}

function renamedTargetPatch(): Extract<RunPatch, { type: "NODE_RENAMED" }> {
  return {
    id: "patch-title-after-baked-replan",
    createdAt: now,
    actor: "human",
    type: "NODE_RENAMED",
    taskId: "target",
    title: "Edited after the baked replan"
  };
}

function currentSubtreePatch(): Extract<RunPatch, { type: "SUBTREE_REGENERATED" }> {
  const target = node({
    id: "target",
    kind: "composite",
    depth: 1,
    parentId: "root",
    childrenIds: ["target-r2-new"],
    metadata: { replanRevision: 2 }
  });
  const current = node({
    id: "target-r2-new",
    kind: "leaf",
    depth: 2,
    parentId: "target",
    contract: contract("target-r2-new")
  });
  return {
    id: "patch-current-subtree",
    createdAt: now,
    actor: "system",
    type: "SUBTREE_REGENERATED",
    taskId: "target",
    removedTaskIds: ["target", "target-r1-old"],
    nodes: { target, "target-r2-new": current },
    dependencies: [],
    contracts: [current.contract!]
  };
}

function node(input: Partial<TaskNode> & Pick<TaskNode, "id" | "kind" | "depth">): TaskNode {
  return {
    parentId: null,
    title: input.id,
    goal: `Goal ${input.id}`,
    status: "planned",
    granularity: "auto",
    childrenIds: [],
    dependencies: [],
    ...input
  } as TaskNode;
}

function contract(taskId: string): AgentTaskContract {
  return {
    taskId,
    objective: `Implement ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [`src/${taskId}.ts`] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: `${taskId} works` }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${taskId}.ts`], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "Done"
  };
}
