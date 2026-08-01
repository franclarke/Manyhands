import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  ExecutionConfigSchema,
  FileSystemContextPacker,
  MockAgentExecutor,
  resolveExecutorModel,
  RunExecutor,
  type DependencyInstaller,
  type ExecutorRouter,
  type ValidationRunContext,
  type ValidationRunner,
  type ValidationRunResult
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const REPO_ROOT = "/repo";
const RUN_ID = "run-1";

function leafWorktreePath(taskId: string): string {
  return `${REPO_ROOT}/.manyhands/worktrees/${RUN_ID}/${taskId}`;
}

/** Minimal contract carrying a single run-level validation command. */
function rootContractWithRunValidation(): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId: "root",
    objective: "Coordinate.",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["**"] },
    forbidden: { paths: [] },
    acceptance: [{ kind: "custom", description: "Integrated build passes." }],
    expectedOutput: { changedFiles: [], producedSymbols: [], consumedSymbols: [], diffShapeHint: "n/a" },
    limits: { maxDurationMs: 60_000, maxCostUsd: 0 },
    definitionOfDone: "Done.",
    runValidationCommands: [{ command: "pnpm", args: ["test"], timeoutMs: 60_000, cwd: "worktree" }]
  });
}

/** Minimal leaf contract carrying execution scope + forbidden paths + DoD. */
function leafContract(allowed: string[], forbidden: string[] = [], changedFiles: string[] = []): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId: "leaf",
    objective: "Implement the slice.",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: allowed },
    forbidden: { paths: forbidden },
    acceptance: [{ kind: "custom", description: "Slice works." }],
    expectedOutput: { changedFiles, producedSymbols: [], consumedSymbols: [], diffShapeHint: "n/a" },
    limits: { maxDurationMs: 60_000, maxCostUsd: 0 },
    definitionOfDone: "Slice is complete and in scope.",
    executionScope: { implementationPaths: allowed, testPaths: [], configPaths: [] },
    forbiddenPaths: forbidden
  });
}

function leafContractWithValidation(): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId: "leaf",
    objective: "Implement the slice.",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    acceptance: [{ kind: "custom", description: "Slice works." }],
    expectedOutput: {
      changedFiles: ["src/x.ts"],
      producedSymbols: [],
      consumedSymbols: [],
      diffShapeHint: "n/a"
    },
    limits: { maxDurationMs: 60_000, maxCostUsd: 0 },
    definitionOfDone: "Slice is complete and verified.",
    executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
    forbiddenPaths: [],
    leafValidationCommands: [
      { command: "pnpm", args: ["test", "--", "src/x.test.ts"], timeoutMs: 30_000, cwd: "worktree" }
    ]
  });
}

function abstractLeafContractWithValidation(): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    ...leafContractWithValidation(),
    expectedOutput: { changedFiles: [], producedSymbols: ["PublicApi"], consumedSymbols: [], diffShapeHint: "behavioral" },
    leafValidationCommands: [{ command: "pnpm", args: ["test"], timeoutMs: 30_000, cwd: "worktree" }]
  });
}

/** Minimal successful child result for driving a composite runNode integration. */
function compositeChildResult(taskId: string, commitSha: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "PARENT_BASE",
    currentHead: commitSha,
    agentCommittedUnexpectedly: false,
    diff: "patch",
    changedFiles: [`src/${taskId}.ts`],
    commitSha,
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 100,
    executorTimedOut: false
  };
}

function graphWith(
  leafIds: string[],
  rootContract?: AgentTaskContract,
  leafContractFor?: AgentTaskContract
): TaskGraph {
  return {
    id: "graph-1",
    planId: RUN_ID,
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "Build it.",
    rootId: "root",
    createdAt: "2026-05-28T00:00:00.000Z",
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
        childrenIds: leafIds,
        dependencies: [],
        ...(rootContract ? { contract: rootContract } : {})
      },
      ...Object.fromEntries(
        leafIds.map((taskId) => [
          taskId,
          {
            id: taskId,
            parentId: "root",
            kind: "leaf" as const,
            title: taskId,
            goal: `Do ${taskId}.`,
            status: "planned" as const,
            granularity: "fine" as const,
            depth: 1,
            childrenIds: [],
            dependencies: [],
            acceptanceCriteria: ["criterion one"],
            contract:
              leafContractFor !== undefined
                ? { ...leafContractFor, taskId, objective: `Implement ${taskId}.` }
                : { ...leafContract(["src/**"], [], ["src/x.ts"]), taskId, objective: `Implement ${taskId}.` }
          }
        ])
      )
    }
  };
}

