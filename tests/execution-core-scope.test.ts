import { describe, expect, it } from "vitest";
import { ScopeChecker, type ExecutionScope } from "@manyhands/execution-core";

const checker = new ScopeChecker();

const scope: ExecutionScope = {
  implementationPaths: ["src/auth/**"],
  testPaths: ["tests/auth/**"],
  configPaths: [".env.example"]
};

describe("ScopeChecker", () => {
  it("passes when every file is within an allowed category", () => {
    const result = checker.check({
      changedFiles: ["src/auth/login.ts", "tests/auth/login.test.ts", ".env.example"],
      executionScope: scope
    });

    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("flags files outside the allowed scope", () => {
    const result = checker.check({
      changedFiles: ["src/auth/login.ts", "src/billing/charge.ts"],
      executionScope: scope
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["src/billing/charge.ts"]);
  });

  it("treats forbidden paths as violations even when otherwise allowed (deny wins)", () => {
    const result = checker.check({
      changedFiles: ["src/auth/secrets.env"],
      executionScope: { implementationPaths: ["src/auth/**"], testPaths: [], configPaths: [] },
      forbiddenPaths: ["**/*.env"]
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["src/auth/secrets.env"]);
  });

  it("allows everything except forbidden when no executionScope is given", () => {
    const result = checker.check({
      changedFiles: ["anything/at/all.ts", "secrets/key.pem"],
      forbiddenPaths: ["secrets/**"]
    });

    expect(result.passed).toBe(false);
    expect(result.violations).toEqual(["secrets/key.pem"]);
  });

  it("normalizes backslash paths before matching", () => {
    const result = checker.check({
      changedFiles: ["src\\auth\\login.ts"],
      executionScope: scope
    });

    expect(result.passed).toBe(true);
  });

  it("matches a top-level file against a `dir/**/*.ext` glob (zero intermediate dirs)", () => {
    // Regression: `src/**/*.ts` previously required an intermediate directory,
    // so a leaf that produced exactly `src/bookStore.ts` was wrongly flagged as
    // a scope violation, which failed integration. `**/` must match zero dirs.
    const result = checker.check({
      changedFiles: ["src/bookStore.ts", "src/nested/util.ts", "tests/books.test.ts"],
      executionScope: {
        implementationPaths: ["src/**/*.ts"],
        testPaths: ["tests/**/*.test.ts"],
        configPaths: []
      }
    });

    expect(result.violations).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
