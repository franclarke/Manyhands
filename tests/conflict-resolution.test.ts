import { describe, expect, it } from "vitest";
import { planConflictResolution } from "@/lib/conflict-resolution";
import type { ConflictListItem } from "@/lib/conflict-view-model";

function makeConflict(over: Partial<ConflictListItem>): ConflictListItem {
  return {
    pairKey: "a::b",
    taskAId: "a",
    taskBId: "b",
    taskATitle: "A",
    taskBTitle: "B",
    level: "high",
    score: 0.8,
    reason: "Both edit the same module.",
    recommendation: "serialize",
    sharedFiles: ["src/foo.ts"],
    sharedPaths: [],
    sharedSymbols: [],
    evidence: [],
    acknowledged: false,
    ...over
  };
}

describe("planConflictResolution", () => {
  it("acknowledges every actionable, not-yet-acknowledged conflict", () => {
    const plan = planConflictResolution([
      makeConflict({ taskAId: "a", taskBId: "b", level: "high" }),
      makeConflict({ taskAId: "c", taskBId: "d", level: "medium" }),
      makeConflict({ taskAId: "e", taskBId: "f", level: "blocking" })
    ]);
    expect(plan.acknowledgements.map((a) => a.taskIds)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"]
    ]);
  });

  it("skips conflicts already acknowledged (idempotent)", () => {
    const plan = planConflictResolution([
      makeConflict({ taskAId: "a", taskBId: "b", acknowledged: true }),
      makeConflict({ taskAId: "c", taskBId: "d", acknowledged: false })
    ]);
    expect(plan.acknowledgements.map((a) => a.taskIds)).toEqual([["c", "d"]]);
  });

  it("ignores low-risk conflicts", () => {
    const plan = planConflictResolution([makeConflict({ level: "low" })]);
    expect(plan.acknowledgements).toHaveLength(0);
  });

  it("captures the explanation and shared files in the reason", () => {
    const [ack] = planConflictResolution([
      makeConflict({ reason: "Both touch the auth router.", sharedFiles: ["src/auth.ts"] })
    ]).acknowledgements;
    expect(ack?.reason).toContain("Both touch the auth router.");
    expect(ack?.reason).toContain("src/auth.ts");
  });

  it("caps the reason at the patch-schema limit of 1000 chars", () => {
    const [ack] = planConflictResolution([
      makeConflict({ reason: "x".repeat(2000) })
    ]).acknowledgements;
    expect(ack!.reason.length).toBeLessThanOrEqual(1000);
  });
});