function graphWithTaskScopes(scopesByTask: Record<string, string[]>): TaskGraph {
  const graph = graphWith(Object.keys(scopesByTask));
  for (const [taskId, scope] of Object.entries(scopesByTask)) {
    const node = graph.nodes[taskId];
    if (node !== undefined) {
      node.contract = { ...leafContract(scope), taskId, objective: `Implement ${taskId}.` };
    }
  }
  return graph;
}

function nestedCompositeGraph(): TaskGraph {
  return {
    id: "graph-nested",
    planId: RUN_ID,
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "Build it.",
    rootId: "root",
    createdAt: "2026-05-28T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "composite",
        title: "Root",
        goal: "Coordinate all branches.",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["child-composite"],
        dependencies: []
      },
      "child-composite": {
        id: "child-composite",
        parentId: "root",
        kind: "composite",
        title: "Child composite",
        goal: "Coordinate child leaves.",
        status: "planned",
        granularity: "medium",
        depth: 1,
        childrenIds: ["a", "b"],
        dependencies: []
      },
      a: {
        id: "a",
        parentId: "child-composite",
        kind: "leaf",
        title: "a",
        goal: "Do a.",
        status: "planned",
        granularity: "fine",
        depth: 2,
        childrenIds: [],
        dependencies: [],
        acceptanceCriteria: ["criterion one"],
        contract: { ...leafContract(["src/**"], [], ["src/x.ts"]), taskId: "a", objective: "Implement a." }
      },
      b: {
        id: "b",
        parentId: "child-composite",
        kind: "leaf",
        title: "b",
        goal: "Do b.",
        status: "planned",
        granularity: "fine",
        depth: 2,
        childrenIds: [],
        dependencies: [],
        acceptanceCriteria: ["criterion one"],
        contract: { ...leafContract(["src/**"], [], ["src/x.ts"]), taskId: "b", objective: "Implement b." }
      }
    }
  };
}

function makeExecutor(
  git: FakeGitRunner,
  traceStore: InMemoryTraceStore,
  agent = new MockAgentExecutor(),
  router?: ExecutorRouter
): RunExecutor {
  return new RunExecutor({
    git,
    executor: agent,
    traceStore,
    repoRoot: REPO_ROOT,
    ...(router !== undefined ? { router } : {}),
    // No-op so the unit test never touches the real filesystem.
    writeInstructions: async () => {}
  });
}

const config = ExecutionConfigSchema.parse({});
const fixedConfig = ExecutionConfigSchema.parse({ routing: "fixed" });

const sonnetRouter: ExecutorRouter = {
  route: () => ({ executorId: "claude-code-cli", model: "sonnet" }),
  describe: () => ({
    selection: { executorId: "claude-code-cli", model: "sonnet" },
    tier: "standard",
    complexity: { score: 0, tier: "standard", signals: [] },
    degraded: false
  })
};

