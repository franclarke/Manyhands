import { describe, expect, it } from "vitest";
import { buildRunReceipt, renderRunReceiptMarkdown } from "@/lib/run-receipt";
import type { RunRecord } from "@/lib/server/runs/schema";

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-1",
    workspaceId: "ws",
    granularity: "balanced",
    model: "gemini-2.5-pro",
    userPrompt: "Add a feature",
    title: "Test run",
    status: "completed",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    patches: [],
    ...overrides
  } as RunRecord;
}

describe("buildRunReceipt", () => {
  it("summarizes execution, final application, and changed files", () => {
    const receipt = buildRunReceipt(
      run({
        finalApplicationStatus: "applied",
        finalBranchName: "manyhands/run-run-1-test",
        finalCommitSha: "a".repeat(40),
        baseCommit: "b".repeat(40),
        execution: {
          leafResults: [
            { taskId: "a", status: "success", changedFiles: ["src/a.ts"] },
            { taskId: "b", status: "failed", changedFiles: ["src/b.ts"] }
          ],
          integrationResults: [{ status: "executor_repair_success" }]
        },
        planningCritic: { status: "warnings", findings: [], generatedAt: "x" } as never,
        seamCritic: { status: "clean", seamCount: 1, findings: [], generatedAt: "x" } as never
      })
    );

    expect(receipt.finalApplicationStatus).toBe("applied");
    expect(receipt.finalBranchName).toBe("manyhands/run-run-1-test");
    expect(receipt.leaves).toEqual({ total: 2, succeeded: 1, failed: 1 });
    expect(receipt.integrations).toEqual({ total: 1, succeeded: 1, repaired: 1, failed: 0 });
    expect(receipt.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
    expect(receipt.critics).toEqual({ plan: "warnings", seam: "clean" });
  });

  it("renders markdown with the final branch and execution stats", () => {
    const markdown = renderRunReceiptMarkdown(
      buildRunReceipt(run({ finalApplicationStatus: "applied", finalBranchName: "manyhands/run-x", finalCommitSha: "c".repeat(40) }))
    );
    expect(markdown).toContain("# ManyHands run — Test run");
    expect(markdown).toContain("manyhands/run-x");
    expect(markdown).toContain("## Execution");
  });

  it("handles a run with no execution", () => {
    const receipt = buildRunReceipt(run());
    expect(receipt.leaves.total).toBe(0);
    expect(receipt.filesChanged).toEqual([]);
    expect(receipt.finalApplicationStatus).toBeUndefined();
  });
});
