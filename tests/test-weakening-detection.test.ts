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

  it("reports newly skipped or focused tests and removed assertions", () => {
    const baseline = `
      it("rejects invalid input", () => {
        expect(validate("bad")).toBe(false);
        expect(audit()).toContain("rejected");
      });
    `;

    for (const [candidate, code] of [
      [baseline.replace('it("rejects', 'it.skip("rejects'), "test_skipped"],
      [baseline.replace('it("rejects', 'it.only("rejects'), "test_only"],
      [baseline.replace('        expect(audit()).toContain("rejected");\n', ""), "assertion_removed"]
    ] as const) {
      expect(detectTestIntegrityFindings({
        baselineTestFiles: ["tests/validation.test.ts"],
        candidateTestFiles: ["tests/validation.test.ts"],
        baselineScripts: { test: "vitest run" },
        candidateScripts: { test: "vitest run" },
        baselineTestContents: { "tests/validation.test.ts": baseline },
        candidateTestContents: { "tests/validation.test.ts": candidate }
      })).toEqual([expect.objectContaining({ code, path: "tests/validation.test.ts", findingId: expect.any(String) })]);
    }

    expect(detectTestIntegrityFindings({
      baselineTestFiles: [],
      candidateTestFiles: ["tests/new.test.ts"],
      baselineScripts: { test: "vitest run" },
      candidateScripts: { test: "vitest run" },
      candidateTestContents: { "tests/new.test.ts": 'it.only("new", () => { expect(true).toBe(true); });' }
    })).toEqual([expect.objectContaining({ code: "test_only", path: "tests/new.test.ts" })]);
  });
});
