import { describe, expect, it } from "vitest";
import {
  graftSubtree,
  validateTaskGraph,
  type TaskGraph,
  type TaskNode
} from "@manyhands/task-graph";

function validationErrors(graph: TaskGraph): string[] {
  return validateTaskGraph(graph)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
}

function node(partial: Partial<TaskNode> & Pick<TaskNode, "id" | "kind" | "depth">): TaskNode {
  return {
    parentId: null,
    title: partial.id,
    goal: `goal of ${partial.id}`,
    status: "planned",
    granularity: "auto",
    childrenIds: [],
    dependencies: [],
    ...partial
  } as TaskNode;
}

function leafContract(taskId: string) {
  return {
    taskId,
    objective: `do ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "works" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${taskId}.ts`], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 1000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done"
  };
}

/** Main graph: root → (auth-leaf, billing-leaf); billing depends on auth. */
function mainGraph(): TaskGraph {
  return {
    id: "graph-main",
    planId: "plan-1",
    repo: "/repo",
    baseBranch: "main",
    baseCommit: "abc123",
    featureRequest: "build the feature",
    rootId: "root",
    createdAt: "2026-06-10T00:00:00.000Z",
    nodes: {
      root: node({ id: "root", kind: "root", depth: 0, childrenIds: ["auth", "billing"] }),
      auth: node({ id: "auth", kind: "leaf", depth: 1, parentId: "root", contract: leafContract("auth") as never }),
      billing: node({
        id: "billing",
        kind: "leaf",
        depth: 1,
        parentId: "root",
        dependencies: ["auth"],
        contract: leafContract("billing") as never
      })
    },
    dependencies: [{ fromTaskId: "auth", toTaskId: "billing", type: "contractual", inferred: false }]
  } as unknown as TaskGraph;
}

/** Replacement plan for "auth": its root decomposes into two leaves. */
function replacementGraph(): TaskGraph {
  return {
    id: "graph-replan",
    planId: "plan-replan",
    repo: "/repo",
    baseBranch: "main",
    baseCommit: "abc123",
    featureRequest: "replan auth",
    rootId: "sub-root",
    createdAt: "2026-06-10T01:00:00.000Z",
    nodes: {
      "sub-root": node({ id: "sub-root", kind: "root", depth: 0, childrenIds: ["login", "session"] }),
      login: node({
        id: "login",
        kind: "leaf",
        depth: 1,
        parentId: "sub-root",
        contract: leafContract("login") as never
      }),
      session: node({
        id: "session",
        kind: "leaf",
        depth: 1,
        parentId: "sub-root",
        dependencies: ["login"],
        contract: leafContract("session") as never
      })
    },
    dependencies: [{ fromTaskId: "login", toTaskId: "session", type: "structural", inferred: false }]
  } as unknown as TaskGraph;
}

describe("graftSubtree", () => {
  it("replaces a failed leaf with the replanned subtree under stable ids", () => {
    const result = graftSubtree({
      graph: mainGraph(),
      taskId: "auth",
      replacement: replacementGraph(),
      revision: 1
    });

    const auth = result.graph.nodes["auth"];
    expect(auth).toBeDefined();
    expect(auth?.kind).toBe("composite");
    expect(auth?.childrenIds).toEqual(["auth-r1-login", "auth-r1-session"]);
    expect(auth?.status).toBe("planned");

    const login = result.graph.nodes["auth-r1-login"];
    expect(login?.parentId).toBe("auth");
    expect(login?.depth).toBe(2);
    expect(login?.contract?.taskId).toBe("auth-r1-login");

    // Internal replacement dependency is remapped.
    expect(result.graph.dependencies).toContainEqual(
      expect.objectContaining({ fromTaskId: "auth-r1-login", toTaskId: "auth-r1-session" })
    );
    // External boundary edge is preserved.
    expect(result.graph.dependencies).toContainEqual(
      expect.objectContaining({ fromTaskId: "auth", toTaskId: "billing" })
    );

    expect(result.addedTaskIds).toEqual(["auth-r1-login", "auth-r1-session"]);
    expect(result.removedTaskIds).toEqual([]);

    expect(validationErrors(result.graph)).toEqual([]);
  });

  it("re-points boundary edges from removed descendants to the grafted node", () => {
    const graph = mainGraph();
    // Give auth an existing child that billing depends on.
    graph.nodes["auth"] = node({
      id: "auth",
      kind: "composite",
      depth: 1,
      parentId: "root",
      childrenIds: ["auth-old"]
    });
    graph.nodes["auth-old"] = node({
      id: "auth-old",
      kind: "leaf",
      depth: 2,
      parentId: "auth",
      contract: leafContract("auth-old") as never
    });
    graph.nodes["billing"] = node({
      id: "billing",
      kind: "leaf",
      depth: 1,
      parentId: "root",
      dependencies: ["auth-old"],
      contract: leafContract("billing") as never
    });
    graph.dependencies = [{ fromTaskId: "auth-old", toTaskId: "billing", type: "contractual", inferred: false }] as never;

    const result = graftSubtree({ graph, taskId: "auth", replacement: replacementGraph(), revision: 2 });

    expect(result.removedTaskIds).toEqual(["auth-old"]);
    expect(result.graph.nodes["auth-old"]).toBeUndefined();
    expect(result.graph.nodes["billing"]?.dependencies).toEqual(["auth"]);
    expect(result.graph.dependencies).toContainEqual(
      expect.objectContaining({ fromTaskId: "auth", toTaskId: "billing" })
    );
    expect(validationErrors(result.graph)).toEqual([]);
  });

  it("keeps the node a leaf when the replanned subtree is atomic", () => {
    const atomic = replacementGraph();
    atomic.rootId = "sub-root";
    atomic.nodes = {
      "sub-root": {
        ...node({ id: "sub-root", kind: "root", depth: 0 }),
        contract: leafContract("sub-root") as never
      }
    } as never;
    atomic.dependencies = [] as never;

    const result = graftSubtree({ graph: mainGraph(), taskId: "auth", replacement: atomic, revision: 1 });

    const auth = result.graph.nodes["auth"];
    expect(auth?.kind).toBe("leaf");
    expect(auth?.childrenIds).toEqual([]);
    expect(auth?.contract?.taskId).toBe("auth");
    expect(validationErrors(result.graph)).toEqual([]);
  });

  it("refuses to graft onto the root or a missing node", () => {
    expect(() =>
      graftSubtree({ graph: mainGraph(), taskId: "root", replacement: replacementGraph(), revision: 1 })
    ).toThrow(/root/i);
    expect(() =>
      graftSubtree({ graph: mainGraph(), taskId: "ghost", replacement: replacementGraph(), revision: 1 })
    ).toThrow(/ghost/);
  });
});
