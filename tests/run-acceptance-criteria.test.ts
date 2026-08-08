import { describe, expect, it } from "vitest";
import { RunCreateRequestSchema } from "@/lib/server/runs/schema";

describe("run creation acceptance criteria", () => {
  it("accepts explicit criteria that must reach the planning contract", () => {
    const result = RunCreateRequestSchema.safeParse({
      workspaceId: "warehouse",
      userPrompt: "Add order priority",
      acceptanceCriteria: [
        "priority accepts only standard or express and defaults to standard",
        "invalid priority is rejected"
      ]
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.acceptanceCriteria).toEqual([
      "priority accepts only standard or express and defaults to standard",
      "invalid priority is rejected"
    ]);
  });
});
