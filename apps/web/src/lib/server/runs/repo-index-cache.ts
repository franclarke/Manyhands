import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

import { buildRepositoryIndex, summarizeRepositoryIndex, type RepositoryIndex } from "@manyhands/repository-index";
import { safeGitArgs } from "@manyhands/execution-core";

import type { EffectivePlanningBudget } from "./effective-planning-budget";
import type { RepositoryGroundingSummary, RunTargetContext } from "./schema";

const execFileAsync = promisify(execFile);

export interface RepositoryGrounding {
  index: RepositoryIndex;
  summary: RepositoryGroundingSummary;
}

interface CacheEntry {
  fingerprint: string;
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
  repoPath: string | undefined,
  options: { budget?: EffectivePlanningBudget; targetContext?: RunTargetContext; signal?: AbortSignal } = {}
): Promise<RepositoryGrounding | undefined> {
  if (repoPath === undefined || repoPath.trim().length === 0) {
    return undefined;
  }
  try {
    const fingerprint = await currentFingerprint(repoPath, options);
    const cached = cache.get(repoPath);
    if (cached !== undefined && cached.fingerprint === fingerprint) {
      return cached.grounding;
    }

    const index = await buildRepositoryIndex({
      rootPath: repoPath,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.budget === undefined ? {} : { limits: {
        maxFiles: options.budget.maxIndexedFiles,
        maxBytes: options.budget.maxIndexBytes,
        maxFileBytes: options.budget.maxIndexedFileBytes,
        maxSymbols: options.budget.maxIndexedSymbols,
        maxImports: options.budget.maxIndexedImports,
        maxExports: options.budget.maxIndexedExports
      } })
    });
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
    cache.set(repoPath, { fingerprint, grounding });
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

async function currentFingerprint(
  repoPath: string,
  options: { budget?: EffectivePlanningBudget; targetContext?: RunTargetContext }
): Promise<string> {
  try {
    const [{ stdout: head }, { stdout: dirty }] = await Promise.all([
      execFileAsync("git", safeGitArgs(repoPath, ["rev-parse", "HEAD"]), { cwd: repoPath, windowsHide: true }),
      execFileAsync("git", safeGitArgs(repoPath, ["status", "--porcelain=v1"]), { cwd: repoPath, windowsHide: true })
    ]);
    return createHash("sha256").update(JSON.stringify({
      target: options.targetContext?.fingerprint,
      head: head.trim(), dirty: dirty.trim(), budget: options.budget, schema: "repository-index-v1"
    })).digest("hex");
  } catch {
    return createHash("sha256").update(JSON.stringify({ repoPath, target: options.targetContext?.fingerprint, budget: options.budget })).digest("hex");
  }
}
