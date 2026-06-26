import { describe, expect, it } from "vitest";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import type { RunRecord } from "@/lib/server/runs/schema";

const AT = "2026-06-06T00:00:00.000Z";

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-partial",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-flash",
    userPrompt: "Feature",
    title: "Feature",
    version: 0,
    status: "failed",
    createdAt: AT,
    updatedAt: AT,
    patches: [],
    ...overrides
  };
}

describe("projectRunRecordToSnapshot — partial planning", () => {
  it("returns null (never throws) when planning lacks feature/summary/schedule", () => {
    // A failed run can persist a partial planning snapshot shaped like
    // `{ decomposition: { graph } }` with no feature/summary/schedule. The
    // projection promises `RunSnapshot | null`, so it must degrade to null
    // instead of throwing on `planning.decomposition.feature.id`.
    const run = makeRun({
      planning: {
        decomposition: { graph: { rootId: "root", nodes: {}, dependencies: [] } }
      } as unknown as RunRecord["planning"]
    });

    expect(() => projectRunRecordToSnapshot(run)).not.toThrow();
    expect(projectRunRecordToSnapshot(run)).toBeNull();
  });

  it("still returns null when the record has neither planning nor execution", () => {
    expect(projectRunRecordToSnapshot(makeRun())).toBeNull();
  });

  it("returns null (never throws) when execution.snapshot is partial (no graphSnapshot) — F-007", () => {
    // `execution` persists as z.unknown(); a legacy/corrupt record can carry
    // `{ snapshot: {} }`. The projection used to return that `{}` as-is, violating
    // its `RunSnapshot | null` contract, and a downstream consumer then crashed on
    // `snapshot.graphSnapshot.nodes`. It must degrade to null instead.
    const run = makeRun({
      execution: { snapshot: {} } as unknown as RunRecord["execution"]
    });
    expect(() => projectRunRecordToSnapshot(run)).not.toThrow();
    expect(projectRunRecordToSnapshot(run)).toBeNull();
  });
});
