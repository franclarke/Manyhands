import { expect, it } from "vitest";
import type { TaskGraph } from "@manyhands/task-graph";
import { backfillRunValidationCommands, collectRunValidationCommands } from "@/lib/server/runs/execution-state";

it("a backfilled graph exposes the run command to the execution reader", () => {
  const graph = {
    id: "g",
    planId: "p",
    repo: "r",
    baseBranch: "main",
    baseCommit: "0".repeat(40),
    rootId: "root",
    createdAt: "2026-06-16T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "root",
        title: "R",
        goal: "r",
        status: "planned",
        granularity: "auto",
        depth: 0,
        childrenIds: [],
        dependencies: [],
        contract: {}
      }
    }
  } as unknown as TaskGraph;

  const { graph: next } = backfillRunValidationCommands(graph, { packageManager: "npm", test: "npm run test" });
  expect(collectRunValidationCommands(next)).toHaveLength(1);
});
