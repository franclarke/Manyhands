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
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";

import { rmWithRetry } from "./fs-retry";
import { withRepositoryLease } from "./repo-lock";
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
  targetHead?: string;
  filesChanged?: number;
  insertions?: number;
  deletions?: number;
  /** Working tree has no user changes (ManyHands artifacts ignored) → safe to merge. */
  baseClean?: boolean;
  /** The applied commit is already reachable from the base branch. */
  merged?: boolean;
  manifestId?: string;
  targetFingerprint?: string;
  runVersion?: number;
  reason?: string;
}

export interface DeliveryRequest {
  runId: string;
  manifestId: string;
  finalSha: string;
  targetBranch: string;
  expectedTargetHead: string;
  expectedClean: boolean;
  targetFingerprint: string;
  actor: string;
  idempotencyKey: string;
}

export interface DeliveryReceipt {
  deliveryId: string;
  runId: string;
  manifestId: string;
  mode: "merge";
  targetRepo: string;
  targetBranch: string;
  targetHeadBefore: string;
  targetHeadAfter: string;
  finalSha: string;
  patchHash: string;
  disposition: "delivered" | "conflict" | "failed";
  actor: string;
  idempotencyKey: string;
  createdAt: string;
  completedAt?: string;
  error?: string;
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
    const targetHead = await git(repoPath, ["rev-parse", "HEAD"]);
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
      targetHead,
      ...(stat !== undefined ? stat : {}),
      baseClean,
      merged,
      ...(run.finalArtifactManifest !== undefined ? { manifestId: run.finalArtifactManifest.manifestId, targetFingerprint: run.finalArtifactManifest.sourceTargetFingerprint } : {}),
      runVersion: run.version
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
  return withRepositoryLease({ repoRoot: target.repoPath, runId: run.runId }, () => mergeRunBranchLocked(run));
}

async function mergeRunBranchLocked(run: RunRecord): Promise<{ mergedInto: string }> {
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

/**
 * Explicit, idempotent delivery. The caller supplies the target branch and
 * HEAD it showed to the operator; the current branch is never implicit consent.
 */
export async function deliverRunBranch(run: RunRecord, request: DeliveryRequest): Promise<DeliveryReceipt> {
  const target = appliedTarget(run);
  const manifest = run.finalArtifactManifest;
  if (target === undefined || manifest === undefined || manifest.artifactDisposition === "failed") {
    throw new DeliveryError("El run no tiene un artifact final verificable para entregar.");
  }
  if (request.runId !== run.runId || request.manifestId !== manifest.manifestId || request.finalSha !== manifest.finalSha) {
    throw new DeliveryError("La solicitud de delivery no coincide con el artifact final del run.");
  }
  if (request.targetFingerprint !== manifest.sourceTargetFingerprint) {
    throw new DeliveryError("El fingerprint del repositorio confirmado no coincide con el artifact.");
  }
  return withRepositoryLease({ repoRoot: target.repoPath, runId: run.runId }, async () => {
    const receiptPath = path.join(target.repoPath, ".manyhands", "delivery-receipts", `${receiptKey(request.idempotencyKey)}.json`);
    const prior = await readReceipt(receiptPath);
    if (prior?.disposition === "delivered") return prior;
    const branch = await git(target.repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headBefore = await git(target.repoPath, ["rev-parse", "HEAD"]);
    if (branch !== request.targetBranch || headBefore !== request.expectedTargetHead) {
      throw new DeliveryError(`El target cambió: se esperaba ${request.targetBranch}@${request.expectedTargetHead}, se encontró ${branch}@${headBefore}.`);
    }
    if (!request.expectedClean || (await userDirtCount(target.repoPath)) > 0) {
      throw new DeliveryError("El working tree no está limpio; delivery no modificó el checkout.");
    }
    if (await isAncestor(target.repoPath, manifest.finalSha, "HEAD")) {
      const adopted = newReceipt(request, target.repoPath, headBefore, headBefore, manifest.patch, "delivered");
      await writeReceipt(receiptPath, adopted);
      return adopted;
    }
    const prepared = newReceipt(request, target.repoPath, headBefore, headBefore, manifest.patch, "failed");
    await writeReceipt(receiptPath, prepared);
    try {
      await gitVoid(target.repoPath, ["-c", "user.name=ManyHands", "-c", "user.email=manyhands@local", "-c", "commit.gpgsign=false", "merge", "--no-ff", target.branchName, "-m", `mh: deliver run ${run.runId} into ${branch}`]);
      const receipt = { ...prepared, targetHeadAfter: await git(target.repoPath, ["rev-parse", "HEAD"]), disposition: "delivered" as const, completedAt: new Date().toISOString() };
      await writeReceipt(receiptPath, receipt);
      return receipt;
    } catch (error) {
      await gitVoid(target.repoPath, ["merge", "--abort"]).catch(() => undefined);
      const receipt = { ...prepared, disposition: "conflict" as const, error: describe(error), completedAt: new Date().toISOString() };
      await writeReceipt(receiptPath, receipt);
      throw new DeliveryError(`El merge tuvo conflictos y se abortó: ${receipt.error}`);
    }
  });
}

function newReceipt(request: DeliveryRequest, targetRepo: string, before: string, after: string, patch: string, disposition: DeliveryReceipt["disposition"]): DeliveryReceipt {
  return { deliveryId: randomUUID(), runId: request.runId, manifestId: request.manifestId, mode: "merge", targetRepo, targetBranch: request.targetBranch, targetHeadBefore: before, targetHeadAfter: after, finalSha: request.finalSha, patchHash: createHash("sha256").update(patch).digest("hex"), disposition, actor: request.actor, idempotencyKey: request.idempotencyKey, createdAt: new Date().toISOString() };
}
function receiptKey(key: string): string { return createHash("sha256").update(key).digest("hex"); }
async function readReceipt(file: string): Promise<DeliveryReceipt | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as DeliveryReceipt; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function writeReceipt(file: string, receipt: DeliveryReceipt): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, JSON.stringify(receipt), "utf8"); await rename(temp, file); }

/** Delete the applied run branch (e.g. after rejecting the result). */
export async function discardRunBranch(run: RunRecord): Promise<void> {
  const target = appliedTarget(run);
  if (target === undefined) {
    throw new DeliveryError("El run no tiene una rama aplicada para descartar.");
  }
  await withRepositoryLease({ repoRoot: target.repoPath, runId: run.runId }, () => discardRunBranchLocked(run));
}

async function discardRunBranchLocked(run: RunRecord): Promise<void> {
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
  return withRepositoryLease({ repoRoot: repoPath, runId: run.runId }, () => cleanupRunArtifactsLocked(run));
}

async function cleanupRunArtifactsLocked(run: RunRecord): Promise<CleanupResult> {
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
