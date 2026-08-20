import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";
import {
  WorktreeError,
  WorktreeManager,
  SimpleGitRunner,
  runWorktreesRootFor,
  safeWorktreeSegment,
  worktreePathFor,
  type WorktreeRecord
} from "@manyhands/execution-core";

import { FakeGitRunner } from "./helpers/fake-git-runner";

const REPO_ROOT = "/repo";
const WORKTREES_ROOT = "/repo/.manyhands/worktrees";
const execFileAsync = promisify(execFile);

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

describe("WorktreeManager.gcRun", () => {
  it("retries a physical removal failure without orphaning worktree metadata or its branch", async () => {
    const { root, repoRoot, baseCommit } = await initializePhysicalRepository("mh-wt-gc-retry-");
    try {
      const manager = new WorktreeManager({ git: new FailOnceWorktreeRemoveGit(), repoRoot });
      const record = await manager.create({
        taskId: "task-a",
        runId: "run-a",
        kind: "leaf",
        baseCommit
      });

      expect(await manager.gcRun("run-a")).toEqual({ removed: [], failed: ["task-a"] });
      expect(await manager.gcRun("run-a")).toEqual({ removed: ["task-a"], failed: [] });

      await expectPhysicalWorktreeGone(repoRoot, record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not treat a non-ENOENT run-root read failure as an empty run", async () => {
    const root = await mkdtemp(join(tmpdir(), "mh-wt-gc-read-error-"));
    const worktreesRoot = join(root, "worktrees");
    try {
      await mkdir(worktreesRoot, { recursive: true });
      await writeFile(join(worktreesRoot, safeWorktreeSegment("run-error")), "not a directory", "utf8");
      const manager = new WorktreeManager({
        git: new FakeGitRunner(),
        repoRoot: join(root, "repo"),
        worktreesRoot
      });

      await expect(manager.gcRun("run-error")).rejects.toMatchObject({ code: "ENOTDIR" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces a run-root removal failure instead of publishing false cleanup success", async () => {
    const root = await mkdtemp(join(tmpdir(), "mh-wt-gc-root-remove-"));
    const worktreesRoot = join(root, "worktrees");
    const runRoot = join(worktreesRoot, safeWorktreeSegment("run-root-remove"));
    try {
      await mkdir(join(runRoot, "task-a"), { recursive: true });
      const manager = new WorktreeManager({
        git: new FakeGitRunner(),
        repoRoot: join(root, "repo"),
        worktreesRoot,
        removePath: async (target) => {
          if (target.replaceAll("\\", "/") === runRoot.replaceAll("\\", "/")) {
            throw new Error("simulated run-root lock");
          }
          await rm(target, { recursive: true, force: true });
        }
      });

      await expect(manager.gcRun("run-root-remove")).rejects.toThrow(/run-root lock/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("surfaces worktree-prune failure instead of publishing false cleanup success", async () => {
    const root = await mkdtemp(join(tmpdir(), "mh-wt-gc-prune-error-"));
    const worktreesRoot = join(root, "worktrees");
    const runRoot = join(worktreesRoot, safeWorktreeSegment("run-prune-error"));
    try {
      await mkdir(join(runRoot, "task-a"), { recursive: true });
      const manager = new WorktreeManager({
        git: new FakeGitRunner({
          failOperations: { worktreePrune: new Error("simulated prune failure") }
        }),
        repoRoot: join(root, "repo"),
        worktreesRoot
      });

      await expect(manager.gcRun("run-prune-error")).rejects.toThrow(/prune failure/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists a branch-only retry when branch deletion fails after physical worktree removal", async () => {
    const { root, repoRoot, baseCommit } = await initializePhysicalRepository("mh-wt-gc-branch-retry-");
    try {
      const manager = new WorktreeManager({ git: new FailOnceBranchDeleteGit(), repoRoot });
      const record = await manager.create({
        taskId: "task-a",
        runId: "run-a",
        kind: "leaf",
        baseCommit
      });

      expect(await manager.gcRun("run-a")).toEqual({ removed: [], failed: ["task-a"] });
      expect(await manager.gcRun("run-a")).toEqual({ removed: ["task-a"], failed: [] });

      await expectPhysicalWorktreeGone(repoRoot, record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists branch cleanup before physical removal so crash recovery cannot orphan the branch", async () => {
    const { root, repoRoot, baseCommit } = await initializePhysicalRepository("mh-wt-gc-crash-window-");
    try {
      const crashGit = new CrashAfterPhysicalWorktreeRemovalGit();
      const manager = new WorktreeManager({ git: crashGit, repoRoot });
      const record = await manager.create({
        taskId: "task-a",
        runId: "run-a",
        kind: "leaf",
        baseCommit
      });

      expect(await manager.gcRun("run-a")).toEqual({ removed: [], failed: ["task-a"] });
      expect(crashGit.obligationObservedBeforeRemove).toBe(true);

      const restartedManager = new WorktreeManager({ git: new SimpleGitRunner(), repoRoot });
      expect(await restartedManager.gcRun("run-a")).toEqual({ removed: ["task-a"], failed: [] });
      await expectPhysicalWorktreeGone(repoRoot, record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an ambiguous branch-delete error only when the branch ref is confirmed absent", async () => {
    const { root, repoRoot, baseCommit } = await initializePhysicalRepository("mh-wt-gc-branch-absent-");
    try {
      const manager = new WorktreeManager({ git: new DeleteThenThrowBranchGit(), repoRoot });
      const record = await manager.create({
        taskId: "task-a",
        runId: "run-a",
        kind: "leaf",
        baseCommit
      });

      expect(await manager.gcRun("run-a")).toEqual({ removed: ["task-a"], failed: [] });

      await expectPhysicalWorktreeGone(repoRoot, record);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("propagates an unclassifiable branch-ref probe failure instead of assuming absence", async () => {
    const { root, repoRoot, baseCommit } = await initializePhysicalRepository("mh-wt-gc-branch-probe-");
    try {
      const manager = new WorktreeManager({ git: new FailBranchAndRefProbeGit(), repoRoot });
      await manager.create({
        taskId: "task-a",
        runId: "run-a",
        kind: "leaf",
        baseCommit
      });

      await expect(manager.gcRun("run-a")).rejects.toThrow(/simulated ref probe I\/O failure/u);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

async function git(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    windowsHide: true,
    encoding: "utf8"
  });
  return stdout.trim();
}

async function initializePhysicalRepository(prefix: string): Promise<{
  root: string;
  repoRoot: string;
  baseCommit: string;
}> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const repoRoot = join(root, "repo");
  await mkdir(repoRoot, { recursive: true });
  await git(repoRoot, "init", "-b", "main");
  await git(repoRoot, "config", "user.email", "worktree@example.test");
  await git(repoRoot, "config", "user.name", "Worktree Test");
  await writeFile(join(repoRoot, "README.md"), "base\n", "utf8");
  await git(repoRoot, "add", "README.md");
  await git(repoRoot, "commit", "-m", "base");
  return { root, repoRoot, baseCommit: await git(repoRoot, "rev-parse", "HEAD") };
}

async function expectPhysicalWorktreeGone(repoRoot: string, record: WorktreeRecord): Promise<void> {
  expect(await git(repoRoot, "worktree", "list", "--porcelain"))
    .not.toContain(record.path.replaceAll("\\", "/"));
  expect(await git(repoRoot, "branch", "--list", record.branch)).toBe("");
  const metadata = await readdir(join(repoRoot, ".git", "worktrees")).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  expect(metadata).toEqual([]);
  expect(await git(repoRoot, "status", "--porcelain=v1", "--untracked-files=all")).toBe("");
}

class FailOnceWorktreeRemoveGit extends SimpleGitRunner {
  private failNextRemove = true;

  override async worktreeRemove(params: Parameters<SimpleGitRunner["worktreeRemove"]>[0]): Promise<void> {
    if (this.failNextRemove) {
      this.failNextRemove = false;
      throw new Error("simulated transient worktree lock");
    }
    await super.worktreeRemove(params);
  }
}

class FailOnceBranchDeleteGit extends SimpleGitRunner {
  private failNextDelete = true;

  override async branchDelete(params: Parameters<SimpleGitRunner["branchDelete"]>[0]): Promise<void> {
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("simulated transient branch lock");
    }
    await super.branchDelete(params);
  }
}

class CrashAfterPhysicalWorktreeRemovalGit extends SimpleGitRunner {
  obligationObservedBeforeRemove = false;

  override async worktreeRemove(params: Parameters<SimpleGitRunner["worktreeRemove"]>[0]): Promise<void> {
    const markerPath = join(
      dirname(params.worktreePath),
      ".manyhands-branch-cleanup",
      basename(params.worktreePath)
    );
    this.obligationObservedBeforeRemove = await access(markerPath).then(
      () => true,
      () => false
    );
    await super.worktreeRemove(params);
    throw new Error("simulated daemon crash after physical worktree removal");
  }
}

class DeleteThenThrowBranchGit extends SimpleGitRunner {
  override async branchDelete(params: Parameters<SimpleGitRunner["branchDelete"]>[0]): Promise<void> {
    await super.branchDelete(params);
    throw new Error("simulated ambiguous branch deletion result");
  }
}

class FailBranchAndRefProbeGit extends SimpleGitRunner {
  override async branchDelete(): Promise<void> {
    throw new Error("simulated branch deletion failure");
  }

  override async revParse(): Promise<string> {
    throw new Error("simulated ref probe I/O failure");
  }
}
