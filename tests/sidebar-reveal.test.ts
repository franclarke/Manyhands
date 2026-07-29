/**
 * Sidebar reveal — progressive disclosure for the workspace and run lists.
 *
 * The sidebar renders both lists inside a fixed-height rail. Rendering every
 * workspace pushed the run history out of the viewport entirely, so each list
 * starts truncated and grows in steps. The arithmetic is pure and lives here so
 * the thresholds are single-sourced and covered without a DOM.
 */
import { describe, expect, it } from "vitest";
import {
  REVEAL_STEP,
  RUNS_INITIAL_REVEAL,
  WORKSPACES_INITIAL_REVEAL,
  nextRevealCount,
  revealState
} from "@/lib/sidebar-reveal";

describe("reveal thresholds", () => {
  it("starts workspaces at 3 and runs at 5, growing in steps of 10", () => {
    expect(WORKSPACES_INITIAL_REVEAL).toBe(3);
    expect(RUNS_INITIAL_REVEAL).toBe(5);
    expect(REVEAL_STEP).toBe(10);
  });
});

describe("revealState", () => {
  it("shows only the first slice while items remain hidden", () => {
    expect(revealState(20, WORKSPACES_INITIAL_REVEAL)).toEqual({
      visibleCount: 3,
      hiddenCount: 17,
      canRevealMore: true
    });
  });

  it("stops offering more once every item is visible", () => {
    expect(revealState(3, WORKSPACES_INITIAL_REVEAL)).toEqual({
      visibleCount: 3,
      hiddenCount: 0,
      canRevealMore: false
    });
  });

  it("never claims more visible items than exist", () => {
    // A deletion can shrink the list below the revealed count; clamp instead of
    // reporting a negative remainder.
    expect(revealState(2, 13)).toEqual({ visibleCount: 2, hiddenCount: 0, canRevealMore: false });
    expect(revealState(0, RUNS_INITIAL_REVEAL)).toEqual({
      visibleCount: 0,
      hiddenCount: 0,
      canRevealMore: false
    });
  });

  it("treats a negative revealed count as nothing revealed", () => {
    expect(revealState(5, -1)).toEqual({ visibleCount: 0, hiddenCount: 5, canRevealMore: true });
  });
});

describe("nextRevealCount", () => {
  it("adds a full step when enough items remain hidden", () => {
    expect(nextRevealCount(40, WORKSPACES_INITIAL_REVEAL)).toBe(13);
    expect(nextRevealCount(40, 13)).toBe(23);
  });

  it("adds only the remainder when fewer than a step is left", () => {
    // 3 shown of 8 → the last click reveals the remaining 5, not a phantom 10.
    expect(nextRevealCount(8, WORKSPACES_INITIAL_REVEAL)).toBe(8);
    expect(nextRevealCount(7, RUNS_INITIAL_REVEAL)).toBe(7);
  });

  it("is idempotent once everything is visible", () => {
    expect(nextRevealCount(3, 3)).toBe(3);
    expect(nextRevealCount(0, RUNS_INITIAL_REVEAL)).toBe(0);
  });

  it("reaches the full list after repeated steps", () => {
    let revealed = WORKSPACES_INITIAL_REVEAL;
    const total = 37;
    for (let i = 0; i < 10 && revealState(total, revealed).canRevealMore; i += 1) {
      revealed = nextRevealCount(total, revealed);
    }
    expect(revealed).toBe(total);
    expect(revealState(total, revealed).canRevealMore).toBe(false);
  });
});
