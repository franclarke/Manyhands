/** Directory ManyHands owns inside a target repository (worktree pool, runs). */
export const MANYHANDS_RUNTIME_DIRECTORY = ".manyhands";

/**
 * Identity of the cleanliness rule below, recorded in every delivery receipt.
 *
 * A reader months later cannot tell whether `.manyhands/` was exempt when a
 * delivery was judged unless the receipt says which rule judged it. Changing
 * the rule changes this identity, so old receipts stay interpretable instead of
 * silently acquiring today's meaning.
 */
export const TARGET_CLEANLINESS_POLICY_ID = "manyhands-runtime-exempt.v1";

/** Standard transient tooling / build cache directories exempt from dirty check when untracked. */
export const DEFAULT_TRANSIENT_EXCLUSIONS = [
  MANYHANDS_RUNTIME_DIRECTORY,
  ".turbo",
  ".cache",
  "node_modules/.cache",
  ".tmp",
  "coverage"
] as const;

export interface CleanlinessCheckOptions {
  readonly extraExclusions?: readonly string[];
}

/**
 * Decides whether the delivery target's working tree is clean from the USER's
 * point of view, given `git status --porcelain` output.
 *
 * ManyHands materializes its worktree pool and run artifacts under
 * `<repo>/.manyhands/`. Those and standard build cache directories (.turbo, .cache)
 * are orchestrator/tooling files, not user work, so they must not block publishing
 * the result. Every user modification in real source files still makes the
 * target dirty, preserving the invariant that delivery never publishes over
 * uncommitted user changes.
 */
export function targetWorkingTreeIsClean(
  porcelain: string,
  options?: CleanlinessCheckOptions
): boolean {
  return porcelainEntries(porcelain).every((entry) => isExemptTransientEntry(entry, options?.extraExclusions));
}

/** The porcelain entries that represent real user changes, for diagnostics. */
export function userWorkingTreeChanges(
  porcelain: string,
  options?: CleanlinessCheckOptions
): string[] {
  return porcelainEntries(porcelain).filter((entry) => !isExemptTransientEntry(entry, options?.extraExclusions));
}

function porcelainEntries(porcelain: string): string[] {
  // Leading whitespace is part of the two-character status field (" M path"),
  // so only trailing whitespace may be stripped here.
  return porcelain.split(/\r?\n/u).map((line) => line.replace(/\s+$/u, "")).filter((line) => line.trim().length > 0);
}

function isExemptTransientEntry(entry: string, extraExclusions?: readonly string[]): boolean {
  // Porcelain lines are "XY <path>"; renames read "XY <old> -> <new>", and both
  // sides must live under an exempt directory for the entry to be ours.
  const withoutStatus = entry.slice(2).trim();
  const paths = withoutStatus.split(" -> ").map((path) => path.trim().replace(/^"|"$/gu, ""));
  return paths.length > 0 && paths.every((p) => isUnderExemptDirectory(p, extraExclusions));
}

function isUnderExemptDirectory(path: string, extraExclusions?: readonly string[]): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  const allExclusions = extraExclusions !== undefined && extraExclusions.length > 0
    ? [...DEFAULT_TRANSIENT_EXCLUSIONS, ...extraExclusions]
    : DEFAULT_TRANSIENT_EXCLUSIONS;

  return allExclusions.some((dir) => {
    const normalizedDir = dir.replaceAll("\\", "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
    return normalized === normalizedDir
      || normalized === `${normalizedDir}/`
      || normalized.startsWith(`${normalizedDir}/`);
  });
}

