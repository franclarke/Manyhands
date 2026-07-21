import type { FixtureMilestone } from "./types";

export function clampPlaybackCursor(cursor: number, total: number): number {
  return Math.min(total, Math.max(0, Math.round(cursor)));
}

export function currentFixtureMilestone(
  milestones: readonly FixtureMilestone[],
  cursor: number
): FixtureMilestone | null {
  return [...milestones].reverse().find((milestone) => milestone.eventIndex <= cursor) ?? null;
}

export function previousFixtureMilestoneCursor(
  milestones: readonly FixtureMilestone[],
  cursor: number
): number {
  return [...milestones].reverse().find((milestone) => milestone.eventIndex < cursor)?.eventIndex ?? 0;
}

export function nextFixtureMilestoneCursor(
  milestones: readonly FixtureMilestone[],
  cursor: number,
  total: number
): number {
  return milestones.find((milestone) => milestone.eventIndex > cursor)?.eventIndex ?? total;
}
