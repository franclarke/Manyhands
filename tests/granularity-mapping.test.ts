import { describe, expect, it } from "vitest";
import {
  GRANULARITY_FROM_MODE,
  GRANULARITY_LEVELS,
  GRANULARITY_TO_MODE,
  fromDecompositionMode,
  isGranularityLevel,
  toDecompositionMode
} from "@/lib/granularity";
import type { DecompositionMode } from "@manyhands/decomposer";

describe("granularity mapping", () => {
  it("declares the expected 3 UI levels", () => {
    expect([...GRANULARITY_LEVELS]).toEqual(["baja", "media", "alta"]);
  });

  it("maps each level to a DecompositionMode", () => {
    expect(GRANULARITY_TO_MODE.baja).toBe("coarse");
    expect(GRANULARITY_TO_MODE.media).toBe("balanced");
    expect(GRANULARITY_TO_MODE.alta).toBe("fine");
  });

  it("round-trips through the bijection", () => {
    for (const level of GRANULARITY_LEVELS) {
      expect(fromDecompositionMode(toDecompositionMode(level))).toBe(level);
    }
    const modes: DecompositionMode[] = ["coarse", "balanced", "fine"];
    for (const mode of modes) {
      expect(toDecompositionMode(GRANULARITY_FROM_MODE[mode])).toBe(mode);
    }
  });

  it("isGranularityLevel narrows correctly", () => {
    expect(isGranularityLevel("baja")).toBe(true);
    expect(isGranularityLevel("alta")).toBe(true);
    expect(isGranularityLevel("ultra")).toBe(false);
    expect(isGranularityLevel(42)).toBe(false);
    expect(isGranularityLevel(null)).toBe(false);
  });
});
