/**
 * Delivery actions for a finished run (W7). The run result lives on a fresh
 * `manyhands/run-*` branch built from the run's baseCommit (see final-apply.ts).
 * This module turns that branch into something the user can actually ship —
 * inspect the diff, merge it into the base branch, discard it, or clean up the
 * intermediate `mh/<runId>/*` branches and worktrees the run left behind.
 *
 * Every action is scoped to the run's own repo + branch and refuses to touch a
 * dirty working tree, so it never clobbers uncommitted user work.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { rmWithRetry } from "./fs-retry";
import type { RunRecord } from "./schema";

const execFileAsync = promisify(execFile);

/** Raised when a delivery action cannot proceed; the message is user-facing. */
export class DeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeliveryError";
  }
}

export interface DeliveryStatus {
  /** True when there is an applied branch to act on. */
  available: boolean;
  repoPath?: string;
  branchName?: string;
  commitSha?: string;
  /** The repo's current branch — the merge target. */
  baseBranch?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  /** Working tree has no user changes (ManyHands artifacts ignored) → safe to merge. */
  baseClean?: boolean;
  /** The applied commit is already reachable from the base branch. */
  merged?: boolean;
  reason?: string;
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim();
}

async function gitVoid(repoRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
}

/** Porcelain lines that are real user changes (ManyHands artifacts excluded). */
async function userDirtCount(repoRoot: string): Promise<number> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
  return stdout
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.slice(3).startsWith(".manyhands/")).length;
}

/** Resolve the applied repo + branch from the run, or undefined when not applied. */
function appliedTarget(run: RunRecord): { repoPath: string; branchName: string } | undefined {
  if (
    run.finalApplicationStatus === "applied" &&
    run.appliedToRepoPath !== undefined &&
    run.finalBranchName !== undefined
  ) {
    return { repoPath: run.appliedToRepoPath, branchName: run.finalBranchName };
  }
  return undefined;
}

export async function getDeliveryStatus(run: RunRecord): Promise<DeliveryStatus> {
  const target = appliedTarget(run);
  if (target === undefined) {
    return { available: false, reason: "El run no dejó una rama aplicada para entregar." };
  }
  const { repoPath, branchName } = target;

  try {
    const baseBranch = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const commitSha = run.finalCommitSha ?? (await git(repoPath, ["rev-parse", branchName]));
    const baseCommit = run.baseCommit ?? `${branchName}^`;

    let stat: { filesChanged: number; insertions: number; deletions: number } | undefined;
    try {
      const numstat = await git(repoPath, ["diff", "--numstat", `${baseCommit}..${commitSha}`]);
      const rows = numstat.split("\n").filter((line) => line.trim().length > 0);
      let insertions = 0;
      let deletions = 0;
      for (const row of rows) {
        const [add, del] = row.split("\t");
        if (add !== "-" && add !== undefined) insertions += Number(add) || 0;
        if (del !== "-" && del !== undefined) deletions += Number(del) || 0;
      }
      stat = { filesChanged: rows.length, insertions, deletions };
    } catch {
      // diff stat is best-effort; the action buttons don't depend on it.
    }

    const baseClean = (await userDirtCount(repoPath)) === 0;
    const merged = await isAncestor(repoPath, commitSha, "HEAD");

    return {
      available: true,
      repoPath,
      branchName,
      commitSha,
      baseBranch,
      ...(stat !== undefined ? stat : {}),
      baseClean,
      merged
    };
  } catch (error) {
    return { available: false, reason: describe(error) };
  }
}

async function isAncestor(repoRoot: string, maybeAncestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", maybeAncestor, descendant], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** Merge the run branch into the repo's current (base) branch. */
export async function mergeRunBranch(run: RunRecord): Promise<{ mergedInto: string }> {
  const target = appliedTarget(run);
  if (target === undefined) {
    throw new DeliveryError("El run no dejó una rama aplicada para mergear.");
  }
  const { repoPath, branchName } = target;

  if ((await userDirtCount(repoPath)) > 0) {
    throw new DeliveryError(
      "El working tree del repo tiene cambios sin commitear. Commiteá o stasheá antes de mergear."
    );
  }
  const baseBranch = await git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);

  try {
    await gitVoid(repoPath, [
      "-c",
      "user.name=ManyHands",
      "-c",
      "user.email=manyhands@local",
      "-c",
      "commit.gpgsign=false",
      "merge",
      "--no-ff",
      branchName,
      "-m",
      `mh: merge run ${run.runId} into ${baseBranch}`
    ]);
    return { mergedInto: baseBranch };
  } catch (error) {
    // Leave the repo clean on conflict rather than mid-merge.
    await gitVoid(repoPath, ["merge", "--abort"]).catch(() => undefined);
    throw new DeliveryError(
      `El merge a "${baseBranch}" tuvo conflictos y se abortó. Resolvé manualmente desde la rama "${branchName}". (${describe(error)})`
    );
  }
}

/** Delete the applied run branch (e.g. after rejecting the result). */
export async function discardRunBranch(run: RunRecord): Promise<void> {
  const target = appliedTarget(run);
  if (target === undefined) {
    throw new DeliveryError("El run no tiene una rama aplicada para descartar.");
  }
  try {
    await gitVoid(target.repoPath, ["branch", "-D", target.branchName]);
  } catch (error) {
    throw new DeliveryError(`No se pudo borrar la rama "${target.branchName}": ${describe(error)}`);
  }
}

export interface CleanupResult {
  removedBranches: number;
  prunedWorktrees: boolean;
}

/**
 * Remove the intermediate `mh/<runId>/*` branches and worktrees a run leaves
 * behind. The final `manyhands/run-*` branch is preserved (use discard for it).
 */
export async function cleanupRunArtifacts(run: RunRecord): Promise<CleanupResult> {
  const repoPath = run.appliedToRepoPath;
  if (repoPath === undefined) {
    throw new DeliveryError("El run no tiene un repo asociado para limpiar.");
  }

  // Remove the per-run worktree dir, then prune stale registrations.
  const worktreeDir = path.join(repoPath, ".manyhands", "worktrees", run.runId);
  await rmWithRetry(worktreeDir).catch(() => undefined);
  await gitVoid(repoPath, ["worktree", "prune"]).catch(() => undefined);

  // Delete leaf/root branches scoped to this run.
  let removedBranches = 0;
  try {
    const listed = await git(repoPath, ["branch", "--list", `mh/${run.runId}/*`]);
    const branches = listed
      .split("\n")
      .map((line) => line.replace(/^[*+ ]+/, "").trim())
      .filter((line) => line.length > 0);
    for (const branch of branches) {
      await gitVoid(repoPath, ["branch", "-D", branch]).catch(() => undefined);
      removedBranches += 1;
    }
  } catch {
    // No matching branches is fine.
  }

  return { removedBranches, prunedWorktrees: true };
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    // git surfaces the useful part on stderr.
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string" && stderr.trim().length > 0) return stderr.trim();
    return error.message;
  }
  return String(error);
}
