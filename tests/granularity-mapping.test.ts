import { describe, expect, it } from "vitest";
import {
  GRANULARITY_FROM_MODE,
  GRANULARITY_LEVELS,
  GRANULARITY_TO_MODE,
  fromGranularityMode,
  isGranularityLevel,
  toGranularityMode
} from "@/lib/granularity";
import type { GranularityMode } from "@/lib/server/runs/schema";

describe("granularity mapping", () => {
  it("declares the expected 4 UI levels including auto", () => {
    expect([...GRANULARITY_LEVELS]).toEqual(["automatica", "baja", "media", "alta"]);
  });

  it("maps each level to a GranularityMode", () => {
    expect(GRANULARITY_TO_MODE.automatica).toBe("auto");
    expect(GRANULARITY_TO_MODE.baja).toBe("coarse");
    expect(GRANULARITY_TO_MODE.media).toBe("balanced");
    expect(GRANULARITY_TO_MODE.alta).toBe("fine");
  });

  it("round-trips through the bijection", () => {
    for (const level of GRANULARITY_LEVELS) {
      expect(fromGranularityMode(toGranularityMode(level))).toBe(level);
    }
    const modes: GranularityMode[] = ["auto", "coarse", "balanced", "fine"];
    for (const mode of modes) {
      expect(toGranularityMode(GRANULARITY_FROM_MODE[mode])).toBe(mode);
    }
  });

  it("isGranularityLevel narrows correctly", () => {
    expect(isGranularityLevel("automatica")).toBe(true);
    expect(isGranularityLevel("baja")).toBe(true);
    expect(isGranularityLevel("alta")).toBe(true);
    expect(isGranularityLevel("ultra")).toBe(false);
    expect(isGranularityLevel(42)).toBe(false);
    expect(isGranularityLevel(null)).toBe(false);
  });
});
