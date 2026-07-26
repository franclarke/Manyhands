import { describe, expect, it } from "vitest";
import { checkWideGraphOutput } from "../docs/tesis/evidence/scripts/lib/wide-graph-oracle.mjs";

describe("wide graph external oracle", () => {
  it("accepts an ordered deterministic report for the requested width", () => {
    expect(checkWideGraphOutput({
      schemaVersion: 1,
      moduleCount: 4,
      scenario: "thesis-seed-2026",
      projections: ["projection-01", "projection-02", "projection-03", "projection-04"]
    }, 4)).toEqual([]);
  });

  it("rejects an incomplete or out-of-order registry report", () => {
    expect(checkWideGraphOutput({
      schemaVersion: 1,
      moduleCount: 4,
      scenario: "thesis-seed-2026",
      projections: ["projection-02", "projection-01"]
    }, 4)).toEqual(expect.arrayContaining([
      expect.stringContaining("projection count"),
      expect.stringContaining("projection order")
    ]));
  });
});
