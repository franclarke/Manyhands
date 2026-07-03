/**
 * World reconciler (INV-3) — physical filesystem vs. recorded execution state.
 *
 * A cold restart (server crash, HMR drop, cancel) resumes a run from its
 * checkpoint, but the checkpoint only describes the LOGICAL state. The
 * physical world — git commits, worktrees, lock files — may have diverged:
 * a leaf died mid-write, a branch was deleted, `git gc` collected a commit.
 * Resuming blindly over that divergence corrupts the run.
 *
 * `reconcileWorld` runs BEFORE re-entering the execution graph on a cold
 * restart and produces a report the host acts on:
 *  - results whose evidence commit no longer resolves are INVALIDATED (the
 *    leaf/composite re-enters the wavefront);
 *  - every leftover worktree of the run is swept (a fresh leaf execution
 *    cannot `git worktree add` over a stale directory);
 *  - a stale `index.lock` in the main repo is removed (no process of this run
 *    is alive on a cold restart — cancel verifies kills, a crash killed them).
 *
 * The reconciler never touches the user's branches or commits; it only acts
 * on ManyHands-owned artifacts (mh/<runId>/* branches, .manyhands/worktrees,
 * git locks).
 */
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { execLog, execWarn } from "../logging/log";
import type { GitRunner } from "../git/runner";
import { WorktreeManager } from "../worktree/manager";

/** Minimal evidence shape: anything recorded with a commit to validate. */
export interface RecordedEvidence {
  taskId: string;
  /** Evidence commit (leaf commitSha / integrationCommitSha). Absent for failed results. */
  commitSha?: string | undefined;
}

export interface ReconcileWorldParams {
  git: GitRunner;
  repoRoot: string;
  runId: string;
  /** The skeleton commit every leaf branches from. Unreachable ⇒ not resumable. */
  baseCommit: string;
  leafEvidence: RecordedEvidence[];
  integrationEvidence: RecordedEvidence[];
}

export interface ReconciliationReport {
  /** False ⇒ the run cannot be resumed against this repo (export/abort path). */
  baseCommitReachable: boolean;
  /** Results whose evidence commit still resolves — safe to seed. */
  keptTaskIds: string[];
  /** Results whose evidence commit vanished — must re-execute. */
  invalidatedTaskIds: string[];
  /** Leftover worktree directories swept (by taskId). */
  cleanedWorktrees: string[];
  /** Worktrees that could not be removed (manual attention). */
  gcFailures: string[];
  /** Stale git locks removed. */
  removedLocks: string[];
  warnings: string[];
}

async function commitResolves(git: GitRunner, repoRoot: string, sha: string): Promise<boolean> {
  try {
    await git.revParse(repoRoot, `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

export async function reconcileWorld(params: ReconcileWorldParams): Promise<ReconciliationReport> {
  const { git, repoRoot, runId } = params;
  const warnings: string[] = [];

  const baseCommitReachable = await commitResolves(git, repoRoot, params.baseCommit);
  if (!baseCommitReachable) {
    warnings.push(
      `Base commit ${params.baseCommit} is unreachable in ${repoRoot} — the run cannot resume against this repo.`
    );
  }

  // Validate recorded evidence: a result is only as real as its commit.
  const keptTaskIds: string[] = [];
  const invalidatedTaskIds: string[] = [];
  for (const evidence of [...params.leafEvidence, ...params.integrationEvidence]) {
    if (evidence.commitSha === undefined) {
      // Failed/aborted results carry no evidence commit; nothing physical to
      // validate — they re-enter their normal retry/gate path untouched.
      continue;
    }
    if (baseCommitReachable && (await commitResolves(git, repoRoot, evidence.commitSha))) {
      keptTaskIds.push(evidence.taskId);
    } else {
      invalidatedTaskIds.push(evidence.taskId);
      warnings.push(
        `Evidence commit ${evidence.commitSha} of task ${evidence.taskId} no longer resolves — the task will re-execute.`
      );
    }
  }

  // Sweep every leftover worktree of the run: completed leaves don't need
  // theirs anymore (the commit lives in the repo), half-written ones are
  // garbage, and a fresh execution cannot create a worktree over a stale dir.
  // Branches of KEPT evidence survive — they anchor the evidence commits.
  const manager = new WorktreeManager({ git, repoRoot });
  const sweep = await manager.gcRun(runId, { preserveBranchesFor: new Set(keptTaskIds) });

  // A cold restart owns the repo: no process of this run is alive, so a
  // surviving index.lock is a crash artifact that would fail every git op.
  const removedLocks: string[] = [];
  const indexLock = join(repoRoot, ".git", "index.lock");
  try {
    await stat(indexLock);
    await rm(indexLock, { force: true });
    removedLocks.push("index.lock");
    warnings.push("Removed stale .git/index.lock left behind by a crashed process.");
  } catch {
    // No lock — the common case.
  }

  const report: ReconciliationReport = {
    baseCommitReachable,
    keptTaskIds,
    invalidatedTaskIds,
    cleanedWorktrees: sweep.removed,
    gcFailures: sweep.failed,
    removedLocks,
    warnings
  };

  if (invalidatedTaskIds.length > 0 || sweep.removed.length > 0 || removedLocks.length > 0) {
    execWarn("reconcile", "world diverged from recorded state — repaired", {
      runId,
      invalidated: invalidatedTaskIds,
      cleanedWorktrees: sweep.removed.length,
      locks: removedLocks
    });
  } else {
    execLog("reconcile", "world consistent with recorded state", { runId, kept: keptTaskIds.length });
  }
  return report;
}
