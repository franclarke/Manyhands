/**
 * B-008 — one immutable RunTargetContext (CF-19).
 *
 * The old flow had two competing resolvers: planning read the MUTABLE
 * workspace record (`workspace.repoPath`) while execution provisioned from
 * `run.repoSpec`. Editing the workspace after creating a run made planning
 * analyze repo A and execution mutate repo B.
 *
 * The context is captured once at run creation (realpath, physical git common
 * dir identity, branch, base commit, remote, fingerprint) and every phase
 * resolves the target through `resolveRunTargetPath`. Legacy local-path runs
 * without that identity fail closed instead of blessing whatever now occupies
 * the old workspace path.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";
import { safeGitArgs } from "@manyhands/execution-core";
import { getWorkspaceRepository } from "../workspaces/store";
import {
  canonicalPhysicalPath,
  resolveWorkspaceRepositoryIdentity
} from "../workspaces/repository-identity";
import type {
  RunRecord,
  RunTargetContext,
  RunTargetPhysicalIdentity
} from "./schema";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", safeGitArgs(cwd, ["-C", cwd, ...args]), { windowsHide: true });
  return stdout.trim();
}

export function targetFingerprint(
  gitCommonDir: string,
  sourceBaseCommit: string,
  physicalIdentity?: RunTargetPhysicalIdentity
): string {
  const repositoryIdentity = physicalIdentity === undefined
    ? `legacy-path:${canonicalPhysicalPath(gitCommonDir)}`
    : `filesystem:v${physicalIdentity.version}:${physicalIdentity.device}:${physicalIdentity.file}`;
  return createHash("sha256")
    .update(`${repositoryIdentity}@${sourceBaseCommit}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Capture the target repository's identity. The low-level probe returns
 * undefined when the path is not a usable git repository. Productive run
 * creation treats that as a validation failure and never publishes an
 * unverifiable local target.
 */
export async function captureRunTargetContext(
  repoPath: string,
  now: string = new Date().toISOString()
): Promise<RunTargetContext | undefined> {
  try {
    const identity = await resolveWorkspaceRepositoryIdentity(repoPath);
    if (identity === undefined) return undefined;
    const sourceRealPath = identity.repoRealPath;
    const gitCommonDir = identity.gitCommonDir;
    const physicalIdentity = identity.filesystemObjectId;
    const sourceBranch = await git(sourceRealPath, "rev-parse", "--abbrev-ref", "HEAD");
    const sourceBaseCommit = await git(sourceRealPath, "rev-parse", "HEAD");
    const remoteUrl = await git(sourceRealPath, "remote", "get-url", "origin").catch(() => undefined);
    return {
      sourceRealPath,
      gitCommonDir,
      ...(physicalIdentity !== undefined ? { physicalIdentity } : {}),
      sourceBranch,
      sourceBaseCommit,
      ...(remoteUrl !== undefined && remoteUrl.length > 0 ? { remoteUrl } : {}),
      fingerprint: targetFingerprint(gitCommonDir, sourceBaseCommit, physicalIdentity),
      capturedAt: now
    };
  } catch {
    return undefined;
  }
}

/**
 * The one path every phase must use to locate the run's source repository.
 * Never trusts the mutable workspace as target authority. It is inspected only
 * to produce an actionable migration error for legacy records.
 */
export async function resolveRunTargetPath(run: RunRecord): Promise<string | undefined> {
  assertRunHasVerifiableLocalTarget(run);
  if (run.targetContext !== undefined) {
    // A canonical path is not an identity: another repository can be created
    // at exactly the same location after capture. Verify before every planning
    // or grounding consumer receives the path, not only after provisioning.
    await verifyProvisionedAgainstTarget(
      { sourceRepoRoot: run.targetContext.sourceRealPath },
      run.targetContext
    );
    return run.targetContext.sourceRealPath;
  }
  if (run.repoSpec?.kind === "localPath") return run.repoSpec.path;
  // Legacy pre-B-008 records: inspect only to explain why they cannot be
  // migrated safely; never return the mutable workspace path.
  const workspace = await getWorkspaceRepository()
    .get(run.workspaceId)
    .catch(() => null);
  if (workspace?.repoPath !== undefined) {
    throw unverifiableLegacyTarget(workspace.repoPath);
  }
  return undefined;
}

export class RunTargetMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunTargetMismatchError";
  }
}

/**
 * Legacy local-path runs have no trustworthy migration path: recapturing the
 * current object would bless a replacement repository retroactively. They
 * must be recreated so identity is captured at the user decision boundary.
 */
export function assertRunHasVerifiableLocalTarget(run: RunRecord): void {
  if (run.targetContext !== undefined && run.targetContext.physicalIdentity === undefined) {
    throw unverifiableLegacyTarget(run.targetContext.sourceRealPath);
  }
  if (run.repoSpec?.kind === "localPath" && run.targetContext === undefined) {
    throw unverifiableLegacyTarget(run.repoSpec.path);
  }
}

function unverifiableLegacyTarget(targetPath: string): RunTargetMismatchError {
  return new RunTargetMismatchError(
    `Run target "${targetPath}" has no captured physical repository identity. ` +
      "ManyHands cannot safely migrate it because the path may now name a replacement repository; create a new run from the current workspace."
  );
}

/**
 * Provision-time identity check: the provisioned source must be the SAME
 * repository the context captured (realpath + physical git-common-dir
 * identity). Commit drift is allowed (the source may have advanced
 * legitimately) but repository identity is not negotiable.
 */
export async function verifyProvisionedAgainstTarget(
  provisioned: { sourceRepoRoot: string },
  context: RunTargetContext
): Promise<void> {
  const provisionedIdentity = await resolveWorkspaceRepositoryIdentity(provisioned.sourceRepoRoot);
  const provisionedReal = provisionedIdentity?.repoRealPath ?? await realpath(provisioned.sourceRepoRoot)
    .catch(() => provisioned.sourceRepoRoot);
  if (canonicalPhysicalPath(provisionedReal) !== canonicalPhysicalPath(context.sourceRealPath)) {
    throw new RunTargetMismatchError(
      `Provisioned source "${provisionedReal}" is a different repository than the run's captured target ` +
        `"${context.sourceRealPath}". Refusing to execute against a diverged target (CF-19).`
    );
  }

  if (context.physicalIdentity === undefined) {
    throw new RunTargetMismatchError(
      `Run target "${context.sourceRealPath}" predates physical repository identity capture. ` +
        "ManyHands cannot prove that this path still names the original repository; create a new run from the current workspace."
    );
  }
  const currentPhysicalIdentity = provisionedIdentity?.filesystemObjectId;
  if (currentPhysicalIdentity === undefined) {
    throw new RunTargetMismatchError(
      `Cannot establish the physical identity of provisioned source "${provisionedReal}". ` +
        "Refusing to execute without a device/inode or filesystem file-id proof."
    );
  }
  if (
    currentPhysicalIdentity.device !== context.physicalIdentity.device ||
    currentPhysicalIdentity.file !== context.physicalIdentity.file
  ) {
    throw new RunTargetMismatchError(
      `Provisioned source "${provisionedReal}" is a different physical repository than the run captured. ` +
        "The repository at this path was moved, replaced, or recreated; refusing to execute against a diverged target (CF-19)."
    );
  }
}
