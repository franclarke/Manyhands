/**
 * B-008 — one immutable RunTargetContext (CF-19).
 *
 * The old flow had two competing resolvers: planning read the MUTABLE
 * workspace record (`workspace.repoPath`) while execution provisioned from
 * `run.repoSpec`. Editing the workspace after creating a run made planning
 * analyze repo A and execution mutate repo B.
 *
 * The context is captured once at run creation (realpath, git common dir,
 * branch, base commit, remote, fingerprint) and every phase resolves the
 * target through `resolveRunTargetPath` — context first, then the immutable
 * repoSpec, and the workspace only as a legacy fallback for pre-B-008 runs.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getWorkspaceRepository } from "../workspaces/store";
import type { RunRecord, RunTargetContext } from "./schema";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], { windowsHide: true });
  return stdout.trim();
}

export function targetFingerprint(gitCommonDir: string, sourceBaseCommit: string): string {
  return createHash("sha256").update(`${gitCommonDir.toLowerCase()}@${sourceBaseCommit}`).digest("hex").slice(0, 16);
}

/**
 * Capture the target repository's identity. Best-effort: returns undefined
 * when the path is not a usable git repository (the run is still creatable —
 * execution fails later with its own actionable error, exactly as before).
 */
export async function captureRunTargetContext(
  repoPath: string,
  now: string = new Date().toISOString()
): Promise<RunTargetContext | undefined> {
  try {
    const sourceRealPath = await realpath(repoPath);
    const commonDirRaw = await git(sourceRealPath, "rev-parse", "--git-common-dir");
    let gitCommonDir = path.resolve(sourceRealPath, commonDirRaw);
    try {
      gitCommonDir = await realpath(gitCommonDir);
    } catch {
      // Keep the resolved path.
    }
    const sourceBranch = await git(sourceRealPath, "rev-parse", "--abbrev-ref", "HEAD");
    const sourceBaseCommit = await git(sourceRealPath, "rev-parse", "HEAD");
    const remoteUrl = await git(sourceRealPath, "remote", "get-url", "origin").catch(() => undefined);
    return {
      sourceRealPath,
      gitCommonDir,
      sourceBranch,
      sourceBaseCommit,
      ...(remoteUrl !== undefined && remoteUrl.length > 0 ? { remoteUrl } : {}),
      fingerprint: targetFingerprint(gitCommonDir, sourceBaseCommit),
      capturedAt: now
    };
  } catch {
    return undefined;
  }
}

/**
 * The one path every phase must use to locate the run's source repository.
 * Never reads the mutable workspace for runs that carry a context or a
 * repoSpec (both immutable on the RunRecord).
 */
export async function resolveRunTargetPath(run: RunRecord): Promise<string | undefined> {
  if (run.targetContext !== undefined) return run.targetContext.sourceRealPath;
  if (run.repoSpec?.kind === "localPath") return run.repoSpec.path;
  // Legacy pre-B-008 records (and fixture runs before provisioning).
  const workspace = await getWorkspaceRepository()
    .get(run.workspaceId)
    .catch(() => null);
  return workspace?.repoPath;
}

export class RunTargetMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunTargetMismatchError";
  }
}

/**
 * Provision-time identity check: the provisioned source must be the SAME
 * repository the context captured (realpath identity). Commit drift is
 * allowed (the source may have advanced legitimately) but repository
 * identity is not negotiable.
 */
export async function verifyProvisionedAgainstTarget(
  provisioned: { sourceRepoRoot: string },
  context: RunTargetContext
): Promise<void> {
  let provisionedReal = provisioned.sourceRepoRoot;
  try {
    provisionedReal = await realpath(provisioned.sourceRepoRoot);
  } catch {
    // Compare the raw path below.
  }
  if (provisionedReal.toLowerCase() !== context.sourceRealPath.toLowerCase()) {
    throw new RunTargetMismatchError(
      `Provisioned source "${provisionedReal}" is a different repository than the run's captured target ` +
        `"${context.sourceRealPath}". Refusing to execute against a diverged target (CF-19).`
    );
  }
}
