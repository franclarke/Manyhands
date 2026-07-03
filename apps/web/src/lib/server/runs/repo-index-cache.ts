import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { buildRepositoryIndex, summarizeRepositoryIndex, type RepositoryIndex } from "@manyhands/core";

import type { RepositoryGroundingSummary } from "./schema";

const execFileAsync = promisify(execFile);

export interface RepositoryGrounding {
  index: RepositoryIndex;
  summary: RepositoryGroundingSummary;
}

interface CacheEntry {
  head: string;
  grounding: RepositoryGrounding;
}

/** Process-lifetime cache keyed by repoPath; invalidated when the repo's HEAD moves. */
const cache = new Map<string, CacheEntry>();

/**
 * Builds (or reuses) a repository index + grounding summary for the target repo.
 * Indexing walks the whole repo, so re-running planning on an unchanged repo
 * (same HEAD) reuses the cached index instead of rebuilding it every run.
 * Best-effort: returns undefined (and logs) if the repo cannot be indexed.
 */
export async function buildRepositoryGrounding(
  repoPath: string | undefined
): Promise<RepositoryGrounding | undefined> {
  if (repoPath === undefined || repoPath.trim().length === 0) {
    return undefined;
  }
  try {
    const head = await currentHead(repoPath);
    const cached = cache.get(repoPath);
    if (cached !== undefined && head !== "" && cached.head === head) {
      return cached.grounding;
    }

    const index = await buildRepositoryIndex({ rootPath: repoPath });
    const summary = summarizeRepositoryIndex(index);
    const grounding: RepositoryGrounding = {
      index,
      summary: {
        repositoryId: summary.repositoryId,
        fileCount: summary.fileCount,
        symbolCount: summary.symbolCount,
        indexHash: summary.indexHash,
        ...(summary.indexedAt !== undefined ? { indexedAt: summary.indexedAt } : {})
      }
    };
    if (head !== "") {
      cache.set(repoPath, { head, grounding });
    }
    return grounding;
  } catch (error) {
    console.warn(
      `[Runner] Repository grounding skipped: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

/** Resets the cache (tests). */
export function resetRepositoryGroundingCache(): void {
  cache.clear();
}

async function currentHead(repoPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repoPath });
    return stdout.trim();
  } catch {
    return "";
  }
}
