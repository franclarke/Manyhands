import { describe, expect, it } from "vitest";
import {
  advanceVerifiedBase,
  assertOraclePassed,
  buildLongitudinalPlan,
  evaluatePreflight
} from "../docs/tesis/evidence/scripts/lib/warehouse-longitudinal.mjs";

const valid = {
  freeBytes: 30 * 1024 ** 3,
  minimumFreeBytes: 25 * 1024 ** 3,
  manyHandsDirty: false,
  targetDirty: false,
  targetHead: "a".repeat(40),
  expectedBase: "a".repeat(40),
  seedMatches: true,
  promptHashesMatch: true,
  oracleHashesMatch: true,
  distHasPolicyMarker: true,
  commitMatches: true,
  toolchainMatches: true,
  modelMatches: true
};

describe("Warehouse longitudinal driver", () => {
  it("builds a mutation-free eight-cell dry-run plan", () => {
    const plan = buildLongitudinalPlan({ mode: "pilot", baseSha: "a".repeat(40), targetRepo: "C:/target" });
    expect(plan).toHaveLength(8);
    expect(plan.map((cell) => cell.increment)).toEqual(["W1", "W2", "W3", "W4", "W5", "W6", "W7", "W8"]);
    expect(plan.every((cell) => cell.dryRun === true)).toBe(true);
  });

  it.each([
    ["disk_insufficient", { freeBytes: 24 * 1024 ** 3 }],
    ["target_dirty", { targetDirty: true }],
    ["seed_hash_mismatch", { seedMatches: false }],
    ["prompt_hash_mismatch", { promptHashesMatch: false }],
    ["dist_stale", { distHasPolicyMarker: false }]
  ])("rejects %s before execution", (code, override) => {
    expect(evaluatePreflight({ ...valid, ...override })).toEqual(expect.arrayContaining([
      expect.objectContaining({ code })
    ]));
  });

  it("does not adopt a commit when the external oracle fails", () => {
    expect(() => assertOraclePassed({ outcome: "fail", increment: "W3" })).toThrow(/oracle W3 failed/iu);
  });

  it("adopts the verified delivery as the next increment base", () => {
    expect(advanceVerifiedBase({ currentBase: "a".repeat(40), deliveredSha: "b".repeat(40), oracleOutcome: "pass" }))
      .toBe("b".repeat(40));
  });
});
