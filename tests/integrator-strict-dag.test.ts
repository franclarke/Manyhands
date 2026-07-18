/**
 * B-009 — one productive integrator semantics + strict DAG (CF-09/12/13).
 *
 * (A) `integrator` nodes are ATOMIC executable tasks. The LangGraph execution
 *     path dispatches them through execution-host → RunExecutor.runNode, so
 *     runNode must execute them like leaves — the old code sent them to the
 *     composite branch and died with "Composite task has no children".
 * (B) `validateExecutableTaskGraph` enforces the full tree+DAG invariants:
 *     valid root (kind/parent/depth), key↔id identity, depth = parent+1,
 *     no duplicate children/dependencies, and EXACT two-way sync between
 *     `graph.dependencies` (canonical) and `node.dependencies` (shortcut).
 */
import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import { validateExecutableTaskGraph, type TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import { ExecutionConfigSchema, MockAgentExecutor, RunExecutor } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const RUN_ID = "run-b009";
const REPO_ROOT = "/repo";

function contractFor(taskId: string): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    acceptance: [{ kind: "custom", description: "Works." }],
    expectedOutput: { changedFiles: ["src/x.ts"], producedSymbols: [], consumedSymbols: [], diffShapeHint: "n/a" },
    limits: { maxDurationMs: 60_000, maxCostUsd: 0 },
    definitionOfDone: "Done.",
    executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
    forbiddenPaths: []
  });
}

interface NodeOverrides {
  id?: string;
  parentId?: string | null;
  kind?: "root" | "composite" | "leaf" | "integrator";
  depth?: number;
  childrenIds?: string[];
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

function node(taskId: string, overrides: NodeOverrides = {}) {
  const kind = overrides.kind ?? "leaf";
  return {
    id: overrides.id ?? taskId,
    parentId: overrides.parentId === undefined ? "root" : overrides.parentId,
    kind,
    title: taskId,
    goal: `Do ${taskId}.`,
    status: "planned" as const,
    granularity: "fine" as const,
    depth: overrides.depth ?? 1,
    childrenIds: overrides.childrenIds ?? [],
    dependencies: overrides.dependencies ?? [],
    acceptanceCriteria: ["criterion one"],
    ...(overrides.metadata !== undefined ? { metadata: overrides.metadata } : {}),
    ...(kind === "leaf" || kind === "integrator" ? { contract: contractFor(taskId) } : {})
  };
}

function baseGraph(overrides: Partial<TaskGraph> = {}): TaskGraph {
  return {
    id: "graph-b009",
    planId: RUN_ID,
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "Build it.",
    rootId: "root",
    createdAt: "2026-07-12T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: node("root", { kind: "composite", parentId: null, depth: 0, childrenIds: ["a"] }),
      a: node("a")
    },
    ...overrides
  } as TaskGraph;
}

function errorCodes(graph: TaskGraph): string[] {
  return validateExecutableTaskGraph(graph)
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.code);
}

describe("B-009 integrator executes atomically through runNode (the productive path)", () => {
  it("runNode executes an integrator like a leaf and returns its atomic result", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "INTEG_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const executor = new RunExecutor({
      git,
      executor: agent,
      traceStore,
      repoRoot: REPO_ROOT,
      writeInstructions: async () => {}
    });

    const graph = baseGraph({
      dependencies: [{ fromTaskId: "a", toTaskId: "integ", type: "structural", inferred: false }],
      nodes: {
        root: node("root", { kind: "composite", parentId: null, depth: 0, childrenIds: ["a", "integ"] }),
        a: node("a"),
        integ: node("integ", {
          kind: "integrator",
          dependencies: ["a"],
          metadata: { integratesTaskIds: ["a"] }
        })
      }
    });

    const result = await executor.runNode({
      graph,
      config: ExecutionConfigSchema.parse({ routing: "fixed" }),
      model: "sonnet",
      taskId: "integ",
      runId: RUN_ID,
      defaultExecutionSelection: { executorId: "claude-code-cli", model: "sonnet" }
    });

    expect(result.kind).toBe("leaf");
    if (result.kind === "leaf") {
      expect(result.result.taskId).toBe("integ");
      expect(result.result.status).toBe("success");
      expect(result.result.commitSha).toBe("INTEG_SHA");
    }
    // Exactly one agent invocation — never the composite/integration path.
    expect(agent.calls).toHaveLength(1);
  });
});

describe("B-009 strict DAG invariants", () => {
  it("accepts a structurally sound graph", () => {
    const graph = baseGraph({
      dependencies: [{ fromTaskId: "a", toTaskId: "b", type: "structural", inferred: false }],
      nodes: {
        root: node("root", { kind: "composite", parentId: null, depth: 0, childrenIds: ["a", "b"] }),
        a: node("a"),
        b: node("b", { dependencies: ["a"] })
      }
    });
    expect(errorCodes(graph)).toEqual([]);
  });

  it("rejects a rootId pointing at a leaf with parentId=null and depth 7 (the audit probe)", () => {
    const graph = baseGraph({
      rootId: "solo",
      nodes: {
        solo: node("solo", { kind: "leaf", parentId: null, depth: 7 })
      }
    });
    expect(errorCodes(graph).length).toBeGreaterThan(0);
  });

  it("rejects a node whose map key differs from its id", () => {
    const graph = baseGraph();
    graph.nodes.a = { ...graph.nodes.a!, id: "not-a" };
    graph.nodes.root = { ...graph.nodes.root!, childrenIds: ["a"] };
    expect(errorCodes(graph)).toContain("node_key_mismatch");
  });

  it("rejects a child whose depth is not parent.depth + 1", () => {
    const graph = baseGraph();
    graph.nodes.a = { ...graph.nodes.a!, depth: 3 };
    expect(errorCodes(graph)).toContain("invalid_depth");
  });

  it("rejects duplicate childrenIds", () => {
    const graph = baseGraph();
    graph.nodes.root = { ...graph.nodes.root!, childrenIds: ["a", "a"] };
    expect(errorCodes(graph)).toContain("duplicate_child");
  });

  it("rejects duplicate canonical dependency edges", () => {
    const graph = baseGraph({
      dependencies: [
        { fromTaskId: "a", toTaskId: "b", type: "structural", inferred: false },
        { fromTaskId: "a", toTaskId: "b", type: "logical", inferred: true }
      ],
      nodes: {
        root: node("root", { kind: "composite", parentId: null, depth: 0, childrenIds: ["a", "b"] }),
        a: node("a"),
        b: node("b", { dependencies: ["a"] })
      }
    });
    expect(errorCodes(graph)).toContain("duplicate_dependency");
  });

});
