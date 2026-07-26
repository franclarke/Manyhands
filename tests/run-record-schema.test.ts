import { describe, expect, it } from "vitest";

import {
  RUN_FILE_VERSION,
  RUN_STATUS_VALUES,
  RunCreateRequestSchema,
  RunFileSchema,
  RunRecordSchema
} from "@/lib/server/runs/schema";
import { RUN_USER_PROMPT_MAX_LENGTH } from "@/lib/run-limits";
import { makeRunRecordV2 } from "./helpers/run-v2-record";

describe("V2 run-record schema", () => {
  it("accepts the minimal canonical record and rejects V1 dual-truth fields", () => {
    expect(RunRecordSchema.safeParse(makeRunRecordV2()).success).toBe(true);
    expect(RunRecordSchema.safeParse({ ...makeRunRecordV2(), status: "running" }).success).toBe(false);
  });

  it("enforces the prompt limit", () => {
    expect(RunRecordSchema.safeParse(makeRunRecordV2({ userPrompt: "x".repeat(RUN_USER_PROMPT_MAX_LENGTH) })).success).toBe(true);
    expect(RunRecordSchema.safeParse(makeRunRecordV2({ userPrompt: "x".repeat(RUN_USER_PROMPT_MAX_LENGTH + 1) })).success).toBe(false);
  });

  it("exposes only canonical lifecycle values", () => {
    expect(RUN_STATUS_VALUES).toEqual([
      "planning", "needs_approval", "running", "waiting_for_input", "paused", "cancelling",
      "interrupted", "result_ready", "delivering", "completed", "failed"
    ]);
  });

  it("enforces the V2 file envelope", () => {
    const run = makeRunRecordV2();
    expect(RunFileSchema.safeParse({ version: RUN_FILE_VERSION, run }).success).toBe(true);
    expect(RunFileSchema.safeParse({ version: 1, run }).success).toBe(false);
  });

  it("accepts canonical create input and rejects removed V1 fields", () => {
    const canonical = {
      workspaceId: "workspace-v2",
      userPrompt: "Build notes",
      planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
      executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" }
    };
    expect(RunCreateRequestSchema.safeParse(canonical).success).toBe(true);
    expect(RunCreateRequestSchema.safeParse({ ...canonical, granularity: "balanced" }).success).toBe(false);
    for (const granularityCondition of ["A", "B", "C"]) {
      expect(RunCreateRequestSchema.safeParse({ ...canonical, granularityCondition }).success).toBe(true);
    }
    for (const granularityCondition of ["C1", "C2"]) {
      expect(RunCreateRequestSchema.safeParse({ ...canonical, granularityCondition }).success).toBe(false);
      expect(RunRecordSchema.safeParse({ ...makeRunRecordV2(), granularityCondition }).success).toBe(true);
    }
  });
});
