import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { describe, expect, it } from "vitest";
import {
  ExecutionConfigSchema,
  MockCodexCliExecutor,
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

function graphWith(leafIds: string[], rootContract?: AgentTaskContract): TaskGraph {
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
            acceptanceCriteria: ["criterion one"]
          }
        ])
      )
    }
  };
}

function makeExecutor(git: FakeGitRunner, traceStore: InMemoryTraceStore): RunExecutor {
  return new RunExecutor({
    git,
    codex: new MockCodexCliExecutor(),
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

  it("cleans every worktree it created after integration", async () => {
    const git = new FakeGitRunner({
      diffCached: "diff --git a/x b/x\n+added",
      diffCachedNameOnly: ["src/x.ts"],
      commitSha: "LEAF_SHA"
    });
    const executor = makeExecutor(git, new InMemoryTraceStore());

    await executor.run({ graph: graphWith(["a", "b"]), config, model: "gpt-5-codex" });

    // 2 leaves + 1 integration worktree → 3 removes, after cherry-picks.
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

  it("cleans the worktree it created even when the run throws mid-execution (I1)", async () => {
    // commit() throws after the worktree is created, so the run aborts with the
    // worktree already tracked — the finally block must still clean it.
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
      codex: new MockCodexCliExecutor(),
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

    // Must NOT throw — cleanup failures are recorded, not propagated.
    const result = await executor.run({ graph: graphWith(["a", "b"]), config, model: "gpt-5-codex" });

    expect(result.status).toBe("completed");
    // Every clean was attempted (2 leaves + 1 integration) and each failure traced.
    expect(git.calls.filter((call) => call.op === "worktreeRemove")).toHaveLength(3);
    expect(traceStore.findByType("worktree_clean_failed")).toHaveLength(3);
  });
});
