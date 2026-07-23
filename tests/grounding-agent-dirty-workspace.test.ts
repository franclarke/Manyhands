import { describe, expect, it, vi } from "vitest";
import { GroundingAgent, type GitRunner } from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";

function createMockGit(overrides: Partial<GitRunner> = {}): GitRunner {
  return {
    worktreeAdd: vi.fn().mockResolvedValue(undefined),
    worktreeRemove: vi.fn().mockResolvedValue(undefined),
    worktreePrune: vi.fn().mockResolvedValue(undefined),
    branchDelete: vi.fn().mockResolvedValue(undefined),
    head: vi.fn().mockResolvedValue("head-commit-sha-123"),
    revParse: vi.fn().mockResolvedValue("sha"),
    isAncestor: vi.fn().mockResolvedValue(true),
    cherryPickHead: vi.fn().mockResolvedValue(undefined),
    unmergedFiles: vi.fn().mockResolvedValue([]),
    statusPorcelain: vi.fn().mockResolvedValue([]),
    restoreManagedWorktree: vi.fn().mockResolvedValue(undefined),
    addAll: vi.fn().mockResolvedValue(undefined),
    addAllExcluding: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue("new-commit-sha-456"),
    commitMessage: vi.fn().mockResolvedValue("message"),
    diffCached: vi.fn().mockResolvedValue(""),
    diffCachedNameOnly: vi.fn().mockResolvedValue([]),
    diffCachedNumstat: vi.fn().mockResolvedValue(0),
    diffRange: vi.fn().mockResolvedValue(""),
    diffRangeNameOnly: vi.fn().mockResolvedValue([]),
    diffRangeNumstat: vi.fn().mockResolvedValue(0),
    cherryPick: vi.fn().mockResolvedValue({ ok: true, conflictFiles: [], output: "" }),
    cherryPickAbort: vi.fn().mockResolvedValue(undefined),
    createIntegrationHandoff: vi.fn().mockResolvedValue("handoff-sha"),
    showFile: vi.fn().mockResolvedValue(null),
    ...overrides
  };
}

function createMockGraph(): TaskGraph {
  return {
    id: "graph-1",
    planId: "plan-1",
    repo: "/mock/repo",
    baseBranch: "main",
    baseCommit: "head-commit-sha-123",
    featureRequest: "dirty-workspace-test",
    nodes: {},
    dependencies: [],
    rootId: "root",
    createdAt: "2026-07-22T00:00:00.000Z"
  };
}

describe("GroundingAgent dirty workspace check (MH-REM-001)", () => {
  it("allows execution when the workspace is clean", async () => {
    const mockGit = createMockGit({
      statusPorcelain: vi.fn().mockResolvedValue([])
    });
    const agent = new GroundingAgent({ git: mockGit });
    const emptyGraph: TaskGraph = createMockGraph();

    const result = await agent.run({
      repoRoot: "/mock/repo",
      graph: emptyGraph,
      runId: "run-clean-123"
    });

    expect(mockGit.statusPorcelain).toHaveBeenCalledWith("/mock/repo");
    expect(result).toBe("head-commit-sha-123");
  });

  it("rejects execution when modified files are present", async () => {
    const mockGit = createMockGit({
      statusPorcelain: vi.fn().mockResolvedValue([" M packages/core/src/index.ts"])
    });
    const agent = new GroundingAgent({ git: mockGit });
    const emptyGraph: TaskGraph = createMockGraph();

    await expect(
      agent.run({
        repoRoot: "/mock/repo",
        graph: emptyGraph,
        runId: "run-dirty-1"
      })
    ).rejects.toThrow("GroundingAgent cannot run in a dirty workspace. Uncommitted changes detected:\n M packages/core/src/index.ts");

    expect(mockGit.statusPorcelain).toHaveBeenCalledWith("/mock/repo");
    expect(mockGit.commit).not.toHaveBeenCalled();
    expect(mockGit.head).not.toHaveBeenCalled();
  });

  it("rejects execution when untracked files are present", async () => {
    const mockGit = createMockGit({
      statusPorcelain: vi.fn().mockResolvedValue(["?? temp-file.txt", " M src/app.ts"])
    });
    const agent = new GroundingAgent({ git: mockGit });
    const emptyGraph: TaskGraph = createMockGraph();

    await expect(
      agent.run({
        repoRoot: "/mock/repo",
        graph: emptyGraph,
        runId: "run-dirty-2"
      })
    ).rejects.toThrow("GroundingAgent cannot run in a dirty workspace");

    expect(mockGit.commit).not.toHaveBeenCalled();
  });
});
