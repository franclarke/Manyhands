import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { ScopeChecker } from "@manyhands/execution-core";

// NOTE: Import error types from the scope-errors module path.
// The test references the class from execution-core's barrel export.
import {
  ScopePathTraversalError,
  ScopeViolationError
} from "@manyhands/execution-core";

/**
 * B-008 — ScopeChecker path traversal guard regression tests.
 *
 * Validates that path normalization prevents escape from the worktree
 * boundary via ../ sequences, absolute paths, and symlink targets.
 */
describe("B-008 ScopeChecker path traversal guard", () => {
  const checker = new ScopeChecker();
  const isWin = process.platform === "win32";
  const worktreeRoot = isWin ? "C:\\repos\\project" : "/repos/project";

  describe("blocked paths", () => {
    it("rejects ../../etc/passwd traversal", () => {
      expect(() => checker.validatePathBoundary(worktreeRoot, "../../etc/passwd")).toThrow(
        ScopeViolationError
      );
    });

    it("rejects src/../../../secret traversal", () => {
      expect(() => checker.validatePathBoundary(worktreeRoot, "src/../../../secret")).toThrow(
        ScopeViolationError
      );
    });

    it("rejects absolute path outside worktree", () => {
      const outsidePath = isWin ? "C:\\Windows\\System32\\cmd.exe" : "/etc/passwd";
      expect(() => checker.validatePathBoundary(worktreeRoot, outsidePath)).toThrow(
        ScopeViolationError
      );
    });

    if (isWin) {
      it("rejects Windows-style backslash traversal", () => {
        expect(() =>
          checker.validatePathBoundary(worktreeRoot, "..\\..\\Windows\\System32")
        ).toThrow(ScopeViolationError);
      });
    }
  });

  describe("allowed paths", () => {
    it("allows normal relative path src/index.ts", () => {
      expect(() => checker.validatePathBoundary(worktreeRoot, "src/index.ts")).not.toThrow();
    });

    it("allows path with ../ that resolves within boundary", () => {
      expect(() =>
        checker.validatePathBoundary(worktreeRoot, "src/../lib/utils.ts")
      ).not.toThrow();
    });

    it("allows deeply nested path", () => {
      expect(() =>
        checker.validatePathBoundary(worktreeRoot, "packages/core/src/deep/file.ts")
      ).not.toThrow();
    });

    it("allows the worktree root itself", () => {
      expect(() => checker.validatePathBoundary(worktreeRoot, ".")).not.toThrow();
    });
  });

  describe("check() with worktreeRoot integration", () => {
    it("throws ScopeViolationError before evaluating globs when traversal detected", () => {
      expect(() =>
        checker.check({
          changedFiles: ["../../escape.txt"],
          worktreeRoot,
          forbiddenPaths: []
        })
      ).toThrow(ScopeViolationError);
    });

    it("passes normal files through to glob evaluation", () => {
      const result = checker.check({
        changedFiles: ["src/app.ts"],
        worktreeRoot,
        forbiddenPaths: []
      });
      expect(result.passed).toBe(true);
      expect(result.violations).toHaveLength(0);
    });

    it("validates boundary before forbidden check", () => {
      expect(() =>
        checker.check({
          changedFiles: ["../../etc/shadow"],
          worktreeRoot,
          forbiddenPaths: ["*.shadow"]
        })
      ).toThrow(ScopeViolationError);
    });
  });

  describe("error properties", () => {
    it("ScopePathTraversalError carries attempted, resolved, and root paths", () => {
      try {
        checker.validatePathBoundary(worktreeRoot, "../../escape");
        expect.unreachable("should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(ScopePathTraversalError);
        const e = error as InstanceType<typeof ScopePathTraversalError>;
        expect(e.attemptedPath).toBe("../../escape");
        expect(e.worktreeRoot).toBe(resolve(worktreeRoot));
        expect(e.resolvedPath).toBeDefined();
      }
    });
  });
});
