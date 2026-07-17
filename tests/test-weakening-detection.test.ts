import { describe, expect, it } from "vitest";
import { compareBaselineResult, detectTestIntegrityFindings } from "@manyhands/execution-core";

describe("test integrity and baseline", () => {
  it("distinguishes a pre-existing baseline failure from a new regression", () => {
    expect(compareBaselineResult({ baselinePassed: false, candidatePassed: false })).toBe("preexisting_failure");
    expect(compareBaselineResult({ baselinePassed: true, candidatePassed: false })).toBe("regression");
  });

  it("reports removed tests and weakened test scripts", () => {
    expect(detectTestIntegrityFindings({
      baselineTestFiles: ["tests/auth.test.ts", "tests/api.test.ts"],
      candidateTestFiles: ["tests/api.test.ts"],
      baselineScripts: { test: "vitest run" },
      candidateScripts: { test: "vitest run --passWithNoTests" }
    })).toEqual([
      expect.objectContaining({ code: "test_removed", path: "tests/auth.test.ts" }),
      expect.objectContaining({ code: "test_script_weakened", path: "package.json#scripts.test" })
    ]);
  });
});
