import { describe, expect, it, vi } from "vitest";

import {
  GitCandidateSandboxFactory,
  type ExecutionWorkspaceHandle,
  type ExecutionWorkspaceProvider
} from "@manyhands/execution-core";

/**
 * Stage 4 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * Validation sandboxes come from the same workspace provider as everything
 * else. They were the last productive user of `WorktreeManager`, and going
 * through it meant every sandbox took the cross-process topology lease — the
 * coordination the redesign is removing — for a worktree nobody else could
 * possibly want.
 */

const CANDIDATE = "9".repeat(40);

function fakeProvider() {
  const acquired: Array<{ runId: string; taskId: string; baseCommit: string; path: string }> = [];
  const released: string[] = [];
  const provider: ExecutionWorkspaceProvider = {
    async acquire(params): Promise<ExecutionWorkspaceHandle> {
      const path = `C:/ws/${params.runId}/${params.taskId}-${acquired.length}`;
      acquired.push({ runId: params.runId, taskId: params.taskId, baseCommit: params.baseCommit, path });
      return {
        worktree: {
          taskId: params.taskId,
          runId: params.runId,
          kind: params.kind,
          path,
          branch: `mh/${params.taskId}`,
          baseCommit: params.baseCommit,
          status: "active",
          createdAt: "2026-08-07T00:00:00.000Z"
        },
        release: async () => { released.push(path); }
      };
    }
  };
  return { provider, acquired, released };
}

function fakeGit(overrides: { status?: string[] } = {}) {
  return {
    head: vi.fn(async () => CANDIDATE),
    statusPorcelain: vi.fn(async () => overrides.status ?? [])
  };
}

describe("candidate sandbox over the workspace provider", () => {
  it("opens the sandbox at the exact candidate commit through the provider", async () => {
    const { provider, acquired } = fakeProvider();
    const git = fakeGit();
    const factory = new GitCandidateSandboxFactory(git as never, provider, "run-7");

    const sandbox = await factory.create({ candidateCommit: CANDIDATE });

    expect(acquired).toHaveLength(1);
    expect(acquired[0]!.baseCommit).toBe(CANDIDATE);
    expect(sandbox.worktreePath).toBe(acquired[0]!.path);
    expect(sandbox.headCommit).toBe(CANDIDATE);
    expect(sandbox.clean).toBe(true);
  });

  /**
   * `gcRun` reclaims orphans by walking the run's workspace root. A sandbox
   * filed under a synthesised run id lands outside that root, so a crash
   * mid-validation left a worktree nothing would ever collect.
   */
  it("files the sandbox under the real run, so run gc can reclaim an orphan", async () => {
    const { provider, acquired } = fakeProvider();
    const factory = new GitCandidateSandboxFactory(fakeGit() as never, provider, "run-7");

    await factory.create({ candidateCommit: CANDIDATE });

    expect(acquired[0]!.runId).toBe("run-7");
  });

  it("releases the workspace when the sandbox is disposed", async () => {
    const { provider, released, acquired } = fakeProvider();
    const factory = new GitCandidateSandboxFactory(fakeGit() as never, provider, "run-7");

    const sandbox = await factory.create({ candidateCommit: CANDIDATE });
    await sandbox.dispose();

    expect(released).toEqual([acquired[0]!.path]);
  });

  it("gives every sandbox its own workspace, so a baseline never shares with its candidate", async () => {
    const { provider, acquired } = fakeProvider();
    const factory = new GitCandidateSandboxFactory(fakeGit() as never, provider, "run-7");

    const first = await factory.create({ candidateCommit: CANDIDATE });
    const second = await factory.create({ candidateCommit: "1".repeat(40) });

    expect(first.worktreePath).not.toBe(second.worktreePath);
    expect(acquired).toHaveLength(2);
  });

  /**
   * The sandbox contract is "the clean exact candidate". Reporting a dirty tree
   * as clean would let validation run against a state no commit describes.
   */
  it("reports a dirty workspace rather than hiding it", async () => {
    const { provider } = fakeProvider();
    const factory = new GitCandidateSandboxFactory(fakeGit({ status: [" M src/app.ts"] }) as never, provider, "run-7");

    expect((await factory.create({ candidateCommit: CANDIDATE })).clean).toBe(false);
  });
});
