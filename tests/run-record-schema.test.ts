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
  scenarioId: "passwordless-login",
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

  it("RunStatusSchema enumerates the 9 lifecycle values", () => {
    // Fase C added the `interrupted` status for orphaned runs.
    expect(RUN_STATUS_VALUES.length).toBe(9);
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

  it("RunCreateRequestSchema requires workspaceId and scenarioId", () => {
    const valid = RunCreateRequestSchema.safeParse({
      workspaceId: "ws-1",
      scenarioId: "passwordless-login",
      granularity: "balanced",
      model: "claude-opus-4.7"
    });
    expect(valid.success).toBe(true);

    expect(
      RunCreateRequestSchema.safeParse({
        scenarioId: "x",
        granularity: "balanced",
        model: "m"
      }).success
    ).toBe(false);
  });

  it("RunCreateRequestSchema defaults userPrompt to empty string", () => {
    const parsed = RunCreateRequestSchema.parse({
      workspaceId: "ws-1",
      scenarioId: "passwordless-login",
      granularity: "balanced",
      model: "claude-opus-4.7"
    });
    expect(parsed.userPrompt).toBe("");
  });

  it("rejects invalid granularity", () => {
    expect(
      RunCreateRequestSchema.safeParse({
        workspaceId: "ws-1",
        scenarioId: "x",
        granularity: "ultra",
        model: "m"
      }).success
    ).toBe(false);
  });
});
