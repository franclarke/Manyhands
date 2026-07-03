import { validateExecutableTaskGraph, type TaskGraph, type TaskValidationIssue } from "@manyhands/task-graph";

import { RunExecutionError } from "../errors";

/**
 * Validates the structural invariants the executor relies on, BEFORE any side
 * effect such as worktree creation (I7). Throws `RunExecutionError` (phase
 * "validate") with an actionable message on the first violation, so a
 * malformed graph never produces partially-executed runs or leaked worktrees.
 *
 * Checks: a non-empty `baseCommit` plus the executable TaskGraph/contract
 * invariants from `@manyhands/task-graph`.
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

  const error = validateExecutableTaskGraph(graph).find((issue) => issue.severity === "error");
  if (error !== undefined) {
    fail(formatTaskValidationIssue(error));
  }
}

function formatTaskValidationIssue(issue: TaskValidationIssue): string {
  return issue.taskId !== undefined
    ? `${issue.code} (${issue.taskId}): ${issue.message}`
    : `${issue.code}: ${issue.message}`;
}
