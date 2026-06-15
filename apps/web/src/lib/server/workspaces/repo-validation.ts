import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { WorkspaceValidationError } from "./errors";

const execFileAsync = promisify(execFile);

export interface LocalGitRepoInfo {
  repoRoot: string;
  branch: string;
  head?: string;
  dirty: boolean;
}

export async function inspectLocalGitRepo(inputPath: string): Promise<LocalGitRepoInfo> {
  const resolved = path.resolve(inputPath);
  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    throw new WorkspaceValidationError(`Repo path does not exist: ${resolved}`);
  }
  if (!stats.isDirectory()) {
    throw new WorkspaceValidationError(`Repo path is not a directory: ${resolved}`);
  }

  const repoRoot = await git(resolved, ["rev-parse", "--show-toplevel"]).catch(() => {
    throw new WorkspaceValidationError(`Repo path is not inside a git repository: ${resolved}`);
  });
  const branch = await git(resolved, ["branch", "--show-current"]).then((value) => value || "HEAD");
  const head = await git(resolved, ["rev-parse", "--verify", "--quiet", "HEAD"])
    .then((value) => value || undefined)
    .catch(() => undefined);
  const status = await git(resolved, ["status", "--porcelain"]);
  return {
    repoRoot: path.resolve(repoRoot),
    branch,
    ...(head !== undefined ? { head } : {}),
    dirty: status.length > 0
  };
}

export async function normalizeRepoPath(inputPath: string): Promise<string> {
  return (await inspectLocalGitRepo(inputPath)).repoRoot;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}
