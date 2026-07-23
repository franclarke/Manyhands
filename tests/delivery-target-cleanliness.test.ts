import { describe, expect, it } from "vitest";
import { targetWorkingTreeIsClean } from "@manyhands/execution-core";

/**
 * Delivery must refuse to publish over a dirty USER working tree, but
 * ManyHands' own runtime directory (`.manyhands/`, where the worktree pool and
 * run artifacts live inside the target repository) is not user work. Counting
 * it as dirt makes ManyHands block delivery of the very work it produced —
 * observed in the canonical run, where `?? .manyhands/` was the only porcelain
 * entry.
 */
describe("targetWorkingTreeIsClean", () => {
  it("treats an untouched tree as clean", () => {
    expect(targetWorkingTreeIsClean("")).toBe(true);
    expect(targetWorkingTreeIsClean("   \n  ")).toBe(true);
  });

  it("ignores ManyHands' own runtime directory", () => {
    expect(targetWorkingTreeIsClean("?? .manyhands/")).toBe(true);
    expect(targetWorkingTreeIsClean("?? .manyhands/worktree-pool/abc/slot-000/")).toBe(true);
    expect(targetWorkingTreeIsClean(" M .manyhands/runs/run-1.json")).toBe(true);
  });

  it("still reports real user changes as dirty", () => {
    expect(targetWorkingTreeIsClean(" M src/domain/expense.ts")).toBe(false);
    expect(targetWorkingTreeIsClean("?? src/new-file.ts")).toBe(false);
    expect(targetWorkingTreeIsClean("?? .manyhands/\n M src/domain/expense.ts")).toBe(false);
  });

  it("does not confuse a user path that merely starts with the same prefix", () => {
    expect(targetWorkingTreeIsClean("?? .manyhands-notes.md")).toBe(false);
    expect(targetWorkingTreeIsClean("?? src/.manyhands/x.ts")).toBe(false);
  });

  it("handles renames, which porcelain reports with an arrow", () => {
    expect(targetWorkingTreeIsClean("R  src/a.ts -> src/b.ts")).toBe(false);
  });
});
