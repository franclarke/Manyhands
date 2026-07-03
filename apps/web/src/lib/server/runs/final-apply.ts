import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { RunExecutionResult } from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";

import { resolveManyhandsPath } from "../repo-root";
import { rmWithRetry } from "./fs-retry";
import type { ProvisionedRepo } from "./repo-provisioner";

const execFileAsync = promisify(execFile);

/**
 * Outcome of writing a finished run back to the target repo.
 * - `applied`: the integrated result lives on a fresh `manyhands/run-*` branch.
 * - `exported_patch`: the branch could not be created (e.g. apply conflict), so
 *   the patch was written to disk for the user to apply manually.
 * - `failed`: not even a base-relative patch could be produced (unreachable
 *   base commit / empty patch). Recorded, never thrown — no opaque crash.
 */
export type FinalApplicationStatus = "applied" | "exported_patch" | "failed";

/**
 * Serializable subset persisted on the RunRecord after a successful run. Every
 * key is a RunRecord field so the runner can spread it straight into the store.
 */
export interface FinalApplicationRecord {
  finalApplicationStatus: FinalApplicationStatus;
  finalPatch?: string;
  finalBranchName?: string;
  finalCommitSha?: string;
  appliedToRepoPath?: string;
  appliedAt?: string;
  exportedPatchPath?: string;
  baseCommit?: string;
  integrationCommitSha?: string;
  finalApplicationMessage?: string;
}

/**
 * Slugifies free text into a git-ref-safe segment: lowercase, alnum runs
 * collapsed to single dashes, trimmed, capped. Never empty.
 */
export function slugifyForBranch(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug.length > 0 ? slug : "run";
}

/** Stable, collision-resistant branch name for a run's final result. */
export function buildRunBranchName(runId: string, slug: string): string {
  return `manyhands/run-${slugifyForBranch(runId)}-${slugifyForBranch(slug)}`;
}

/**
 * Writes a completed run back to the target repo on a **new branch** built from
 * the run's `baseCommit`, leaving the user's working tree and current branch
 * untouched. Uses an isolated detached worktree so the apply never disturbs the
 * checked-out state — even if the repo moved (HEAD advanced) or is dirty. On any
 * failure it degrades to exporting the patch or recording a `failed` status,
 * never an opaque mid-run crash.
 */
export async function applyFinalPatch(input: {
  graph: TaskGraph;
  result: RunExecutionResult;
  provisioned: ProvisionedRepo;
  runId: string;
  /** Free text (run title / prompt) used to make the branch name readable. */
  slug: string;
}): Promise<FinalApplicationRecord | undefined> {
  const integrationCommitSha = resolveFinalCommit(input.graph, input.result);
  if (integrationCommitSha === undefined) {
    return undefined;
  }

  const repoRoot = input.provisioned.repoRoot;
  const baseCommit = input.provisioned.baseCommit;

  // The base commit must be reachable to produce a base-relative patch. If the
  // user orphaned it (hard reset / rebase), record a failure instead of crashing.
  if (!(await commitExists(repoRoot, baseCommit))) {
    return {
      finalApplicationStatus: "failed",
      baseCommit,
      integrationCommitSha,
      finalApplicationMessage:
        `The base commit ${baseCommit} is no longer reachable in ${repoRoot}. ` +
        "The run result could not be applied; re-run from the current HEAD."
    };
  }

  const finalPatch = await gitRaw(repoRoot, ["diff", `${baseCommit}..${integrationCommitSha}`]);
  if (finalPatch.trim().length === 0) {
    return {
      finalApplicationStatus: "failed",
      baseCommit,
      integrationCommitSha,
      finalApplicationMessage: "Execution completed but the final integrated patch is empty."
    };
  }

  const branchName = buildRunBranchName(input.runId, input.slug);
  const worktreeParent = resolveManyhandsPath("apply");
  const worktreePath = path.join(worktreeParent, input.runId);

  try {
    await mkdir(worktreeParent, { recursive: true });
    await rmWithRetry(worktreePath);
    // Clear any stale worktree registration from a prior interrupted run so the
    // add below doesn't fail with "already registered" on Windows.
    await gitVoid(repoRoot, ["worktree", "prune"]).catch(() => undefined);
    // Isolated checkout at baseCommit: never touches the user's working tree.
    await gitVoid(repoRoot, ["worktree", "add", "--detach", worktreePath, baseCommit]);
    await gitWithStdin(worktreePath, ["apply", "--index", "-"], finalPatch);
    await gitVoid(worktreePath, [
      "-c",
      "user.name=ManyHands",
      "-c",
      "user.email=manyhands@local",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      `mh: apply run ${input.runId}`
    ]);
    const finalCommitSha = await git(worktreePath, ["rev-parse", "HEAD"]);
    // Point (or move) the run branch at the applied commit in the main repo.
    await gitVoid(repoRoot, ["branch", "-f", branchName, finalCommitSha]);

    return {
      finalApplicationStatus: "applied",
      finalPatch,
      finalBranchName: branchName,
      finalCommitSha,
      appliedToRepoPath: repoRoot,
      appliedAt: new Date().toISOString(),
      baseCommit,
      integrationCommitSha
    };
  } catch (error) {
    // Could not create the branch (worktree/apply failure): keep the work
    // recoverable by exporting the patch to disk.
    const exportedPatchPath = await exportPatch(input.runId, finalPatch).catch(() => undefined);
    return {
      finalApplicationStatus: exportedPatchPath !== undefined ? "exported_patch" : "failed",
      finalPatch,
      baseCommit,
      integrationCommitSha,
      ...(exportedPatchPath !== undefined ? { exportedPatchPath } : {}),
      finalApplicationMessage:
        `Could not apply the run result to a new branch: ${describeError(error)}.` +
        (exportedPatchPath !== undefined ? ` Patch exported to ${exportedPatchPath}.` : "")
    };
  } finally {
    await gitVoid(repoRoot, ["worktree", "remove", "--force", worktreePath]).catch(() => undefined);
    await rmWithRetry(worktreePath).catch(() => undefined);
  }
}

/**
 * Resolves the commit that represents the whole run: the root integration
 * commit, else the last integration commit, else the single leaf commit.
 */
export function resolveFinalCommit(graph: TaskGraph, result: RunExecutionResult): string | undefined {
  const rootIntegration = result.integrationResults.find(
    (entry) => entry.compositeTaskId === graph.rootId
  );
  if (rootIntegration?.integrationCommitSha !== undefined) {
    return rootIntegration.integrationCommitSha;
  }
  if (result.integrationResults.length > 0) {
    return result.integrationResults.at(-1)?.integrationCommitSha;
  }
  if (result.leafResults.length === 1) {
    return result.leafResults[0]?.commitSha;
  }
  return undefined;
}

async function exportPatch(runId: string, patch: string): Promise<string> {
  const dir = resolveManyhandsPath("exports");
  await mkdir(dir, { recursive: true });
  const target = path.join(dir, `${slugifyForBranch(runId)}.patch`);
  await writeFile(target, patch, "utf8");
  return target;
}

async function commitExists(repoRoot: string, sha: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

async function gitVoid(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
}

function gitWithStdin(cwd: string, args: string[], stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin?.end(stdin);
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
