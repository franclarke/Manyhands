import { win32 } from "node:path";
import { describe, expect, it } from "vitest";

import { EphemeralExecutionWorkspaceProvider } from "@manyhands/execution-core";

/**
 * Stage 4 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * A workspace is created fresh from the base commit, used once, and destroyed.
 * The pool it replaces recycled a fixed set of slots, and recycling is the only
 * reason any of the coordination existed: a slot handed from one attempt to the
 * next has to be sanitised, and sanitation has to be fenced against the previous
 * owner. Nothing here is shared, so there is nothing to fence.
 */

const BASE = "1".repeat(40);
const CANDIDATE = "2".repeat(40);

interface GitCall { op: string; worktreePath?: string; ref?: string; candidateCommit?: string }

function fakeGit(overrides: Partial<Record<"add" | "remove", () => Promise<void>>> = {}) {
  const calls: GitCall[] = [];
  const live = new Set<string>();
  return {
    calls,
    live,
    async add({ worktreePath }: { repoRoot: string; worktreePath: string; baseCommit: string }) {
      if (live.has(worktreePath)) throw new Error(`${worktreePath} already exists`);
      await overrides.add?.();
      live.add(worktreePath);
      calls.push({ op: "add", worktreePath });
    },
    async remove({ worktreePath }: { repoRoot: string; worktreePath: string }) {
      await overrides.remove?.();
      live.delete(worktreePath);
      calls.push({ op: "remove", worktreePath });
    },
    async updateRef({ ref, candidateCommit }: { repoRoot: string; ref: string; candidateCommit: string }) {
      calls.push({ op: "updateRef", ref, candidateCommit });
    }
  };
}

function providerWith(git: ReturnType<typeof fakeGit>) {
  return new EphemeralExecutionWorkspaceProvider({
    repoRoot: "C:/repo",
    worktreesRoot: "C:/workspaces",
    platform: "linux",
    git,
    now: () => "2026-08-07T00:00:00.000Z"
  });
}

const params = (taskId: string) => ({ taskId, runId: "run-1", kind: "leaf" as const, baseCommit: BASE });

describe("ephemeral execution workspace", () => {
  it("creates a fresh workspace from the base commit and destroys it on release", async () => {
    const git = fakeGit();
    const handle = await providerWith(git).acquire(params("task-a"));

    expect(handle.worktree.baseCommit).toBe(BASE);
    expect(git.live.has(handle.worktree.path)).toBe(true);

    await handle.release();

    expect(git.live.size).toBe(0);
    expect(git.calls.map((call) => call.op)).toEqual(["add", "remove"]);
  });

  it("never hands the same path to two attempts, even for one task", async () => {
    const git = fakeGit();
    const provider = providerWith(git);
    const [first, second] = await Promise.all([provider.acquire(params("task-a")), provider.acquire(params("task-a"))]);

    expect(first.worktree.path).not.toBe(second.worktree.path);
    await Promise.all([first.release(), second.release()]);
  });

  /**
   * A commit that lives only inside a removed worktree is unreachable, so it
   * would be collected. Anchoring has to happen while the workspace still
   * exists — the order is the guarantee, not an optimisation.
   */
  it("anchors a candidate commit under a ref before destroying the workspace", async () => {
    const git = fakeGit();
    const handle = await providerWith(git).acquire(params("task-a"));

    await handle.release({ kind: "candidate", runId: "run-1", attemptId: "attempt-1", candidateCommit: CANDIDATE });

    const ops = git.calls.map((call) => call.op);
    expect(ops).toEqual(["add", "updateRef", "remove"]);
    const anchor = git.calls.find((call) => call.op === "updateRef")!;
    expect(anchor.candidateCommit).toBe(CANDIDATE);
    expect(anchor.ref).toContain("run-1");
    expect(anchor.ref).toContain("attempt-1");
  });

  it("anchors retries for a long target within the Windows path budget without colliding", async () => {
    const git = fakeGit();
    const repoRoot = `C:/${"r".repeat(135)}`;
    const provider = new EphemeralExecutionWorkspaceProvider({
      repoRoot,
      worktreesRoot: "C:/mh-sp2/cell",
      platform: "win32",
      git,
      now: () => "2026-08-07T00:00:00.000Z"
    });
    const runId = "209c3e59-8c99-448e-a32d-dabd967d7a10";
    const taskId = "node-domain-priority-backorder-6f4918a2e6";
    const first = await provider.acquire({ taskId, runId, kind: "leaf", baseCommit: BASE });
    const second = await provider.acquire({ taskId, runId, kind: "leaf", baseCommit: BASE });

    await first.release({ kind: "candidate", runId, attemptId: `${runId}:attempt:${taskId}:1`, candidateCommit: CANDIDATE });
    await second.release({ kind: "candidate", runId, attemptId: `${runId}:attempt:${taskId}:2`, candidateCommit: CANDIDATE });

    const refs = git.calls.filter((call) => call.op === "updateRef").map((call) => call.ref!);
    expect(refs).toHaveLength(2);
    expect(new Set(refs).size).toBe(2);
    for (const ref of refs) {
      expect(win32.join(repoRoot, ".git", ref).length).toBeLessThanOrEqual(260);
    }
  });

  it("is idempotent, so a double release cannot remove a workspace twice", async () => {
    const git = fakeGit();
    const handle = await providerWith(git).acquire(params("task-a"));

    await handle.release();
    await handle.release();

    expect(git.calls.filter((call) => call.op === "remove")).toHaveLength(1);
  });


  /**
   * Keyed by repository, not held per instance. A per-instance turnstile would
   * make the guarantee depend on every caller remembering to share one
   * provider — correctness by convention, which is how it silently stops
   * holding the day someone constructs a second one.
   */
  it("serializes across separate providers over the same repository", async () => {
    let concurrent = 0;
    let peak = 0;
    const enter = async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
    };
    const git = fakeGit({ add: enter });
    const [first, second] = await Promise.all([
      providerWith(git).acquire(params("task-a")),
      providerWith(git).acquire(params("task-b"))
    ]);

    expect(peak).toBe(1);
    await Promise.all([first.release(), second.release()]);
  });

  /**
   * `git worktree add` and `remove` mutate metadata shared by the whole
   * repository. The run has a single owner process by construction, so an
   * in-process turnstile is enough — and it is the entire coordination this
   * layer needs, where the pool required fenced leases per slot.
   */
  it("serializes topology mutations against each other", async () => {
    let concurrent = 0;
    let peak = 0;
    const enter = async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
    };
    const git = fakeGit({ add: enter, remove: enter });
    const provider = providerWith(git);

    const handles = await Promise.all([1, 2, 3, 4].map((index) => provider.acquire(params(`task-${index}`))));
    await Promise.all(handles.map((handle) => handle.release()));

    expect(peak).toBe(1);
  });

  /**
   * A workspace that could not be destroyed is a leak the operator has to know
   * about; swallowing it is how a disk fills up silently.
   */
  it("surfaces a failure to destroy the workspace", async () => {
    const git = fakeGit({ remove: async () => { throw new Error("worktree busy"); } });
    const handle = await providerWith(git).acquire(params("task-a"));

    await expect(handle.release()).rejects.toThrow(/worktree busy/u);
  });
});
