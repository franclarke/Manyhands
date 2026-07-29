import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareBaselineResult, detectTestIntegrityFindings, materializeNegativeControlTests } from "@manyhands/execution-core";

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

    expect(detectTestIntegrityFindings({
      baselineTestFiles: ["tests/assert.test.ts"],
      candidateTestFiles: ["tests/assert.test.ts"],
      baselineScripts: { test: "vitest run" },
      candidateScripts: { test: "vitest run" },
      baselineTestContents: { "tests/assert.test.ts": 'it("works", () => { assert(run()); });' },
      candidateTestContents: { "tests/assert.test.ts": 'it("works", () => { run(); });' }
    })).toEqual([expect.objectContaining({ code: "assertion_removed", path: "tests/assert.test.ts" })]);
  });

  it("fails closed when an established test script changes coverage", () => {
    for (const candidate of ["vitest run tests/smoke.test.ts", "echo ok"] as const) {
      expect(detectTestIntegrityFindings({
        baselineTestFiles: [],
        candidateTestFiles: [],
        baselineScripts: { "package.json#scripts.test": "vitest run" },
        candidateScripts: { "package.json#scripts.test": candidate }
      })).toEqual([expect.objectContaining({
        code: "test_script_weakened",
        path: "package.json#scripts.test"
      })]);
    }
    expect(detectTestIntegrityFindings({
      baselineTestFiles: [], candidateTestFiles: [],
      baselineScripts: { "package.json#scripts.test": "pnpm run unit", "package.json#scripts.unit": "vitest run" },
      candidateScripts: { "package.json#scripts.test": "pnpm run unit", "package.json#scripts.unit": "vitest run tests/smoke.test.ts" }
    })).toContainEqual(expect.objectContaining({ code: "test_script_weakened", path: "package.json#scripts.unit" }));
    expect(detectTestIntegrityFindings({
      baselineTestFiles: [], candidateTestFiles: [], baselineScripts: {}, candidateScripts: {},
      changedTestConfigurationPaths: ["vitest.config.ts"]
    })).toEqual([expect.objectContaining({ code: "test_configuration_changed", path: "vitest.config.ts" })]);
  });

  it("rejects symlinked parents before materializing a negative control", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mh-nc-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "mh-nc-outside-"));
    try {
      await mkdir(path.join(outside, "target"));
      await symlink(path.join(outside, "target"), path.join(root, "tests"), process.platform === "win32" ? "junction" : "dir");
      await expect(materializeNegativeControlTests(root, {
        "tests/escape.test.ts": "expect(true).toBe(true);"
      })).rejects.toThrow(/symbolic link/i);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
