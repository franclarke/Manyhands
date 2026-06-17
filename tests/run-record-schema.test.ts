import { describe, expect, it } from "vitest";
import {
  RUN_FILE_VERSION,
  RUN_STATUS_VALUES,
  RunFileSchema,
  RunCreateRequestSchema,
  RunRecordSchema,
  RunStatusSchema
} from "@/lib/server/runs/schema";

const baseRun = {
  runId: "abc",
  workspaceId: "ws-1",
  granularity: "balanced" as const,
  model: "claude-opus-4.7",
  userPrompt: "Add login",
  title: "Add login",
  status: "created" as const,
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z"
};

describe("run-record schema", () => {
  it("accepts a minimal RunRecord", () => {
    expect(RunRecordSchema.safeParse(baseRun).success).toBe(true);
  });

  it("rejects unknown status", () => {
    expect(RunRecordSchema.safeParse({ ...baseRun, status: "foo" }).success).toBe(false);
  });

  it("accepts an optional LLM-generated summary", () => {
    const parsed = RunRecordSchema.safeParse({ ...baseRun, summary: "Una mini-app de hábitos con persistencia local." });
    expect(parsed.success).toBe(true);
  });

  it("rejects a summary over 400 chars", () => {
    const parsed = RunRecordSchema.safeParse({ ...baseRun, summary: "x".repeat(401) });
    expect(parsed.success).toBe(false);
  });

  it("accepts persisted live planning nodes while a graph is still generating", () => {
    const parsed = RunRecordSchema.safeParse({
      ...baseRun,
      status: "generating",
      livePlanningNodes: [
        {
          id: "root",
          parentId: null,
          title: "Plan feature",
          goal: "Plan the feature",
          depth: 0,
          state: "active"
        },
        {
          id: "ui-slice",
          parentId: "root",
          title: "UI slice",
          goal: "Plan UI work",
          depth: 1,
          state: "pending",
          decision: "atomic",
          childCount: 0,
          childIds: []
        }
      ]
    });

    expect(parsed.success).toBe(true);
  });

  it("RunStatusSchema enumerates the 10 lifecycle values", () => {
    expect(RUN_STATUS_VALUES.length).toBe(10);
    expect(RUN_STATUS_VALUES).toContain("completed_with_accepted");
    for (const status of RUN_STATUS_VALUES) {
      expect(RunStatusSchema.safeParse(status).success).toBe(true);
    }
  });

  it("RunFileSchema enforces version literal", () => {
    expect(
      RunFileSchema.safeParse({ version: RUN_FILE_VERSION, run: baseRun }).success
    ).toBe(true);
    expect(
      RunFileSchema.safeParse({ version: 99, run: baseRun }).success
    ).toBe(false);
  });

  it("RunCreateRequestSchema requires workspaceId", () => {
    const valid = RunCreateRequestSchema.safeParse({
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "claude-opus-4.7"
    });
    expect(valid.success).toBe(true);

    // Missing workspaceId → rejected.
    expect(
      RunCreateRequestSchema.safeParse({
        granularity: "balanced",
        model: "m"
      }).success
    ).toBe(false);
  });

  it("RunCreateRequestSchema defaults userPrompt to empty string", () => {
    const parsed = RunCreateRequestSchema.parse({
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "claude-opus-4.7"
    });
    expect(parsed.userPrompt).toBe("");
  });

  it("RunCreateRequestSchema rejects unknown planning executor ids", () => {
    expect(
      RunCreateRequestSchema.safeParse({
        workspaceId: "ws-1",
        granularity: "balanced",
        model: "sonnet",
        planningExecutorId: "unknown-cli"
      }).success
    ).toBe(false);
  });

  it("rejects invalid granularity", () => {
    expect(
      RunCreateRequestSchema.safeParse({
        workspaceId: "ws-1",
        granularity: "ultra",
        model: "m"
      }).success
    ).toBe(false);
  });
});
