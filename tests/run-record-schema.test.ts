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

const CANONICAL_CREATE = {
  workspaceId: "workspace-v2",
  userPrompt: "Build notes",
  planningSelection: { executorId: "claude-code-cli", model: "sonnet" },
  executionSelection: { executorId: "codex-cli", model: "gpt-5.5", effort: "medium" }
};

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
    expect(RunCreateRequestSchema.safeParse(CANONICAL_CREATE).success).toBe(true);
    const canonical = CANONICAL_CREATE;
    expect(RunCreateRequestSchema.safeParse({ ...canonical, granularity: "balanced" }).success).toBe(false);
    // A collapses the goal by instruction; C applies the policy. The historical
    // labels named policies this build no longer implements, so a run cannot be
    // planned under them.
    for (const granularityCondition of ["A", "C"]) {
      expect(RunCreateRequestSchema.safeParse({ ...canonical, granularityCondition }).success).toBe(true);
    }
    for (const granularityCondition of ["B", "C1", "C2"]) {
      expect(RunCreateRequestSchema.safeParse({ ...canonical, granularityCondition }).success).toBe(false);
      expect(RunRecordSchema.safeParse({ ...makeRunRecordV2(), granularityCondition }).success).toBe(false);
    }
  });

  /**
   * Stage 3F of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
   *
   * The legacy one-shot planner is retired. Its only two entry points were a
   * pre-computed candidate handed to the API and a candidate-set budget; a run
   * that still named either would be asking for machinery that no longer
   * exists, so the request must be rejected rather than silently ignored.
   */
  it("rejects the retired legacy planning entry points", () => {
    expect(RunCreateRequestSchema.safeParse({
      ...CANONICAL_CREATE,
      experimentalCandidate: { sourceHash: "sha256:0", repositorySnapshotId: "snapshot", goal: "Build notes", acceptanceCriteria: [], breakdown: {} }
    }).success).toBe(false);
    expect(RunCreateRequestSchema.safeParse({ ...CANONICAL_CREATE, candidateCount: 2 }).success).toBe(false);
    expect(RunRecordSchema.safeParse({ ...makeRunRecordV2(), candidateCount: 2 }).success).toBe(false);
  });
});
