import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the ManyHands repository root.
 *
 * Order of precedence:
 *  1. `MANYHANDS_REPO_ROOT` environment variable.
 *  2. `process.cwd()` and up to two parent directories, looking for `pnpm-workspace.yaml`.
 *  3. Fallback: `process.cwd()`.
 *
 * Reused by every server-side store under `.manyhands/` so that runs, workspaces and
 * other persisted state anchor at the repo root regardless of the cwd Next.js is
 * launched with (e.g. dev runs with `apps/web/` as cwd).
 */
export function resolveRepoRoot(): string {
  const override = process.env.MANYHANDS_REPO_ROOT;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  const cwd = process.cwd();
  const candidates = [cwd, path.resolve(cwd, ".."), path.resolve(cwd, "..", "..")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "pnpm-workspace.yaml"))) {
      return candidate;
    }
  }
  return cwd;
}

export function resolveManyhandsPath(...segments: string[]): string {
  return path.resolve(resolveRepoRoot(), ".manyhands", ...segments);
}
