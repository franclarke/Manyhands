import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import {
  WorktreeError,
  WorktreeManager,
  runWorktreesRootFor,
  safeWorktreeSegment,
  worktreePathFor,
  type WorktreeRecord
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const REPO_ROOT = "/repo";
const WORKTREES_ROOT = "/repo/.manyhands/worktrees";

function makeManager(git: FakeGitRunner): WorktreeManager {
  return new WorktreeManager({
    git,
    repoRoot: REPO_ROOT,
    worktreesRoot: WORKTREES_ROOT,
    now: () => "2026-05-28T00:00:00.000Z"
  });
}

describe("WorktreeManager.create", () => {
  it("invokes git worktree add with the derived path and branch", async () => {
    const git = new FakeGitRunner();
    const manager = makeManager(git);

    const record = await manager.create({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    expect(git.calls).toHaveLength(1);
    expect(git.calls[0]).toEqual({
      op: "worktreeAdd",
      args: {
        repoRoot: REPO_ROOT,
        worktreePath: "/repo/.manyhands/worktrees/run-1/task-1",
        branch: "mh/run-1/task-1",
        baseCommit: "BASE_SHA"
      }
    });
    expect(record).toMatchObject({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      path: "/repo/.manyhands/worktrees/run-1/task-1",
      branch: "mh/run-1/task-1",
      baseCommit: "BASE_SHA",
      status: "active",
      createdAt: "2026-05-28T00:00:00.000Z"
    });
  });

  it("uses filesystem- and git-ref-safe physical names without changing the logical task id", async () => {
    const git = new FakeGitRunner();
    const manager = makeManager(git);
    const taskId = "task:ui";
    const safeTaskId = safeWorktreeSegment(taskId);

    const record = await manager.create({
      taskId,
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    expect(safeTaskId).not.toContain(":");
    expect(record.taskId).toBe(taskId);
    expect(record.path).toBe(`/repo/.manyhands/worktrees/run-1/${safeTaskId}`);
    expect(record.branch).toBe(`mh/run-1/${safeTaskId}`);
    expect(git.calls[0]?.args).toMatchObject({
      worktreePath: `/repo/.manyhands/worktrees/run-1/${safeTaskId}`,
      branch: `mh/run-1/${safeTaskId}`
    });
  });

  it("wraps git failures in a WorktreeError with operation 'create'", async () => {
    const git = new FakeGitRunner({
      failOperations: { worktreeAdd: new Error("fatal: branch exists") }
    });
    const manager = makeManager(git);

    await expect(
      manager.create({ taskId: "task-1", runId: "run-1", kind: "leaf", baseCommit: "BASE_SHA" })
    ).rejects.toSatisfy((err) => WorktreeError.is(err) && err.operation === "create");
  });

  it("serializes topology changes across managers for the same repository", async () => {
    const git = new FakeGitRunner();
    let activeAdds = 0;
    let maxConcurrentAdds = 0;
    const add = git.worktreeAdd.bind(git);
    git.worktreeAdd = async (params) => {
      activeAdds += 1;
      maxConcurrentAdds = Math.max(maxConcurrentAdds, activeAdds);
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        await add(params);
      } finally {
        activeAdds -= 1;
      }
    };

    await Promise.all([
      makeManager(git).create({ taskId: "task-a", runId: "run-a", kind: "leaf", baseCommit: "BASE_SHA" }),
      makeManager(git).create({ taskId: "task-b", runId: "run-b", kind: "leaf", baseCommit: "BASE_SHA" })
    ]);

    expect(maxConcurrentAdds).toBe(1);
  });
});

describe("WorktreeManager.clean", () => {
  it("removes the worktree and deletes the branch", async () => {
    const git = new FakeGitRunner();
    const manager = makeManager(git);
    const record = await manager.create({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    const cleaned = await manager.clean(record);

    expect(git.opsInvoked()).toEqual(["worktreeAdd", "worktreeRemove", "branchDelete"]);
    expect(cleaned.status).toBe("cleaned");
    expect(cleaned.cleanedAt).toBe("2026-05-28T00:00:00.000Z");
  });

  it("wraps git failures in a WorktreeError with operation 'clean'", async () => {
    const git = new FakeGitRunner({
      failOperations: { worktreeRemove: new Error("fatal: locked") }
    });
    const manager = new WorktreeManager({
      git,
      repoRoot: REPO_ROOT,
      worktreesRoot: WORKTREES_ROOT,
      removePath: async () => { throw new Error("physical directory still locked"); },
      now: () => "2026-05-28T00:00:00.000Z"
    });
    const record: WorktreeRecord = {
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      path: "/repo/.manyhands/worktrees/run-1/task-1",
      branch: "mh/run-1/task-1",
      baseCommit: "BASE_SHA",
      status: "active",
      createdAt: "2026-05-28T00:00:00.000Z"
    };

    await expect(manager.clean(record)).rejects.toSatisfy(
      (err) => WorktreeError.is(err) && err.operation === "clean"
    );
  });

  it("still deletes the branch when worktree removal fails", async () => {
    const git = new FakeGitRunner({
      failOperations: { worktreeRemove: new Error("fatal: locked") }
    });
    const manager = makeManager(git);
    const record: WorktreeRecord = {
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      path: "/repo/.manyhands/worktrees/run-1/task-1",
      branch: "mh/run-1/task-1",
      baseCommit: "BASE_SHA",
      status: "active",
      createdAt: "2026-05-28T00:00:00.000Z"
    };

    await expect(manager.clean(record)).resolves.toMatchObject({ status: "cleaned" });
    expect(git.opsInvoked()).toContain("branchDelete");
  });
});

describe("win32 long-path relocation ('$GIT_DIR' too big / Filename too long)", () => {
  // git-for-windows dies with `fatal: '$GIT_DIR' too big` when a worktree's
  // gitdir path exceeds PATH_MAX(260) - 40 = 220 chars, and with "Filename too
  // long" past 260 without core.longpaths. A repo this deep must push its run
  // worktrees to a short tmpdir-based root instead.
  const LONG_REPO_ROOT = `C:/${"a".repeat(160)}`;

  it("relocates the run's worktrees to a short tmpdir root on win32 when the repo-based path would exceed git's budget", async () => {
    const git = new FakeGitRunner();
    const manager = new WorktreeManager({
      git,
      repoRoot: LONG_REPO_ROOT,
      platform: "win32",
      tmpdir: () => "C:/Temp",
      now: () => "2026-05-28T00:00:00.000Z"
    });

    const record = await manager.create({
      taskId: "http-layer",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    expect(git.calls[0]).toEqual({
      op: "worktreeAdd",
      args: {
        repoRoot: LONG_REPO_ROOT,
        worktreePath: "C:/Temp/mh-wt/run-1/http-layer",
        branch: "mh/run-1/http-layer",
        baseCommit: "BASE_SHA"
      }
    });
    expect(record.path).toBe("C:/Temp/mh-wt/run-1/http-layer");
    // Branch naming is untouched: evidence commits stay anchored to mh/<run>/<task>.
    expect(record.branch).toBe("mh/run-1/http-layer");
  });

  it("keeps the repo-based root on win32 when the projected path fits the budget", async () => {
    const git = new FakeGitRunner();
    const manager = new WorktreeManager({
      git,
      repoRoot: REPO_ROOT,
      platform: "win32",
      tmpdir: () => "C:/Temp",
      now: () => "2026-05-28T00:00:00.000Z"
    });

    const record = await manager.create({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    expect(record.path).toBe("/repo/.manyhands/worktrees/run-1/task-1");
  });

  it("never relocates on non-Windows platforms", async () => {
    const git = new FakeGitRunner();
    const manager = new WorktreeManager({
      git,
      repoRoot: LONG_REPO_ROOT,
      platform: "linux",
      tmpdir: () => "/tmp",
      now: () => "2026-05-28T00:00:00.000Z"
    });

    const record = await manager.create({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    expect(record.path).toBe(`${LONG_REPO_ROOT}/.manyhands/worktrees/run-1/task-1`);
  });

  it("worktreePathFor and runWorktreesRootFor expose the same relocation rule for external callers", () => {
    const relocatedRoot = runWorktreesRootFor({
      worktreesRoot: `${LONG_REPO_ROOT}/.manyhands/worktrees`,
      runId: "run-1",
      platform: "win32",
      tmpdir: () => "C:/Temp"
    });
    expect(relocatedRoot).toBe("C:/Temp/mh-wt/run-1");

    const path = worktreePathFor({
      worktreesRoot: `${LONG_REPO_ROOT}/.manyhands/worktrees`,
      runId: "run-1",
      taskId: "http-layer",
      platform: "win32",
      tmpdir: () => "C:/Temp"
    });
    expect(path).toBe("C:/Temp/mh-wt/run-1/http-layer");

    const kept = worktreePathFor({
      worktreesRoot: "/repo/.manyhands/worktrees",
      runId: "run-1",
      taskId: "task-1",
      platform: "win32",
      tmpdir: () => "C:/Temp"
    });
    expect(kept).toBe("/repo/.manyhands/worktrees/run-1/task-1");
  });

  it("gcRun sweeps the relocated run root so cancel/cleanup finds the same directory create used", async () => {
    const base = await mkdtemp(join(tmpdir(), "mh-wt-test-"));
    try {
      const git = new FakeGitRunner();
      const manager = new WorktreeManager({
        git,
        repoRoot: LONG_REPO_ROOT,
        platform: "win32",
        tmpdir: () => base,
        now: () => "2026-05-28T00:00:00.000Z"
      });
      const relocated = join(base, "mh-wt", "run-1", "task-x");
      await mkdir(relocated, { recursive: true });

      const result = await manager.gcRun("run-1");

      expect(result.removed).toEqual(["task-x"]);
      expect(
        git.calls.some(
          (call) => call.op === "worktreeRemove" && String(call.args.worktreePath).includes("task-x")
        )
      ).toBe(true);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

describe("WorktreeManager.detectUnexpectedCommit", () => {
  it("reports no commit when HEAD equals the base commit", async () => {
    const git = new FakeGitRunner();
    const manager = makeManager(git);
    const record = await manager.create({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });

    const detection = await manager.detectUnexpectedCommit(record);

    expect(detection).toEqual({ committed: false });
  });

  it("reports the new sha when the agent committed (HEAD moved)", async () => {
    const git = new FakeGitRunner();
    const manager = makeManager(git);
    const record = await manager.create({
      taskId: "task-1",
      runId: "run-1",
      kind: "leaf",
      baseCommit: "BASE_SHA"
    });
    git.heads[record.path] = "AGENT_SHA";

    const detection = await manager.detectUnexpectedCommit(record);

    expect(detection).toEqual({ committed: true, sha: "AGENT_SHA" });
  });
});
