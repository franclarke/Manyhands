import { describe, expect, it } from "vitest";
import { formatOracleFailure } from "../docs/tesis/evidence/scripts/lib/warehouse-oracle-result.mjs";

describe("Warehouse oracle runner", () => {
  it("uses non-empty stdout when a package-manager failure has an empty stderr", () => {
    expect(formatOracleFailure({
      stdout: "ERR_PNPM_OUTDATED_LOCKFILE lockfile is stale",
      stderr: "",
      message: "Command failed"
    })).toBe("ERR_PNPM_OUTDATED_LOCKFILE lockfile is stale");
  });
});
