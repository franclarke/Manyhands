import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeInvalidatedTasks, reviewNode } from "@/lib/server/runs/runner";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { TaskGraph } from "@manyhands/task-graph";

function graph(): TaskGraph {
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "0".repeat(40),
    rootId: "root",
    createdAt: "2026-05-26T00:00:00.000Z",
    dependencies: [{ fromTaskId: "a", toTaskId: "b" }],
    nodes: {
      root: { id: "root", parentId: null, kind: "root", title: "Root", goal: "root", status: "planned", granularity: "auto", depth: 0, childrenIds: ["a", "b", "c"], dependencies: [] },
      a: { id: "a", parentId: "root", kind: "leaf", title: "A", goal: "a", status: "planned", granularity: "auto", depth: 1, childrenIds: [], dependencies: [] },
      b: { id: "b", parentId: "root", kind: "leaf", title: "B", goal: "b", status: "planned", granularity: "auto", depth: 1, childrenIds: [], dependencies: ["a"] },
      c: { id: "c", parentId: "root", kind: "leaf", title: "C", goal: "c", status: "planned", granularity: "auto", depth: 1, childrenIds: [], dependencies: [] }
    }
  } as unknown as TaskGraph;
}

describe("computeInvalidatedTasks", () => {
  it("includes the node, its transitive dependents, and ancestors", () => {
    // a -> b (b depends on a). Resetting a invalidates a, b, and their parent root.
    expect([...computeInvalidatedTasks(graph(), "a")].sort()).toEqual(["a", "b", "root"]);
  });

  it("does not invalidate independent siblings or upstream deps", () => {
    // Resetting b invalidates b and its parent, but not a (upstream) or c (independent).
    expect([...computeInvalidatedTasks(graph(), "b")].sort()).toEqual(["b", "root"]);
  });
});

describe("reviewNode", () => {
  let tempDir: string;
  let store: JsonRunRecordStore;

  async function saveRun(status: string, withResults: boolean): Promise<void> {
    await store.save({
      runId: "run-1",
      workspaceId: "ws-1",
      granularity: "balanced",
      model: "gemini-2.5-pro",
      userPrompt: "Add a feature",
      title: "test",
      version: 0,
      status: status as never,
      createdAt: "2026-05-26T00:00:00.000Z",
      updatedAt: "2026-05-26T00:00:00.000Z",
      planning: { decomposition: { graph: graph() } },
      patches: [],
      ...(withResults
        ? {
            execution: {
              runId: "run-1",
              status: "completed",
              leafResults: [
                { taskId: "a", status: "success" },
                { taskId: "b", status: "success" }
              ],
              integrationResults: [{ compositeTaskId: "root", status: "success" }]
            }
          }
        : {})
    });
  }

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-node-review-"));
    process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
    resetRunRepositoryForTests();
    store = new JsonRunRecordStore({ directory: path.join(tempDir, "runs") });
  });

  afterEach(async () => {
    delete process.env.MANYHANDS_RUNS_DIR;
    resetRunRepositoryForTests();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("approve marks the node reviewed without resetting results", async () => {
    await saveRun("completed", true);
    const updated = await reviewNode("run-1", "a", "approve");
    expect(updated.nodeReviews?.a?.status).toBe("approved");
    // approve never touches execution results.
    expect((updated.execution as { leafResults: unknown[] }).leafResults).toHaveLength(2);
  });

  it("request_changes resets the node + downstream closure and records feedback", async () => {
    await saveRun("approved", true);
    const updated = await reviewNode("run-1", "a", "request_changes", "tighten the scope");
    // Resetting a invalidates a, b, and root → all results cleared.
    expect(updated.execution).toBeUndefined();
    expect(updated.nodeReviews?.a).toEqual(
      expect.objectContaining({ status: "changes_requested", feedback: "tighten the scope" })
    );
  });

  it("rejects request_changes/rerun while the run is still executing", async () => {
    await saveRun("running", true);
    await expect(reviewNode("run-1", "a", "request_changes")).rejects.toThrow(/approved/);
    await expect(reviewNode("run-1", "a", "rerun")).rejects.toThrow(/approved/);
  });

  it("re-opens a completed run on request_changes and resets the node", async () => {
    await saveRun("completed", true);
    const updated = await reviewNode("run-1", "a", "request_changes", "redo it");
    expect(updated.status).toBe("approved");
    // Resetting "a" invalidates a, b and root → all results cleared.
    expect(updated.execution).toBeUndefined();
    expect(updated.nodeReviews?.a?.status).toBe("changes_requested");
  });
});