describe("RunExecutor", () => {
  it("executes leaves, integrates the composite, and completes", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"]
    });
    const traceStore = new InMemoryTraceStore();
    const executor = makeExecutor(git, traceStore);

    const result = await executor.run({
      graph: graphWith(["a", "b"]),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("completed");
    expect(result.leafResults).toHaveLength(2);
    expect(result.leafResults.every((r) => r.status === "success")).toBe(true);
    expect(result.integrationResults).toHaveLength(1);
    expect(result.integrationResults[0]?.status).toBe("success");
    expect(result.granularityVector.leafCount).toBe(2);
    expect(result.granularityVector.leafSuccessRate).toBe(1);
    expect(result.granularityVector.integrationSuccessRate).toBe(1);
    expect(traceStore.findByType("run_completed")).toHaveLength(1);
  });

  it("propagates nested all-no-op composites without reusing the base as a child commit", async () => {
    const graph = nestedCompositeGraph();
    for (const taskId of ["a", "b"]) {
      const node = graph.nodes[taskId]!;
      node.contract = AgentTaskContractSchema.parse({
        ...abstractLeafContractWithValidation(),
        taskId,
        objective: `Validate ${taskId}.`,
        expectedOutput: {
          changedFiles: [],
          producedSymbols: [`Api${taskId.toUpperCase()}`],
          consumedSymbols: [],
          diffShapeHint: "behavioral"
        }
      });
    }
    const git = new FakeGitRunner({ diffCachedNameOnly: [], diffCached: "" });
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => ({ passed: true, output: "ok", exitCode: 0 })
    };
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({ graph, config, model: "gpt-5-codex" });

    expect(result.status).toBe("completed");
    expect(result.leafResults.every((entry) => entry.noOp === true && entry.commitSha === undefined)).toBe(true);
    expect(result.integrationResults.map((entry) => ({
      taskId: entry.compositeTaskId,
      status: entry.status,
      sha: entry.integrationCommitSha
    }))).toEqual([
      { taskId: "child-composite", status: "success", sha: "BASE" },
      { taskId: "root", status: "success", sha: "BASE" }
    ]);
    expect(git.opsInvoked()).not.toContain("cherryPick");
  });

  it("passes configured reasoning effort to leaf executors", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_SHA"]
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const executor = makeExecutor(git, traceStore, agent);

    await executor.run({
      graph: graphWith(["a"]),
      config: ExecutionConfigSchema.parse({ reasoningEffort: "medium" }),
      model: "gpt-5-codex"
    });

    expect(agent.calls[0]?.reasoningEffort).toBe("medium");
  });

  it("uses risk-aware scheduling by default and serializes overlapping leaf scopes", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"]
    });
    const traceStore = new InMemoryTraceStore();
    const executor = makeExecutor(git, traceStore);

    await executor.run({
      graph: graphWithTaskScopes({ a: ["src/shared/**"], b: ["src/shared/file.ts"] }),
      config,
      model: "gpt-5-codex"
    });

    expect(traceStore.findByType("batch_scheduled")[0]?.payload).toMatchObject({
      version: 1,
      source: "run-executor",
      policy: "risk_aware",
      readyTaskCount: 2,
      selectedTaskIds: ["a", "b"],
      blockedTaskIds: [],
      riskSummary: { high: 1, blocking: 0 }
    });
    expect(traceStore.findByType("batch_started").map((event) => event.payload.taskIds)).toEqual([["a"], ["b"]]);
  });

  it("rejects an invalid executable contract before dispatching an agent", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const executor = makeExecutor(git, traceStore, agent);
    const graph = graphWithTaskScopes({ a: ["src/a/**"] });
    const node = graph.nodes.a;
    if (node?.contract !== undefined) {
      node.contract = {
        ...node.contract,
        allowed: { paths: ["../secrets/**"] }
      };
    }

    await expect(
      executor.run({
        graph,
        config,
        model: "gpt-5-codex"
      })
    ).rejects.toThrow(/unsafe_contract_path|path traversal/i);

    expect(agent.calls).toEqual([]);
    expect(git.calls.some((call) => call.op === "worktreeAdd")).toBe(false);
  });

  it("runNode uses the explicit execution selection instead of the complexity router when routing is fixed", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const executor = makeExecutor(git, traceStore, agent, sonnetRouter);

    await executor.runNode({
      graph: graphWith(["a"]),
      config: fixedConfig,
      model: "sonnet",
      taskId: "a",
      runId: RUN_ID,
      defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" }
    });

    expect(agent.calls[0]?.model).toBe("gpt-5.5");
    expect(traceStore.findByType("executor_started")[0]?.payload).toMatchObject({
      executorId: "codex-cli",
      model: "gpt-5.5"
    });
  });

  it("repairLeaf uses the explicit repair selection instead of the complexity router when routing is fixed", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "REPAIR_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const executor = makeExecutor(git, traceStore, agent, sonnetRouter);

    await executor.repairLeaf({
      graph: graphWith(["a"]),
      config: fixedConfig,
      model: "sonnet",
      taskId: "a",
      runId: RUN_ID,
      validationOutput: "tests failed",
      defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.5" }
    });

    expect(agent.calls[0]?.model).toBe("gpt-5.5");
    expect(traceStore.findByType("executor_repair_started")[0]?.payload).toMatchObject({
      executorId: "codex-cli",
      model: "gpt-5.5"
    });
  });

  it("includes scope boundaries in leaf repair instructions", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/App.tsx b/src/App.tsx\n+fix",
      diffCachedNameOnly: ["src/App.tsx"],
      commitSha: "REPAIR_SHA"
    });
    const prompts: string[] = [];
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    await executor.repairLeaf({
      graph: graphWith(["a"], undefined, leafContract(["src/App.tsx", "src/App.css"], ["src/data/**"])),
      config,
      model: "gpt-5-codex",
      taskId: "a",
      runId: RUN_ID,
      validationOutput: "No test files found, exiting with code 1"
    });

    const repairPrompt = prompts[0] ?? "";
    expect(repairPrompt).toContain("Your work belongs primarily in files matching");
    expect(repairPrompt).toContain("src/App.tsx");
    expect(repairPrompt).toContain("src/App.css");
    expect(repairPrompt).toContain("You must NOT modify");
    expect(repairPrompt).toContain("src/data/**");
    expect(repairPrompt).toContain("Definition of done");
  });

  it("rejects a Claude per-node override when a Codex run is fixed", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const graph = graphWith(["a"]);
    graph.nodes.a = {
      ...graph.nodes.a!,
      metadata: { executorSelection: { executorId: "claude-code-cli", model: "sonnet" } }
    };
    const executor = makeExecutor(git, traceStore, agent, sonnetRouter);

    await expect(
      executor.runNode({
        graph,
        config: fixedConfig,
        model: "gpt-5.5",
        taskId: "a",
        runId: RUN_ID,
        defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" }
      })
    ).rejects.toThrow(/fixed to "codex-cli\/gpt-5\.5"/u);

    expect(agent.calls).toEqual([]);
  });

  it("rejects a Codex composite repair override when a Claude run is fixed", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"]
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor();
    const graph = graphWith(["a", "b"]);
    graph.nodes.root = {
      ...graph.nodes.root!,
      metadata: { executorSelection: { executorId: "codex-cli", model: "gpt-5.5" } }
    };
    const executor = makeExecutor(git, traceStore, agent);

    await expect(
      executor.run({
        graph,
        config: fixedConfig,
        model: "sonnet",
        defaultExecutionSelection: { executorId: "claude-code-cli", model: "sonnet" },
        defaultRepairSelection: { executorId: "claude-code-cli", model: "sonnet" }
      })
    ).rejects.toThrow(/fixed to "claude-code-cli\/sonnet"/u);
  });

  it("repair does not mistake the orchestrator's prior commit for an agent commit", async () => {
    // Bug B: repairLeaf re-enters the existing worktree, whose HEAD already sits
    // at the orchestrator's commit from the failed attempt. The unexpected-commit
    // detector must baseline against that current HEAD, not the original
    // baseCommit — otherwise every repair self-rejects as agent_committed_unexpectedly.
    const repairWorktree = leafWorktreePath("a");
    const git = new FakeGitRunner({
      heads: { [repairWorktree]: "ORCH_SHA" },
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+fix",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "REPAIR_SHA"
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    const { result } = await executor.repairLeaf({
      graph: graphWith(["a"]),
      config,
      model: "gpt-5-codex",
      taskId: "a",
      runId: RUN_ID,
      validationOutput: "tsc failed"
    });

    expect(result.status).toBe("success");
    expect(result.commitSha).toBe("REPAIR_SHA");
  });

  it("traces live executor stdout/stderr chunks for the running node", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const traceStore = new InMemoryTraceStore();
    const agent = new MockAgentExecutor({
      defaultBehavior: {
        stdout: "thinking visibly\n",
        stderr: "warning visibly\n"
      }
    });
    const executor = makeExecutor(git, traceStore, agent);

    const result = await executor.run({
      graph: graphWith(["a"]),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("completed");
    expect(traceStore.findByType("executor_output")).toEqual([
      expect.objectContaining({
        actor: "agent",
        taskId: "a",
        payload: { stream: "stdout", chunk: "thinking visibly\n" }
      }),
      expect.objectContaining({
        actor: "agent",
        taskId: "a",
        payload: { stream: "stderr", chunk: "warning visibly\n" }
      })
    ]);
  });

  it("resolves executor models from node metadata with run-model fallback", () => {
    const graph = graphWith(["a"]);
    const leaf = graph.nodes.a!;
    expect(resolveExecutorModel(leaf, "sonnet")).toEqual({
      executorId: "claude-code-cli",
      model: "sonnet"
    });
    leaf.metadata = { executorOverride: { executorId: "claude-code-cli", model: "haiku" } };
    expect(resolveExecutorModel(leaf, "sonnet")).toEqual({
      executorId: "claude-code-cli",
      model: "haiku"
    });
  });

  it("uses per-node model overrides for leaves and composite repair", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA", "REPAIR_SHA"],
      cherryPickOutcomes: [
        { ok: false, conflictFiles: ["src/x.ts"], output: "conflict" },
        { ok: true, conflictFiles: [], output: "" }
      ]
    });
    const agent = new MockAgentExecutor();
    const traceStore = new InMemoryTraceStore();
    const graph = graphWith(["a", "b"]);
    graph.nodes.a = {
      ...graph.nodes.a!,
      metadata: { executorOverride: { executorId: "claude-code-cli", model: "haiku" } }
    };
    graph.nodes.root = {
      ...graph.nodes.root!,
      metadata: { executorOverride: { executorId: "claude-code-cli", model: "opus" } }
    };
    const executor = new RunExecutor({
      git,
      executor: agent,
      traceStore,
      repoRoot: REPO_ROOT,
      writeInstructions: async () => {}
    });

    await executor.run({
      graph,
      // Per-node overrides are a complexity-routing feature. Product runs use
      // fixed routing by default and correctly reject mismatched overrides.
      config: ExecutionConfigSchema.parse({ routing: "complexity" }),
      model: "sonnet"
    });

    expect(agent.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cwd: leafWorktreePath("a"), model: "haiku" }),
        expect.objectContaining({ cwd: leafWorktreePath("b"), model: "sonnet" }),
        expect.objectContaining({ cwd: leafWorktreePath("root"), model: "opus" })
      ])
    );
    expect(traceStore.findByType("executor_started")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "a",
          payload: expect.objectContaining({ executorId: "claude-code-cli", model: "haiku" })
        })
      ])
    );
    expect(traceStore.findByType("executor_repair_started")[0]?.payload).toMatchObject({
      executorId: "claude-code-cli",
      model: "opus"
    });
  });

  it("threads the configured reasoning effort into a composite integration repair (runNode)", async () => {
    // The web pipeline integrates one composite at a time via runNode. That path
    // built the repair params WITHOUT `reasoningEffort`, so a Codex conflict
    // repair silently ran at its default (high) effort instead of the run's
    // configured effort — much slower, and it timed out on real UI merge
    // conflicts (E2E 2026-07-06). The composite repair executor call must carry
    // the run's configured effort, exactly like leaf execution does.
    const git = new FakeGitRunner({
      diffCached: "resolved patch",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "REPAIR_SHA",
      cherryPickOutcomes: [
        { ok: true, conflictFiles: [], output: "" },
        { ok: false, conflictFiles: ["src/x.ts"], output: "conflict" }
      ]
    });
    const agent = new MockAgentExecutor();
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: agent,
      traceStore,
      repoRoot: REPO_ROOT,
      writeInstructions: async () => {}
    });

    await executor.runNode({
      graph: graphWith(["a", "b"]),
      config: ExecutionConfigSchema.parse({ reasoningEffort: "low" }),
      model: "sonnet",
      taskId: "root",
      runId: RUN_ID,
      childResults: [compositeChildResult("a", "SHA_A"), compositeChildResult("b", "SHA_B")]
    });

    // runNode on a composite runs no leaves — the only executor call is the
    // conflict repair. Assert it actually ran, then that it carried the effort.
    expect(traceStore.findByType("executor_repair_started").length).toBeGreaterThan(0);
    expect(agent.calls).toHaveLength(1);
    expect(agent.calls[0]?.reasoningEffort).toBe("low");
  });

  it("cleans every worktree it created after integration", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"]
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    await executor.run({ graph: graphWith(["a", "b"]), config, model: "gpt-5-codex" });

    // 2 leaves + 1 integration worktree â†’ 3 removes, after cherry-picks.
    const removes = git.calls.filter((call) => call.op === "worktreeRemove");
    expect(removes).toHaveLength(3);
    const lastCherryPick = git.opsInvoked().lastIndexOf("cherryPick");
    const firstRemove = git.opsInvoked().indexOf("worktreeRemove");
    expect(firstRemove).toBeGreaterThan(lastCherryPick);
  });

  it("fails the run when a leaf produces no diff", async () => {
    const git = new FakeGitRunner({ diffCachedNameOnly: [] });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    const result = await executor.run({
      graph: graphWith(["a", "b"]),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("failed");
    expect(result.leafResults.every((r) => r.status === "empty_diff")).toBe(true);
  });

  it("propagates failed composite integration to ancestor composites", async () => {
    const git = new FakeGitRunner({ diffCachedNameOnly: [] });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    const result = await executor.run({
      graph: nestedCompositeGraph(),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("failed");
    expect(result.integrationResults).toHaveLength(2);
    expect(result.integrationResults.map((entry) => entry.compositeTaskId)).toEqual([
      "child-composite",
      "root"
    ]);
    expect(result.integrationResults.map((entry) => entry.status)).toEqual([
      "child_failed",
      "child_failed"
    ]);
  });

  it("cleans the worktree it created even when the run throws mid-execution (I1)", async () => {
    // commit() throws after the worktree is created, so the run aborts with the
    // worktree already tracked â€” the finally block must still clean it.
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      failOperations: { commit: new Error("boom") }
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    await expect(
      executor.run({ graph: graphWith(["a"]), config, model: "gpt-5-codex" })
    ).rejects.toThrow("boom");

    const removes = git.calls.filter((call) => call.op === "worktreeRemove");
    expect(removes).toHaveLength(1);
    expect(removes[0]?.args.worktreePath).toBe(leafWorktreePath("a"));
  });

  it("runs run-level validation against the root integration worktree (I6)", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"]
    });
    const captured: ValidationRunContext[] = [];
    const validationRunner: ValidationRunner = {
      run: async (_commands, ctx): Promise<ValidationRunResult> => {
        captured.push(ctx);
        return { passed: true, output: "", exitCode: 0 };
      }
    };
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a", "b"], rootContractWithRunValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("completed");
    expect(captured).toHaveLength(1);
    // The integrated tree lives in the root composite's integration worktree.
    expect(captured[0]?.worktreePath).toBe(leafWorktreePath("root"));
  });

  it("installs dependencies in the integration worktree before run-level validation", async () => {
    // Fix 4: the composed tree of a greenfield project has a package.json but no
    // node_modules, so run-level checks (build/typecheck) would fail for missing
    // deps. Install once, in the integration worktree, before validation runs.
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"]
    });
    const order: string[] = [];
    const installedIn: string[] = [];
    const dependencyInstaller: DependencyInstaller = {
      ensure: async ({ cwd }) => {
        installedIn.push(cwd);
        order.push("install");
        return { installed: true, packageManager: "npm" };
      }
    };
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => {
        order.push("validate");
        return { passed: true, output: "", exitCode: 0 };
      }
    };
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      validationRunner,
      dependencyInstaller,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a", "b"], rootContractWithRunValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("completed");
    expect(installedIn).toEqual([leafWorktreePath("root")]);
    expect(order).toEqual(["install", "validate"]);
  });

  it("treats failed leaf validation as the leaf result, even after a valid diff", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const captured: ValidationRunContext[] = [];
    const validationRunner: ValidationRunner = {
      run: async (_commands, ctx): Promise<ValidationRunResult> => {
        captured.push(ctx);
        return { passed: false, output: "unit test failed", exitCode: 1 };
      }
    };
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContractWithValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("failed");
    expect(result.leafResults[0]?.status).toBe("validation_failed");
    expect(result.leafResults[0]?.validationResult).toMatchObject({
      passed: false,
      output: "unit test failed",
      exitCode: 1
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.worktreePath).toBe(leafWorktreePath("a"));
    expect(traceStore.findByType("validation_started")[0]?.payload).toMatchObject({
      scope: "leaf",
      commandCount: 1
    });
    expect(traceStore.findByType("validation_completed")[0]?.payload).toMatchObject({
      scope: "leaf",
      passed: false,
      exitCode: 1,
      commandCount: 1
    });
  });

  it("records an abstract no-diff contract as already_satisfied only after explicit validation passes", async () => {
    const git = new FakeGitRunner({ diffCachedNameOnly: [] });
    const validationRunner: ValidationRunner = {
      run: async () => ({ passed: true, output: "verified", exitCode: 0 })
    };
    const executor = new RunExecutor({
      git, executor: new MockAgentExecutor(), traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT, validationRunner, writeInstructions: async () => {}
    });
    const graph = graphWith(["a"], undefined, abstractLeafContractWithValidation());
    const nodeResult = await executor.runNode({
      graph, config, model: "gpt-5-codex", runId: RUN_ID, taskId: "a"
    });
    expect(nodeResult.kind).toBe("leaf");
    if (nodeResult.kind !== "leaf") throw new Error("expected leaf");
    expect(nodeResult.result).toMatchObject({
      status: "success", disposition: "already_satisfied", noOp: true,
      validationResult: { passed: true }
    });
  });

  it("defers leaf validation (leaf still succeeds) when the toolchain is missing (exit 127)", async () => {
    // A leaf branches from the base in isolation, so a project-wide check like
    // `npx tsc --noEmit` finds no installed TypeScript and exits 127. That is an
    // infra gap at the leaf altitude, not broken code — the leaf must succeed and
    // verification is deferred to run-level (post-compose). Without this, every
    // greenfield run wedges at the leaf gate.
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => ({
        passed: false,
        output: "This is not the tsc command you are looking for",
        exitCode: 127
      })
    };
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContractWithValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.leafResults[0]?.status).toBe("success");
    expect(result.status).toBe("completed");
    expect(traceStore.findByType("validation_deferred")).toHaveLength(1);
    expect(traceStore.findByType("validation_deferred")[0]?.payload).toMatchObject({
      scope: "leaf",
      exitCode: 127
    });
  });

  it("defers leaf validation when the package manager cannot read package.json (missing manifest)", async () => {
    // A greenfield leaf branches from the walking skeleton, which carries no
    // package.json. A leaf that touches only `src/**` (and does not itself
    // author a manifest) makes an npm-based validation command exit with ENOENT
    // ("Could not read package.json"). That is an infra gap at the leaf
    // altitude — the manifest is composed later — not broken code, so the leaf
    // must succeed and verification is deferred to run level. Without this,
    // real greenfield runs wedge at the leaf gate (observed E2E 2026-07-06).
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => ({
        passed: false,
        output:
          'npm error code ENOENT\n' +
          'npm error syscall open\n' +
          'npm error path C:\\repo\\.manyhands\\worktrees\\run-1\\a\\package.json\n' +
          'npm error errno -4058\n' +
          'npm error enoent Could not read package.json: Error: ENOENT: no such file or directory, ' +
          "open 'C:\\repo\\.manyhands\\worktrees\\run-1\\a\\package.json'",
        // Windows surfaces ENOENT as errno -4058 (uint32 4294963238); the
        // classifier must key off the output, not this platform-specific code.
        exitCode: 4294963238
      })
    };
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContractWithValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.leafResults[0]?.status).toBe("success");
    expect(result.status).toBe("completed");
    expect(traceStore.findByType("validation_deferred")).toHaveLength(1);
    expect(traceStore.findByType("validation_deferred")[0]?.payload).toMatchObject({
      scope: "leaf",
      reason: "manifest_missing"
    });
  });

  it("defers leaf validation when a test runner reports no test files", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => ({
        passed: false,
        output: "No test files found, exiting with code 1",
        exitCode: 1
      })
    };
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContractWithValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.leafResults[0]?.status).toBe("success");
    expect(result.status).toBe("completed");
    expect(traceStore.findByType("validation_deferred")).toHaveLength(1);
    expect(traceStore.findByType("validation_deferred")[0]?.payload).toMatchObject({
      scope: "leaf",
      exitCode: 1,
      reason: "no_tests_found"
    });
  });

  it('defers leaf validation when the workspace has no "test" script', async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/src/x.ts b/src/x.ts\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const validationRunner: ValidationRunner = {
      run: async (): Promise<ValidationRunResult> => ({
        passed: false,
        output:
          'npm error Missing script: "test"\n' +
          "npm error\n" +
          "npm error To see a list of scripts, run:\n" +
          "npm error   npm run",
        exitCode: 1
      })
    };
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: REPO_ROOT,
      validationRunner,
      writeInstructions: async () => {}
    });

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContractWithValidation()),
      config,
      model: "gpt-5-codex"
    });

    expect(result.leafResults[0]?.status).toBe("success");
    expect(result.status).toBe("completed");
    expect(traceStore.findByType("validation_deferred")).toHaveLength(1);
    expect(traceStore.findByType("validation_deferred")[0]?.payload).toMatchObject({
      scope: "leaf",
      exitCode: 1,
      reason: "missing_test_script"
    });
  });

  it("keeps cleaning and preserves the result when a worktree clean fails (I8)", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["LEAF_A_SHA", "LEAF_B_SHA"],
      failOperations: {
        worktreeRemove: new Error("rm failed"),
        worktreePrune: new Error("prune failed")
      }
    });
    const traceStore = new InMemoryTraceStore();
    const executor = makeExecutor(git, traceStore);

    // Must NOT throw â€” cleanup failures are recorded, not propagated.
    const result = await executor.run({ graph: graphWith(["a", "b"]), config, model: "gpt-5-codex" });

    expect(result.status).toBe("completed");
    // Every clean was attempted (2 leaves + 1 integration) and each failure traced.
    expect(git.calls.filter((call) => call.op === "worktreeRemove")).toHaveLength(3);
    expect(traceStore.findByType("worktree_clean_failed")).toHaveLength(3);
  });

  it("enforces forbidden paths: a forbidden change fails the run (Etapa A)", async () => {
    // The agent 'changed' a forbidden file. Forbidden paths are the hard boundary.
    const git = new FakeGitRunner({
      diffCached: "diff --git a/secrets/leak.ts b/secrets/leak.ts\n+leak",
      diffCachedNameOnly: ["secrets/leak.ts"],
      commitSha: "LEAF_SHA"
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContract(["src/**"], ["secrets/**"])),
      config,
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("failed");
    expect(result.leafResults[0]?.status).toBe("scope_violation");
    expect(result.leafResults[0]?.scopeCheck.violations).toEqual(["secrets/leak.ts"]);
    // Scope violations must not be committed.
    expect(git.opsInvoked()).not.toContain("commit");
  });

  it("treats an out-of-allow-list (but not forbidden) change as advisory: the run still completes", async () => {
    // Under the explicit advisory policy the allow-list is an LLM guess; a file
    // outside it that is not forbidden must not fail the run. It commits and is
    // recorded in scopeCheck.outOfScope.
    const git = new FakeGitRunner({
      diffCached: "diff --git a/index.html b/index.html\n+ui",
      diffCachedNameOnly: ["index.html"],
      commitSha: "LEAF_SHA"
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContract(["src/**"])),
      config: { ...config, scopePolicy: "advisory" },
      model: "gpt-5-codex"
    });

    expect(result.status).toBe("completed");
    expect(result.leafResults[0]?.status).toBe("success");
    expect(result.leafResults[0]?.scopeCheck.violations).toEqual([]);
    expect(result.leafResults[0]?.scopeCheck.outOfScope).toEqual(["index.html"]);
    expect(git.opsInvoked()).toContain("commit");
  });

  it("includes scope and definition-of-done in the leaf instructions (Etapa A)", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const prompts: string[] = [];
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    await executor.run({
      graph: graphWith(["a"], undefined, leafContract(["src/**"], ["secrets/**"])),
      config,
      model: "gpt-5-codex"
    });

    const leafPrompt = prompts[0] ?? "";
    expect(leafPrompt).toContain("Your work belongs primarily in files matching");
    expect(leafPrompt).toContain("src/**");
    expect(leafPrompt).toContain("You must NOT modify");
    expect(leafPrompt).toContain("secrets/**");
    expect(leafPrompt).toContain("Definition of done");
  });

  it("keeps canonically ordered leaves on the immutable base", async () => {
    const graph = graphWith(["a", "b"]);
    graph.dependencies = [{
      fromTaskId: "a",
      toTaskId: "b",
      type: "logical",
      inferred: false,
      rationale: "B is dispatched after A"
    }];
    const git = new FakeGitRunner({
      diffCached: "diff",
      diffCachedNameOnly: ["src/x.ts"],
      commitShas: ["A_SHA", "B_SHA"]
    });
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      writeInstructions: async () => undefined
    });

    const result = await executor.run({ graph, config, model: "gpt-5-codex" });

    expect(result.status).toBe("completed");
    const leafWorktrees = git.calls.filter((call) =>
      call.op === "worktreeAdd" && String(call.args.worktreePath).includes("/.manyhands/worktrees/run-1/")
    );
    expect(leafWorktrees.filter((call) => ["a", "b"].some((id) => String(call.args.worktreePath).endsWith(`/${id}`))))
      .toHaveLength(2);
    expect(leafWorktrees.filter((call) => ["a", "b"].some((id) => String(call.args.worktreePath).endsWith(`/${id}`)))
      .every((call) => call.args.baseCommit === "BASE")).toBe(true);
  });

  it("injects consumed and produced interface seams into the leaf prompt", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff",
      diffCachedNameOnly: ["src/parser.ts"],
      commitSha: "LEAF_SHA"
    });
    const prompts: string[] = [];
    const contract = AgentTaskContractSchema.parse({
      taskId: "leaf",
      objective: "Build the parser",
      context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
      allowed: { paths: ["src/**"] },
      forbidden: { paths: [] },
      acceptance: [{ kind: "custom", description: "parses" }],
      expectedOutput: { changedFiles: ["src/parser.ts"], producedSymbols: [], consumedSymbols: [] },
      limits: { maxDurationMs: 60_000, maxCostUsd: 0 },
      definitionOfDone: "parser works",
      executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
      forbiddenPaths: [],
      consumedInterfaces: [
        { id: "Token", kind: "type", signature: "type Token = { kind: string }", description: "lexical token", definedAtNodeId: "root" }
      ],
      producedInterfaces: [
        { id: "Ast", kind: "type", signature: "type Ast = number | { op: string }", description: "parsed tree", definedAtNodeId: "root" }
      ]
    });
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore: new InMemoryTraceStore(),
      repoRoot: REPO_ROOT,
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    const graph = graphWith(["tokenizer", "parser"]);
    graph.nodes.tokenizer!.contract = {
      ...leafContract(["src/**"], [], ["src/tokenizer.ts"]),
      taskId: "tokenizer",
      objective: "Build the tokenizer",
      producedInterfaces: [
        { id: "Token", kind: "type", signature: "type Token = { kind: string }", description: "lexical token", definedAtNodeId: "root" }
      ]
    };
    graph.nodes.parser!.contract = { ...contract, taskId: "parser", objective: "Build the parser" };

    await executor.run({
      graph,
      config,
      model: "gpt-5-codex"
    });

    const leafPrompt = prompts.find((prompt) => prompt.includes("type Ast = number")) ?? "";
    expect(leafPrompt).toContain("Build EXACTLY against these signatures");
    expect(leafPrompt).toContain("type Token = { kind: string }");
    expect(leafPrompt).toContain("MUST expose these interfaces");
    expect(leafPrompt).toContain("type Ast = number");
  });

  it("injects worktree file context into the leaf prompt (Etapa B)", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const prompts: string[] = [];
    const traceStore = new InMemoryTraceStore();
    const executor = new RunExecutor({
      git,
      executor: new MockAgentExecutor(),
      traceStore,
      repoRoot: REPO_ROOT,
      // Deterministic packer: no disk, returns known content for the target file.
      contextPacker: new FileSystemContextPacker({
        readFile: async (p) => (p.endsWith("x.ts") ? "export const current = 1;" : Promise.reject(new Error("missing")))
      }),
      writeInstructions: async (_path, content) => {
        prompts.push(content);
      }
    });

    await executor.run({
      graph: graphWith(["a"], undefined, leafContract(["src/**"], [], ["src/x.ts"])),
      config,
      model: "gpt-5-codex"
    });

    const leafPrompt = prompts[0] ?? "";
    expect(leafPrompt).toContain("Current contents of the files you will work on");
    expect(leafPrompt).toContain("export const current = 1;");
    expect(traceStore.findByType("context_packed")).toHaveLength(1);
  });
});
