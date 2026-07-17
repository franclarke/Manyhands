import type { RunRecord } from "./schema";
import { resolveRunTargetPath } from "./target-context";

export async function resolveRunRevealTarget(run: RunRecord): Promise<string | undefined> {
  if (run.appliedToRepoPath !== undefined) return run.appliedToRepoPath;
  return resolveRunTargetPath(run);
}
