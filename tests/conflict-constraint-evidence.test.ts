import { describe, expect, it } from "vitest";
import { createConflictConstraintEvidence } from "@manyhands/conflict-risk";

describe("conflict constraint evidence", () => {
  it("keeps missing evidence unknown instead of degrading it to low", () => {
    const constraint = createConflictConstraintEvidence({ id: "constraint-1", leftNodeId: "a", rightNodeId: "b", reason: "Possible shared surface", signals: [], confidence: 0, observedAt: "2026-07-17T00:00:00.000Z" });
    expect(constraint.risk).toBe("unknown");
    expect(constraint.expiresAt).toBeDefined();
  });
});
