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
            ...(leafContractFor ? { contract: leafContractFor } : {})
          }
        ])
      )
    }
  };
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
        acceptanceCriteria: ["criterion one"]
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
        acceptanceCriteria: ["criterion one"]
      }
    }
  };
}

function makeExecutor(git: FakeGitRunner, traceStore: InMemoryTraceStore): RunExecutor {
  return new RunExecutor({
    git,
    executor: new MockAgentExecutor(),
    traceStore,
    repoRoot: REPO_ROOT,
    // No-op so the unit test never touches the real filesystem.
    writeInstructions: async () => {}
  });
}

const config = ExecutionConfigSchema.parse({});

describe("RunExecutor", () => {
  it("executes leaves, integrates the composite, and completes", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
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

  it("resolves executor models from node metadata with run-model fallback", () => {
    const graph = graphWith(["a"]);
    const leaf = graph.nodes.a!;
    expect(resolveExecutorModel(leaf, "gemini-2.5-pro")).toEqual({
      executorId: "gemini-cli",
      model: "gemini-2.5-pro"
    });
    leaf.metadata = { executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-flash" } };
    expect(resolveExecutorModel(leaf, "gemini-2.5-pro")).toEqual({
      executorId: "gemini-cli",
      model: "gemini-2.5-flash"
    });
  });

  it("uses per-node model overrides for leaves and composite repair", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "SHA",
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
      metadata: { executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-flash" } }
    };
    graph.nodes.root = {
      ...graph.nodes.root!,
      metadata: { executorOverride: { executorId: "gemini-cli", model: "gemini-2.5-pro" } }
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
      config,
      model: "gemini-default"
    });

    expect(agent.calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cwd: leafWorktreePath("a"), model: "gemini-2.5-flash" }),
        expect.objectContaining({ cwd: leafWorktreePath("b"), model: "gemini-default" }),
        expect.objectContaining({ cwd: leafWorktreePath("root"), model: "gemini-2.5-pro" })
      ])
    );
    expect(traceStore.findByType("executor_started")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "a",
          payload: expect.objectContaining({ executorId: "gemini-cli", model: "gemini-2.5-flash" })
        })
      ])
    );
    expect(traceStore.findByType("executor_repair_started")[0]?.payload).toMatchObject({
      executorId: "gemini-cli",
      model: "gemini-2.5-pro"
    });
  });

  it("cleans every worktree it created after integration", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
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
      commitSha: "LEAF_SHA"
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

  it("keeps cleaning and preserves the result when a worktree clean fails (I8)", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA",
      failOperations: { worktreeRemove: new Error("rm failed") }
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
    // The allow-list is an LLM guess; a file outside it that is not forbidden must
    // not fail the run. It commits and is recorded in scopeCheck.outOfScope.
    const git = new FakeGitRunner({
      diffCached: "diff --git a/index.html b/index.html\n+ui",
      diffCachedNameOnly: ["index.html"],
      commitSha: "LEAF_SHA"
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    const result = await executor.run({
      graph: graphWith(["a"], undefined, leafContract(["src/**"])),
      config,
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

    await executor.run({
      graph: graphWith(["a"], undefined, contract),
      config,
      model: "gpt-5-codex"
    });

    const leafPrompt = prompts[0] ?? "";
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
