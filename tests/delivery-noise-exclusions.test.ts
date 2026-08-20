import { describe, expect, it } from "vitest";
import {
  targetWorkingTreeIsClean,
  userWorkingTreeChanges
} from "@manyhands/execution-core";

describe("targetWorkingTreeIsClean with transient build noise exclusions", () => {
  it("ignores standard build cache and tool directories (.turbo, .cache, .tmp, coverage)", () => {
    expect(targetWorkingTreeIsClean("?? .turbo/cache/xyz.json")).toBe(true);
    expect(targetWorkingTreeIsClean("?? .cache/turbo/123")).toBe(true);
    expect(targetWorkingTreeIsClean("?? node_modules/.cache/tsup/build.tsbuildinfo")).toBe(true);
    expect(targetWorkingTreeIsClean("?? .tmp/scratch.log")).toBe(true);
    expect(targetWorkingTreeIsClean("?? coverage/lcov.info")).toBe(true);
  });

  it("still reports user source code changes as dirty", () => {
    expect(targetWorkingTreeIsClean(" M src/index.ts")).toBe(false);
    expect(targetWorkingTreeIsClean("?? packages/core/new-feature.ts")).toBe(false);
    expect(targetWorkingTreeIsClean("?? .turbo/cache/xyz.json\n M src/index.ts")).toBe(false);
  });

  it("supports custom extra exclusions when provided", () => {
    const customOptions = { extraExclusions: [".custom-scratch", "dist-scratch"] };
    expect(targetWorkingTreeIsClean("?? .custom-scratch/file.txt", customOptions)).toBe(true);
    expect(targetWorkingTreeIsClean("?? dist-scratch/bundle.js", customOptions)).toBe(true);
    expect(targetWorkingTreeIsClean("?? other-dir/file.txt", customOptions)).toBe(false);
  });

  it("lists only real user changes in userWorkingTreeChanges", () => {
    const porcelain = "?? .turbo/cache/1\n?? .manyhands/worktree\n M src/domain.ts\n?? docs/new-doc.md";
    const userChanges = userWorkingTreeChanges(porcelain);
    expect(userChanges).toEqual([" M src/domain.ts", "?? docs/new-doc.md"]);
  });
});
