import { describe, expect, it } from "vitest";
import { restartResumesExecution } from "@/lib/server/runs/lifecycle";

describe("restartResumesExecution", () => {
  it("resumes execution when the plan was approved and a plan exists", () => {
    expect(
      restartResumesExecution({ approvedAt: "2026-06-03T00:00:00.000Z", planning: {} })
    ).toBe(true);
  });

  it("resumes execution when the last failure happened during execution", () => {
    expect(restartResumesExecution({ failedDuring: "running", planning: {} })).toBe(true);
  });

  it("resumes execution when interrupted during execution (sweeper path)", () => {
    expect(restartResumesExecution({ interruptedDuring: "running", planning: {} })).toBe(true);
  });

  it("restarts planning when no plan exists yet, even if approved metadata is stale", () => {
    expect(
      restartResumesExecution({ approvedAt: "2026-06-03T00:00:00.000Z", planning: undefined })
    ).toBe(false);
  });

  it("restarts planning for a planning-phase failure (no approval, no plan)", () => {
    expect(restartResumesExecution({ failedDuring: "generating", planning: undefined })).toBe(false);
  });

  it("restarts planning for a fresh interrupted-during-generating run", () => {
    expect(restartResumesExecution({ interruptedDuring: "generating", planning: undefined })).toBe(
      false
    );
  });
});
