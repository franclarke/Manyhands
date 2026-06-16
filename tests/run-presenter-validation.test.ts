import { describe, expect, it } from "vitest";
import { toRunResponse } from "@/lib/server/runs/presenter";
import type { RunRecord } from "@/lib/server/runs/schema";

function baseRun(): RunRecord {
  return {
    runId: "r1",
    workspaceId: "w1",
    granularity: "balanced",
    model: "gemini-2.5-flash",
    userPrompt: "x",
    title: "x",
    version: 1,
    status: "completed",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    patches: []
  } as unknown as RunRecord;
}

describe("toRunResponse validation", () => {
  it("passes the validation summary through", () => {
    const run = { ...baseRun(), validation: { status: "unverified" as const } };
    expect(toRunResponse(run).run.validation).toEqual({ status: "unverified" });
  });

  it("omits validation when absent", () => {
    expect(toRunResponse(baseRun()).run.validation).toBeUndefined();
  });
});
