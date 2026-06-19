import { describe, expect, it } from "vitest";
import { WorktreeError, WorktreeManager, safeWorktreeSegment, type WorktreeRecord } from "@manyhands/execution-core";

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

    await expect(manager.clean(record)).rejects.toSatisfy(
      (err) => WorktreeError.is(err) && err.operation === "clean"
    );
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
