import { describe, expect, it } from "vitest";
import { wideGraphOracleCommands } from "../docs/tesis/evidence/scripts/lib/wide-graph-oracle-plan.mjs";

describe("wide graph external oracle plan", () => {
  it("installs the frozen lockfile before running gates in a clean external clone", () => {
    expect(wideGraphOracleCommands[0]).toEqual(["install", "--frozen-lockfile"]);
    expect(wideGraphOracleCommands.slice(1)).toEqual([
      ["test"],
      ["typecheck"],
      ["build"]
    ]);
  });
});
