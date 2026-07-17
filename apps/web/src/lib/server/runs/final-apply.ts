import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeGitArgs, type RunExecutionResult } from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";

import { resolveManyhandsPath } from "../repo-root";
import { rmWithRetry } from "./fs-retry";
import { superviseWithAmbientContext, supervisedExecFile } from "./process-supervision";
import { withRepositoryLease } from "./repo-lock";
import type { ProvisionedRepo } from "./repo-provisioner";
import type { FinalArtifactManifest } from "./schema";

// B-005: every git subprocess of the final apply is registered under the run
// via the ambient supervision context (see execution-pipeline's
// `runWithProcessSupervision` wrapper around `applyFinalPatch`).
const execFileAsync = supervisedExecFile;

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
  finalArtifactManifest?: FinalArtifactManifest;
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
export interface ApplyFinalPatchInput {
  graph: TaskGraph;
  result: RunExecutionResult;
  provisioned: ProvisionedRepo;
  runId: string;
  /** Free text (run title / prompt) used to make the branch name readable. */
  slug: string;
  sourceTargetFingerprint?: string;
  /** Caller already holds the exact run-repository lease (execution pipeline). */
  repositoryLeaseHeld?: boolean;
}

export async function prepareFinalCandidate(input: ApplyFinalPatchInput): Promise<FinalApplicationRecord | undefined> {
  if (input.repositoryLeaseHeld === true) return applyFinalPatchLocked(input);
  return withRepositoryLease(
    { repoRoot: input.provisioned.repoRoot, runId: input.runId },
    () => applyFinalPatchLocked(input)
  );
}

/** @deprecated V1 compatibility name. Preparation never publishes to the target branch. */
export const applyFinalPatch = prepareFinalCandidate;

async function applyFinalPatchLocked(input: ApplyFinalPatchInput): Promise<FinalApplicationRecord | undefined> {
  const integrationCommitSha = resolveFinalCommit(input.graph, input.result);
  if (integrationCommitSha === undefined) {
    return undefined;
  }

  const repoRoot = input.provisioned.repoRoot;
  // Delivery artifacts are relative to the immutable source snapshot so the
  // grounding commit is included. `baseCommit` is the leaf execution base and
  // therefore intentionally not used here.
  const baseCommit = input.provisioned.sourceBaseCommit;

  // The base commit must be reachable to produce a base-relative patch. If the
  // user orphaned it (hard reset / rebase), record a failure instead of crashing.
  if (!(await commitExists(repoRoot, baseCommit))) {
    return {
      finalApplicationStatus: "failed",
      baseCommit,
      integrationCommitSha,
      finalArtifactManifest: failedManifest(input, integrationCommitSha, baseCommit, ""),
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
      finalArtifactManifest: failedManifest(input, integrationCommitSha, baseCommit, finalPatch),
      finalApplicationMessage: "Execution completed but the final integrated patch is empty."
    };
  }

  const branchName = buildRunBranchName(input.runId, input.slug);
  const worktreeParent = resolveManyhandsPath("apply");
  // This is an ephemeral read/apply worktree. A stable path reused across
  // processes can retain a Windows handle or a registration from a different
  // repository with the same run id, turning a valid artifact into failure.
  const worktreePath = path.join(worktreeParent, `${input.runId}-${randomUUID().slice(0, 8)}`);

  try {
    await mkdir(worktreeParent, { recursive: true });
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
    const files = await changedFiles(repoRoot, baseCommit, finalCommitSha);
    const createdAt = new Date().toISOString();

    return {
      finalApplicationStatus: "applied",
      finalPatch,
      finalBranchName: branchName,
      finalCommitSha,
      appliedToRepoPath: repoRoot,
      appliedAt: createdAt,
      baseCommit,
      integrationCommitSha,
      finalArtifactManifest: {
        version: 1,
        manifestId: randomUUID(),
        runId: input.runId,
        sourceTargetFingerprint: input.sourceTargetFingerprint ?? `${input.provisioned.sourceRepoRoot}@${baseCommit}`,
        sourceBranch: input.provisioned.sourceBranch,
        sourceBaseSha: baseCommit,
        executionBaseSha: input.provisioned.executionBaseCommit ?? input.provisioned.baseCommit,
        finalSha: finalCommitSha,
        finalRef: branchName,
        ...files,
        patch: finalPatch,
        validationCommands: [],
        validationResults: [],
        verificationDisposition: "unverified",
        omittedTasks: [],
        acceptedFailures: [],
        acceptedConflicts: [],
        repairEvidence: [],
        artifactDisposition: "ready",
        deliveryDisposition: "needs_delivery",
        createdAt
      }
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
      finalArtifactManifest: failedManifest(input, integrationCommitSha, baseCommit, finalPatch),
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

async function changedFiles(repoRoot: string, baseSha: string, finalSha: string): Promise<{
  addedFiles: string[]; modifiedFiles: string[]; deletedFiles: string[];
}> {
  const output = await gitRaw(repoRoot, ["diff", "--name-status", `${baseSha}..${finalSha}`]);
  const addedFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const deletedFiles: string[] = [];
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [status, ...paths] = line.split("\t");
    const file = paths.at(-1);
    if (file === undefined) continue;
    if (status?.startsWith("A")) addedFiles.push(file);
    else if (status?.startsWith("D")) deletedFiles.push(file);
    else modifiedFiles.push(file);
  }
  return { addedFiles, modifiedFiles, deletedFiles };
}

function failedManifest(
  input: Parameters<typeof applyFinalPatch>[0],
  finalSha: string,
  baseSha: string,
  patch: string
): FinalArtifactManifest {
  return {
    version: 1,
    manifestId: randomUUID(),
    runId: input.runId,
    sourceTargetFingerprint: input.sourceTargetFingerprint ?? `${input.provisioned.sourceRepoRoot}@${baseSha}`,
    sourceBranch: input.provisioned.sourceBranch,
    sourceBaseSha: baseSha,
    executionBaseSha: input.provisioned.executionBaseCommit ?? input.provisioned.baseCommit,
    finalSha,
    addedFiles: [], modifiedFiles: [], deletedFiles: [], patch,
    validationCommands: [], validationResults: [], verificationDisposition: "failed",
    omittedTasks: [], acceptedFailures: [], acceptedConflicts: [], repairEvidence: [],
    artifactDisposition: "failed", deliveryDisposition: "failed", createdAt: new Date().toISOString()
  };
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
    await execFileAsync("git", safeGitArgs(repoRoot, ["cat-file", "-e", `${sha}^{commit}`]), { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", safeGitArgs(cwd, args), { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

async function gitVoid(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", safeGitArgs(cwd, args), { cwd, maxBuffer: 20 * 1024 * 1024 });
}

function gitWithStdin(cwd: string, args: string[], stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", safeGitArgs(cwd, args), { cwd, maxBuffer: 20 * 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    superviseWithAmbientContext(child);
    child.stdin?.end(stdin);
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
