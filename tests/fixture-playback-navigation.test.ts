import { describe, expect, it } from "vitest";

import {
  clampPlaybackCursor,
  currentFixtureMilestone,
  nextFixtureMilestoneCursor,
  previousFixtureMilestoneCursor
} from "@/lib/run-model/fixture-playback";
import type { FixtureMilestone } from "@/lib/run-model/types";

const milestones: FixtureMilestone[] = [
  { id: "goal", title: "Objetivo", description: "Se crea el run.", eventIndex: 1 },
  { id: "plan", title: "Plan", description: "Se aprueba el grafo.", eventIndex: 8 },
  { id: "result", title: "Resultado", description: "Se entrega el cambio.", eventIndex: 20 }
];

describe("fixture playback navigation", () => {
  it("clamps direct navigation to the available event range", () => {
    expect(clampPlaybackCursor(-4, 20)).toBe(0);
    expect(clampPlaybackCursor(11, 20)).toBe(11);
    expect(clampPlaybackCursor(99, 20)).toBe(20);
  });

  it("moves backward and forward by narrative milestone", () => {
    expect(previousFixtureMilestoneCursor(milestones, 20)).toBe(8);
    expect(previousFixtureMilestoneCursor(milestones, 7)).toBe(1);
    expect(previousFixtureMilestoneCursor(milestones, 0)).toBe(0);
    expect(nextFixtureMilestoneCursor(milestones, 8, 20)).toBe(20);
    expect(nextFixtureMilestoneCursor(milestones, 20, 20)).toBe(20);
  });

  it("labels the current narrative section between milestones", () => {
    expect(currentFixtureMilestone(milestones, 0)).toBeNull();
    expect(currentFixtureMilestone(milestones, 9)?.id).toBe("plan");
    expect(currentFixtureMilestone(milestones, 20)?.id).toBe("result");
  });
});
