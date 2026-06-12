/**
 * INV-3 — physical world reconciliation over a REAL git repo.
 *
 * Cases (matching the PR-3 design):
 *  (a) result whose evidence commit resolves → kept;
 *  (b) leftover worktree without a recorded result (died mid-leaf) → swept;
 *  (c) result whose evidence commit vanished → invalidated;
 *  (d) stale index.lock → removed.
 *  base commit unreachable → not resumable.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SimpleGitRunner, reconcileWorld } from "@manyhands/execution-core";

let tempDir: string;
let repoRoot: string;
let baseCommit: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-reconcile-"));
  repoRoot = path.join(tempDir, "repo");
  execFileSync("git", ["init", "-b", "main", repoRoot], { encoding: "utf8" });
  git(repoRoot, "config", "user.email", "test@mh.local");
  git(repoRoot, "config", "user.name", "MH Test");
  git(repoRoot, "commit", "--allow-empty", "-m", "base");
  baseCommit = git(repoRoot, "rev-parse", "HEAD");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

/** Create a leaf worktree with one evidence commit, mirroring the executor. */
function makeLeafEvidence(runId: string, taskId: string): string {
  const worktreePath = path.join(repoRoot, ".manyhands", "worktrees", runId, taskId);
  git(repoRoot, "worktree", "add", worktreePath, "-b", `mh/${runId}/${taskId}`, baseCommit);
  git(worktreePath, "commit", "--allow-empty", "-m", `mh: ${taskId}`);
  return git(worktreePath, "rev-parse", "HEAD");
}

describe("reconcileWorld", () => {
  it("keeps valid evidence, invalidates vanished commits, sweeps orphans, removes stale locks", async () => {
    const runId = "run-rec";
    // (a) valid evidence: real commit on a leaf branch.
    const validSha = makeLeafEvidence(runId, "task-a");
    // (b) orphan worktree, no recorded result (crashed mid-leaf).
    git(
      repoRoot,
      "worktree",
      "add",
      path.join(repoRoot, ".manyhands", "worktrees", runId, "task-c"),
      "-b",
      `mh/${runId}/task-c`,
      baseCommit
    );
    // (d) stale index.lock left by a killed git process.
    await writeFile(path.join(repoRoot, ".git", "index.lock"), "", "utf8");

    const report = await reconcileWorld({
      git: new SimpleGitRunner(),
      repoRoot,
      runId,
      baseCommit,
      leafEvidence: [
        { taskId: "task-a", commitSha: validSha },
        // (c) recorded evidence whose commit no longer exists.
        { taskId: "task-b", commitSha: "0123456789abcdef0123456789abcdef01234567" },
        // failed result without evidence commit: untouched by reconciliation.
        { taskId: "task-d" }
      ],
      integrationEvidence: []
    });

    expect(report.baseCommitReachable).toBe(true);
    expect(report.keptTaskIds).toEqual(["task-a"]);
    expect(report.invalidatedTaskIds).toEqual(["task-b"]);
    expect(report.cleanedWorktrees.sort()).toEqual(["task-a", "task-c"]);
    expect(report.gcFailures).toEqual([]);
    expect(report.removedLocks).toEqual(["index.lock"]);

    // Physical assertions: worktrees gone and lock removed, but the branch of
    // the KEPT result survives — it anchors the evidence commit against a
    // future `git gc` (sweeping must never destroy recorded evidence).
    expect(existsSync(path.join(repoRoot, ".manyhands", "worktrees", runId))).toBe(false);
    expect(git(repoRoot, "branch", "--list", `mh/${runId}/*`)).toContain(`mh/${runId}/task-a`);
    expect(git(repoRoot, "branch", "--list", `mh/${runId}/task-c`)).toBe("");
    expect(existsSync(path.join(repoRoot, ".git", "index.lock"))).toBe(false);
    expect(git(repoRoot, "rev-parse", `mh/${runId}/task-a`)).toBe(validSha);
  });

  it("reports the run as not resumable when the base commit vanished", async () => {
    const report = await reconcileWorld({
      git: new SimpleGitRunner(),
      repoRoot,
      runId: "run-gone",
      baseCommit: "feedfacefeedfacefeedfacefeedfacefeedface",
      leafEvidence: [{ taskId: "task-a", commitSha: baseCommit }],
      integrationEvidence: []
    });
    expect(report.baseCommitReachable).toBe(false);
    // With an unreachable base nothing is "kept" — every evidence needs re-grounding.
    expect(report.keptTaskIds).toEqual([]);
    expect(report.invalidatedTaskIds).toEqual(["task-a"]);
    expect(report.warnings.length).toBeGreaterThan(0);
  });

  it("is a no-op on a consistent world", async () => {
    const runId = "run-clean";
    const validSha = makeLeafEvidence(runId, "task-a");
    // Executor already cleaned its worktree after recording the result.
    git(repoRoot, "worktree", "remove", "--force", path.join(repoRoot, ".manyhands", "worktrees", runId, "task-a"));

    const report = await reconcileWorld({
      git: new SimpleGitRunner(),
      repoRoot,
      runId,
      baseCommit,
      leafEvidence: [{ taskId: "task-a", commitSha: validSha }],
      integrationEvidence: []
    });
    expect(report.keptTaskIds).toEqual(["task-a"]);
    expect(report.invalidatedTaskIds).toEqual([]);
    expect(report.cleanedWorktrees).toEqual([]);
    expect(report.removedLocks).toEqual([]);
  });
});
