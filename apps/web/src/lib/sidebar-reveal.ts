/**
 * Sidebar reveal — progressive disclosure for the workspace and run lists.
 *
 * PURE and node-testable: no React, no DOM. The sidebar is a fixed-height rail;
 * rendering every workspace pushed the run history out of the viewport, so each
 * list mounts truncated and grows one step per click until nothing is hidden.
 */

/** Workspaces are navigational context, not the main content — show a short head. */
export const WORKSPACES_INITIAL_REVEAL = 3;

/** The run history is the primary list, so it starts with a longer head. */
export const RUNS_INITIAL_REVEAL = 5;

/** How many extra items each "Ver más" click reveals. */
export const REVEAL_STEP = 10;

export interface RevealState {
  /** Items actually rendered — never more than the list holds. */
  visibleCount: number;
  /** Items still withheld; drives the "Ver más" counter. */
  hiddenCount: number;
  /** Whether a "Ver más" control should be rendered at all. */
  canRevealMore: boolean;
}

/**
 * Resolve a requested reveal count against the real list length. The requested
 * count is free-running state: a deletion can shrink the list under it, so it
 * is clamped on read rather than reconciled on every data change.
 */
export function revealState(total: number, revealed: number): RevealState {
  const visibleCount = Math.max(0, Math.min(total, revealed));
  const hiddenCount = Math.max(0, total - visibleCount);
  return { visibleCount, hiddenCount, canRevealMore: hiddenCount > 0 };
}

/** The next reveal count after a "Ver más" click — a full step, or the remainder. */
export function nextRevealCount(total: number, revealed: number, step: number = REVEAL_STEP): number {
  const current = Math.max(0, Math.min(total, revealed));
  return Math.min(total, current + step);
}
