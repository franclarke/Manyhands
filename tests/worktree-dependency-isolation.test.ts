import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { WorktreeManager } from "@manyhands/execution-core";
import { FakeGitRunner } from "./helpers/fake-git-runner";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

class FilesystemGitRunner extends FakeGitRunner {
  override async worktreeAdd(params: { repoRoot: string; worktreePath: string; branch: string; baseCommit: string }): Promise<void> {
    await mkdir(params.worktreePath, { recursive: true });
    return super.worktreeAdd(params);
  }
}

describe("worktree dependency isolation", () => {
  it("never creates a node_modules link to the source checkout", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mh-worktree-deps-"));
    dirs.push(root);
    await mkdir(path.join(root, "node_modules", "source-only"), { recursive: true });
    const manager = new WorktreeManager({ git: new FilesystemGitRunner(), repoRoot: root, worktreesRoot: path.join(root, ".manyhands", "worktrees") });
    const record = await manager.create({ taskId: "leaf", runId: "run", kind: "leaf", baseCommit: "BASE" });
    await expect(lstat(path.join(record.path, "node_modules"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
