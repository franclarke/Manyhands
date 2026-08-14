import { describe, expect, it } from "vitest";

import { assertNoConcurrentResourceConflict } from "@manyhands/orchestrator-graph";

const epistemic = { state: "known" as const, confidence: "high" as const, evidenceRefs: ["evidence:x"] };

function modifyClaim(nodeId: string, resourceId: string) {
  return {
    id: `resource-claim:${nodeId}:${resourceId}:modify`,
    nodeId,
    resourceId,
    source: "planner" as const,
    evidenceRefs: ["evidence:x"],
    epistemic,
    access: "modify" as const,
    ownerPhase: "implementation" as const,
    inputVersion: { kind: "repository_view" as const, digest: "sha256:view" },
    outputArtifact: { id: `artifact:${nodeId}`, revision: 1, digest: "sha256:artifact" }
  };
}

function observeClaim(nodeId: string, resourceId: string) {
  return {
    id: `resource-claim:${nodeId}:${resourceId}:observe`,
    nodeId,
    resourceId,
    source: "planner" as const,
    evidenceRefs: ["evidence:x"],
    epistemic,
    access: "observe" as const,
    inputVersion: { kind: "repository_view" as const, digest: "sha256:view" }
  };
}

describe("Stage 9 selection resource invariant", () => {
  it("admits a wave whose writers touch disjoint resources", () => {
    expect(() => assertNoConcurrentResourceConflict(
      [modifyClaim("unit:a", "resource:a"), modifyClaim("unit:b", "resource:b")],
      ["unit:a", "unit:b"]
    )).not.toThrow();
  });

  it("refuses to run two writers of the same resource at once", () => {
    // Selection is supposed to have filtered this. If it did not, the wave is
    // about to let two concurrent attempts write the same file, so failing
    // loudly is the only safe outcome.
    expect(() => assertNoConcurrentResourceConflict(
      [modifyClaim("unit:a", "resource:shared"), modifyClaim("unit:b", "resource:shared")],
      ["unit:a", "unit:b"]
    )).toThrow(/resource:shared.*unit:a.*unit:b|unit:a.*unit:b.*resource:shared/su);
  });

  it("refuses a writer running beside a reader of the same resource", () => {
    expect(() => assertNoConcurrentResourceConflict(
      [modifyClaim("unit:a", "resource:shared"), observeClaim("unit:b", "resource:shared")],
      ["unit:a", "unit:b"]
    )).toThrow(/resource:shared/u);
  });

  it("ignores conflicts with nodes outside the selected wave", () => {
    expect(() => assertNoConcurrentResourceConflict(
      [modifyClaim("unit:a", "resource:shared"), modifyClaim("unit:c", "resource:shared")],
      ["unit:a", "unit:b"]
    )).not.toThrow();
  });

  it("allows two readers of the same resource", () => {
    expect(() => assertNoConcurrentResourceConflict(
      [observeClaim("unit:a", "resource:shared"), observeClaim("unit:b", "resource:shared")],
      ["unit:a", "unit:b"]
    )).not.toThrow();
  });

  it("allows one node to hold several claims on its own resource", () => {
    expect(() => assertNoConcurrentResourceConflict(
      [modifyClaim("unit:a", "resource:a"), observeClaim("unit:a", "resource:a")],
      ["unit:a"]
    )).not.toThrow();
  });
});
