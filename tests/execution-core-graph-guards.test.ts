import type { TaskGraph } from "@manyhands/task-graph";
import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  assertExecutableGraph,
  ExecutionConfigSchema,
  MockAgentExecutor,
  RunExecutionError,
  RunExecutor
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

function baseGraph(overrides: Partial<TaskGraph> = {}): TaskGraph {
  return {
    id: "graph-1",
    planId: "run-1",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "Build it.",
    rootId: "root",
    createdAt: "2026-05-29T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate.",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["a"],
        dependencies: []
      },
      a: {
        id: "a",
        parentId: "root",
        kind: "leaf",
        title: "a",
        goal: "Do a.",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        acceptanceCriteria: ["c"],
        contract: contract("a")
      }
    },
    ...overrides
  };
}

function contract(taskId: string): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Do ${taskId}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [`src/${taskId}.ts`] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${taskId}.ts`], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: [`src/${taskId}.ts`], testPaths: [], configPaths: [] }
  });
}

describe("assertExecutableGraph", () => {
  it("accepts a well-formed graph", () => {
    expect(() => assertExecutableGraph(baseGraph())).not.toThrow();
  });

  it("rejects an empty baseCommit", () => {
    expect(() => assertExecutableGraph(baseGraph({ baseCommit: "  " }))).toThrow(RunExecutionError);
  });

  it("rejects a rootId that does not resolve to a node", () => {
    expect(() => assertExecutableGraph(baseGraph({ rootId: "ghost" }))).toThrow(/rootId/);
  });

  it("rejects a dangling child reference", () => {
    const graph = baseGraph();
    graph.nodes.root!.childrenIds = ["a", "missing"];
    const error = (() => {
      try {
        assertExecutableGraph(graph);
      } catch (err) {
        return err;
      }
    })();
    expect(RunExecutionError.is(error)).toBe(true);
    expect((error as RunExecutionError).phase).toBe("validate");
  });

  it("aborts a run on a malformed graph without creating any worktree", async () => {
    const git = new FakeGitRunner();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: "/repo",
      writeInstructions: async () => {}
    });

    await expect(
      executor.run({ graph: baseGraph({ rootId: "ghost" }), config: ExecutionConfigSchema.parse({}), model: "m" })
    ).rejects.toBeInstanceOf(RunExecutionError);

    expect(git.calls.filter((call) => call.op === "worktreeAdd")).toHaveLength(0);
  });
});
