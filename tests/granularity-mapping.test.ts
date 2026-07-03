import { describe, expect, it } from "vitest";
import {
  GRANULARITY_FROM_MODE,
  GRANULARITY_DISPLAY_OPTIONS,
  GRANULARITY_LEVELS,
  GRANULARITY_TO_MODE,
  fromGranularityMode,
  granularityImpactForLevel,
  granularityLabelForMode,
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

  it("exposes product-facing labels without changing backend modes", () => {
    expect(granularityLabelForMode("coarse")).toBe("Baja");
    expect(granularityLabelForMode("balanced")).toBe("Media");
    expect(granularityLabelForMode("fine")).toBe("Alta");
    expect(granularityImpactForLevel("alta")).toContain("dividiendo");
  });

  it("exposes exactly the 4 selectable levels (no dead 'max' option)", () => {
    expect(GRANULARITY_DISPLAY_OPTIONS.map((option) => option.id)).toEqual([
      "automatica",
      "baja",
      "media",
      "alta"
    ]);
    expect(GRANULARITY_DISPLAY_OPTIONS.every((option) => option.disabled !== true)).toBe(true);
  });
});
