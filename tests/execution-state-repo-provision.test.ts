import { describe, expect, it } from "vitest";
import { resolveRepoProvisionAction } from "@/lib/server/runs/execution-state";
import type { ProvisionedRepo } from "@/lib/server/runs/repo-provisioner";

const PROVISIONED: ProvisionedRepo = {
  repoRoot: "/tmp/repo",
  sourceRepoRoot: "/tmp/source",
  sourceBranch: "main",
  sourceBaseCommit: "a".repeat(40),
  baseBranch: "main",
  baseCommit: "a".repeat(40),
  executionBaseCommit: "a".repeat(40),
  cleanup: async () => undefined
};

describe("resolveRepoProvisionAction", () => {
  it("reuses an already-provisioned repo on cold resume, never re-provisioning or erroring", () => {
    // The root cause of the 2026-07-06 E2E wedge: a run interrupted during
    // execution keeps its `provisioned` record. Restart must reuse it. Treating
    // it as `missing` (which the inline pipeline logic did) raised
    // RepoNotConfiguredError and made every execution-interrupted run
    // unrecoverable.
    expect(resolveRepoProvisionAction({ provisioned: PROVISIONED, hasRepoSpec: true })).toBe("reuse");
    // Reuse wins even if the repoSpec is somehow absent from the record.
    expect(resolveRepoProvisionAction({ provisioned: PROVISIONED, hasRepoSpec: false })).toBe("reuse");
  });

  it("provisions when there is a repoSpec but no provisioned record yet (fresh run)", () => {
    expect(resolveRepoProvisionAction({ provisioned: undefined, hasRepoSpec: true })).toBe("provision");
  });

  it("reports missing when there is neither a provisioned record nor a repoSpec", () => {
    expect(resolveRepoProvisionAction({ provisioned: undefined, hasRepoSpec: false })).toBe("missing");
  });
});
