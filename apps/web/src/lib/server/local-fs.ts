import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { inspectLocalGitRepo, type LocalGitRepoInfo } from "./workspaces/repo-validation";

const execFileAsync = promisify(execFile);

export interface LocalDirectoryEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export interface LocalDirectoryListing {
  cwd: string;
  parent?: string;
  entries: LocalDirectoryEntry[];
  git?: LocalGitRepoInfo;
}

export async function browseLocalDirectories(inputPath?: string): Promise<LocalDirectoryListing> {
  const cwd = path.resolve(inputPath && inputPath.length > 0 ? inputPath : os.homedir());
  const stats = await stat(cwd);
  if (!stats.isDirectory()) {
    throw new Error(`Path is not a directory: ${cwd}`);
  }

  const dirents = await readdir(cwd, { withFileTypes: true });
  const entries = await Promise.all(
    dirents
      .filter((entry) => entry.isDirectory())
      .filter((entry) => !entry.name.startsWith(".") || entry.name === ".git")
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 250)
      .map(async (entry): Promise<LocalDirectoryEntry> => {
        const entryPath = path.join(cwd, entry.name);
        return {
          name: entry.name,
          path: entryPath,
          isGitRepo: await isGitRepoRoot(entryPath)
        };
      })
  );

  const listing: LocalDirectoryListing = {
    cwd,
    entries
  };
  const parent = path.dirname(cwd);
  if (parent !== cwd) listing.parent = parent;
  const git = await inspectLocalGitRepo(cwd).catch(() => undefined);
  if (git !== undefined) listing.git = git;
  return listing;
}

/**
 * Open a local directory in the OS file explorer. Validates the target is a real
 * directory first (callers must scope it to a known repo path, never user input).
 */
export async function revealInFileExplorer(targetPath: string): Promise<void> {
  const resolved = path.resolve(targetPath);
  const stats = await stat(resolved);
  const dir = stats.isDirectory() ? resolved : path.dirname(resolved);

  if (process.platform === "win32") {
    // `explorer` returns exit code 1 even on success; ignore the throw.
    await execFileAsync("explorer", [dir]).catch(() => undefined);
    return;
  }
  if (process.platform === "darwin") {
    await execFileAsync("open", [dir]);
    return;
  }
  await execFileAsync("xdg-open", [dir]);
}

async function isGitRepoRoot(dir: string): Promise<boolean> {
  try {
    const dotGit = await stat(path.join(dir, ".git"));
    return dotGit.isDirectory() || dotGit.isFile();
  } catch {
    return false;
  }
}
