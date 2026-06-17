/**
 * Default artifact hygiene for orchestrator commits.
 *
 * The postmortem run committed node_modules/ (4355 and 6678 files) because the
 * target repo had no .gitignore and the recorder stages with `git add -A`.
 * These defaults are EXCLUDED from staging, never added to forbiddenPaths:
 * forbidden is a hard fail and would kill legitimate runs where an agent runs
 * `npm install` to test its work — installing deps is fine, committing them
 * is not.
 */

/** Pathspec globs excluded from `git add` (leading **\/ covers nested monorepo dirs). */
export const DEFAULT_ARTIFACT_GLOBS: readonly string[] = [
  // Both the directory contents AND the bare entry: the WorktreeManager links
  // the base repo's node_modules into each worktree as a junction/symlink, and
  // a bare-path glob keeps that single link out of the orchestrator's commit.
  "**/node_modules",
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/.turbo/**",
  "**/coverage/**",
  "**/.cache/**",
  "**/*.log"
];

/** Same defaults as .git/info/exclude lines (provisioning writes these once per repo). */
export const DEFAULT_EXCLUDE_LINES: readonly string[] = [
  "node_modules/",
  "dist/",
  ".next/",
  ".turbo/",
  "coverage/",
  ".cache/",
  "*.log"
];

/** Marker so the exclude block is written idempotently. */
export const EXCLUDE_BLOCK_MARKER = "# --- manyhands defaults ---";

/**
 * Above this many changed files (after artifact filtering) the recorder logs a
 * scope advisory — almost certainly a scope leak, but advisory only: huge
 * legitimate changes (codemods) must not hard-fail.
 */
export const OVERSIZED_CHANGE_THRESHOLD = 500;
