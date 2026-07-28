import { describe, expect, it } from "vitest";
import {
  wideGraphCloneArgs,
  wideGraphOracleCommands
} from "../docs/tesis/evidence/scripts/lib/wide-graph-oracle-plan.mjs";

describe("wide graph external oracle plan", () => {
  it("installs the frozen lockfile before running gates in a clean external clone", () => {
    expect(wideGraphOracleCommands[0]).toEqual(["install", "--frozen-lockfile"]);
    expect(wideGraphOracleCommands.slice(1)).toEqual([
      ["test"],
      ["typecheck"],
      ["build"]
    ]);
  });

  it("scopes the Git ownership exception to the source repository", () => {
    expect(wideGraphCloneArgs("C:\\external\\warehouse", "C:\\temp\\verification")).toEqual([
      "-c",
      "safe.directory=C:\\external\\warehouse",
      "clone",
      "--no-hardlinks",
      "C:\\external\\warehouse",
      "C:\\temp\\verification"
    ]);
  });
});
