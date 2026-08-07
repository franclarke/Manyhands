import { execFile } from "node:child_process";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { EphemeralWorkspaceGit } from "./ephemeral-workspace.js";

/**
 * The git a workspace provider needs: add a detached checkout, remove it, and
 * anchor a commit under a ref.
 *
 * Extracted from the retired worktree pool, which needed a wider surface —
 * `resetAndClean`, `validate`, `prune`, `resolveCommonDir` — because it recycled
 * slots and had to prove a reused slot was pristine. Nothing is reused now, so
 * none of that has anything to check.
 */
export class NativeWorktreeGit implements EphemeralWorkspaceGit {
  private readonly gitPath: string;

  constructor(gitPath = "git") {
    this.gitPath = gitPath;
  }

  async add(params: { repoRoot: string; worktreePath: string; baseCommit: string }): Promise<void> {
    await mkdir(path.dirname(params.worktreePath), { recursive: true });
    // Detached on purpose: a workspace used once needs no branch, and a branch
    // per attempt is ref litter nothing ever collects.
    await runGit(this.gitPath, params.repoRoot, [
      "worktree",
      "add",
      "--detach",
      params.worktreePath,
      params.baseCommit
    ]);
  }

  async remove(params: { repoRoot: string; worktreePath: string }): Promise<void> {
    // A workspace git already removed, or never created, is the state we want.
    if (!(await pathExists(params.worktreePath))) return;
    await runGit(this.gitPath, params.repoRoot, ["worktree", "remove", "--force", params.worktreePath]);
  }

  async updateRef(params: { repoRoot: string; ref: string; candidateCommit: string }): Promise<void> {
    // The zero-oid old value makes this a create, never an overwrite: two
    // attempts must not be able to claim one ref.
    const zeroCommit = "0".repeat(params.candidateCommit.length);
    await runGit(this.gitPath, params.repoRoot, [
      "update-ref",
      params.ref,
      params.candidateCommit,
      zeroCommit
    ]);
  }
}

function runGit(gitPath: string, cwd: string, args: readonly string[]): Promise<void> {
  return runGitOutput(gitPath, cwd, args).then(() => undefined);
}

function runGitOutput(gitPath: string, cwd: string, args: readonly string[]): Promise<string> {
  const safeDirectory = path.resolve(cwd).replaceAll("\\", "/");
  return new Promise((resolve, reject) => {
    execFile(
      gitPath,
      ["-c", `safe.directory=${safeDirectory}`, ...args],
      { cwd, encoding: "utf8", windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(
            `git ${args.join(" ")} failed in ${cwd}: ${stderr.trim() || error.message}`,
            { cause: error }
          ));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}
