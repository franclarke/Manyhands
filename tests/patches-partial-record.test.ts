import { describe, expect, it } from "vitest";
import { applyPatchesUpTo } from "@/lib/server/runs/patches";
import type { RunRecord } from "@/lib/server/runs/schema";

const AT = "2026-06-23T00:00:00.000Z";

function baseRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-partial",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "sonnet",
    userPrompt: "Feature",
    title: "Feature",
    version: 0,
    status: "failed",
    createdAt: AT,
    updatedAt: AT,
    patches: [],
    ...overrides
  } as RunRecord;
}

const RENAME_PATCH = {
  id: "p1",
  createdAt: AT,
  actor: "human" as const,
  type: "NODE_RENAMED" as const,
  taskId: "n1",
  title: "Nuevo título"
};

describe("applyPatchesUpTo — partial/malformed persisted payloads (F-006)", () => {
  // `planning`/`execution` persist as z.unknown(); a failed or in-flight run can
  // carry a partial payload (no `decomposition`/`graphSnapshot`). Building the
  // patch context used to dereference `.decomposition.graph` / `.graphSnapshot`
  // unconditionally and throw, which would 500 any editing/patch-replay request.

  it("does not throw when run.planning lacks decomposition", () => {
    const run = baseRun({ planning: { summary: {} } as unknown as RunRecord["planning"] });
    expect(() => applyPatchesUpTo(run, [RENAME_PATCH])).not.toThrow();
  });

  it("does not throw when execution.planning lacks decomposition", () => {
    const run = baseRun({
      execution: { planning: { summary: {} } } as unknown as RunRecord["execution"]
    });
    expect(() => applyPatchesUpTo(run, [RENAME_PATCH])).not.toThrow();
  });

  it("does not throw when execution.snapshot lacks graphSnapshot", () => {
    const run = baseRun({
      execution: { snapshot: {} } as unknown as RunRecord["execution"]
    });
    expect(() => applyPatchesUpTo(run, [RENAME_PATCH])).not.toThrow();
  });

  it("still applies patches when planning is fully formed (guard does not over-skip)", () => {
    const run = baseRun({
      planning: {
        decomposition: {
          graph: {
            rootId: "root",
            nodes: {
              n1: {
                id: "n1",
                parentId: "root",
                kind: "leaf",
                title: "Viejo",
                goal: "g",
                status: "planned",
                granularity: "auto",
                depth: 1,
                childrenIds: []
              }
            },
            dependencies: []
          },
          contracts: []
        }
      } as unknown as RunRecord["planning"]
    });

    const result = applyPatchesUpTo(run, [RENAME_PATCH]);
    const planning = result.planning as {
      decomposition: { graph: { nodes: Record<string, { title: string }> } };
    };
    expect(planning.decomposition.graph.nodes.n1.title).toBe("Nuevo título");
  });
});
