import type { TaskGraph } from "@manyhands/task-graph";

import { RunExecutionError } from "../errors";

/**
 * Validates the structural invariants the executor relies on, BEFORE any side
 * effect such as worktree creation (I7). Throws `RunExecutionError` (phase
 * "validate") with an actionable message on the first violation, so a
 * malformed graph never produces partially-executed runs or leaked worktrees.
 *
 * Checks: a non-empty `baseCommit`, a `rootId` that resolves to a node, and
 * every `childrenIds` reference pointing at an existing node.
 */
export function assertExecutableGraph(graph: TaskGraph): void {
  const fail = (message: string): never => {
    throw new RunExecutionError(message, "validate", graph.planId);
  };

  if (graph.baseCommit.trim().length === 0) {
    fail("Executable graph requires a non-empty baseCommit.");
  }

  if (graph.nodes[graph.rootId] === undefined) {
    fail(`Graph rootId "${graph.rootId}" does not resolve to a node.`);
  }

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    for (const childId of node.childrenIds) {
      if (graph.nodes[childId] === undefined) {
        fail(`Node "${nodeId}" references a missing child "${childId}".`);
      }
    }
  }
}
