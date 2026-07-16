import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { safeGitArgs } from "@manyhands/execution-core";
import type { WorkspaceRepositoryIdentity } from "./schema";

const execFileAsync = promisify(execFile);

/** Comparable filesystem spelling without collapsing case-sensitive POSIX paths. */
export function canonicalPhysicalPath(value: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = path.normalize(value).replaceAll("\\", "/").replace(/\/$/u, "");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

/**
 * Resolve a path, subdirectory, symlink/junction or linked worktree to its
 * durable physical Git identity. `gitCommonDir` deliberately owns the key:
 * every spelling of the same repository shares it, while independent clones
 * remain distinct.
 */
export async function resolveWorkspaceRepositoryIdentity(
  inputPath: string
): Promise<WorkspaceRepositoryIdentity | undefined> {
  try {
    const inputRealPath = await realpath(path.resolve(inputPath));
    const topLevel = await git(inputRealPath, ["rev-parse", "--show-toplevel"]);
    const repoRealPath = await realpath(path.resolve(topLevel));
    const commonDirRaw = await git(repoRealPath, ["rev-parse", "--git-common-dir"]);
    const unresolvedCommonDir = path.isAbsolute(commonDirRaw)
      ? commonDirRaw
      : path.resolve(repoRealPath, commonDirRaw);
    const gitCommonDir = await realpath(unresolvedCommonDir).catch(() => path.resolve(unresolvedCommonDir));
    const filesystemObjectId = await stableFilesystemObjectId(gitCommonDir);
    const keyMaterial = filesystemObjectId === undefined
      ? `path:v1:${canonicalPhysicalPath(gitCommonDir)}`
      : `filesystem:v1:${filesystemObjectId.device}:${filesystemObjectId.file}`;
    const key = createHash("sha256").update(keyMaterial).digest("hex");
    return {
      version: 1,
      key,
      repoRealPath,
      gitCommonDir,
      ...(filesystemObjectId !== undefined ? { filesystemObjectId } : {})
    };
  } catch {
    return undefined;
  }
}

async function stableFilesystemObjectId(
  target: string
): Promise<NonNullable<WorkspaceRepositoryIdentity["filesystemObjectId"]> | undefined> {
  try {
    const value = await stat(target, { bigint: true });
    // Some virtual filesystems report 0/0 for every object. Treat that as no
    // authority rather than collapsing unrelated repositories together.
    if (value.dev === 0n && value.ino === 0n) return undefined;
    return {
      version: 1,
      device: value.dev.toString(10),
      file: value.ino.toString(10)
    };
  } catch {
    return undefined;
  }
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", safeGitArgs(cwd, args), {
    cwd,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  return stdout.trim();
}
