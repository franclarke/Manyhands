/** Directory ManyHands owns inside a target repository (worktree pool, runs). */
export const MANYHANDS_RUNTIME_DIRECTORY = ".manyhands";

/**
 * Decides whether the delivery target's working tree is clean from the USER's
 * point of view, given `git status --porcelain` output.
 *
 * ManyHands materializes its worktree pool and run artifacts under
 * `<repo>/.manyhands/`. Those are the orchestrator's own files, not user work,
 * so they must not block publishing the result the orchestrator just produced.
 * Every other entry — modified, staged, untracked or renamed — still makes the
 * target dirty, preserving the invariant that delivery never publishes over
 * uncommitted user changes.
 */
export function targetWorkingTreeIsClean(porcelain: string): boolean {
  return porcelainEntries(porcelain).every(isManyHandsRuntimeEntry);
}

/** The porcelain entries that represent real user changes, for diagnostics. */
export function userWorkingTreeChanges(porcelain: string): string[] {
  return porcelainEntries(porcelain).filter((entry) => !isManyHandsRuntimeEntry(entry));
}

function porcelainEntries(porcelain: string): string[] {
  // Leading whitespace is part of the two-character status field (" M path"),
  // so only trailing whitespace may be stripped here.
  return porcelain.split(/\r?\n/u).map((line) => line.replace(/\s+$/u, "")).filter((line) => line.trim().length > 0);
}

function isManyHandsRuntimeEntry(entry: string): boolean {
  // Porcelain lines are "XY <path>"; renames read "XY <old> -> <new>", and both
  // sides must live under the runtime directory for the entry to be ours.
  const withoutStatus = entry.slice(2).trim();
  const paths = withoutStatus.split(" -> ").map((path) => path.trim().replace(/^"|"$/gu, ""));
  return paths.length > 0 && paths.every(isUnderRuntimeDirectory);
}

function isUnderRuntimeDirectory(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized === MANYHANDS_RUNTIME_DIRECTORY
    || normalized === `${MANYHANDS_RUNTIME_DIRECTORY}/`
    || normalized.startsWith(`${MANYHANDS_RUNTIME_DIRECTORY}/`);
}
