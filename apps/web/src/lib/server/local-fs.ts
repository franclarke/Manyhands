import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectLocalGitRepo, type LocalGitRepoInfo } from "./workspaces/repo-validation";

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

async function isGitRepoRoot(dir: string): Promise<boolean> {
  try {
    const dotGit = await stat(path.join(dir, ".git"));
    return dotGit.isDirectory() || dotGit.isFile();
  } catch {
    return false;
  }
}
