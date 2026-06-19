import { join } from "node:path";
import { SimpleGitRunner } from "../git/runner.js";
import { WorktreeManager, worktreeBranchFor, worktreePathFor } from "../worktree/manager.js";
import type { TaskGraph } from "@manyhands/task-graph";
import type { AgentExecutionResult, IntegrationResult } from "../types.js";

export interface AmendSeamParams {
  repoRoot: string;
  runId: string;
  graph: TaskGraph;
  seamId: string;
  leafResults: AgentExecutionResult[];
  integrationResults: IntegrationResult[];
}

export interface InvalidateTaskParams {
  repoRoot: string;
  runId: string;
  graph: TaskGraph;
  taskId: string;
  leafResults: AgentExecutionResult[];
  integrationResults: IntegrationResult[];
}

export interface InvalidationResult {
  leafResults: AgentExecutionResult[];
  integrationResults: IntegrationResult[];
  invalidatedTaskIds: Set<string>;
}

/**
 * Invalidation closure for replanning a whole subtree: the task itself, every
 * descendant (their work is being discarded), every transitive dependent of
 * any member (they built against outputs that will change), and every ancestor
 * (their integrations must be redone).
 */
export function computeTaskInvalidationClosure(graph: TaskGraph, taskId: string): Set<string> {
  const seeds = [taskId];
  const stack = [...(graph.nodes[taskId]?.childrenIds ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    seeds.push(id);
    stack.push(...(graph.nodes[id]?.childrenIds ?? []));
  }
  return computeDownstreamClosure(graph, seeds);
}

/** BFS from the seeds through dependents (edges) and parents (integrations). */
function computeDownstreamClosure(graph: TaskGraph, seeds: string[]): Set<string> {
  const invalid = new Set<string>();
  const queue = [...seeds];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || invalid.has(id)) {
      continue;
    }
    invalid.add(id);

    for (const dependency of graph.dependencies) {
      if (dependency.fromTaskId === id && !invalid.has(dependency.toTaskId)) {
        queue.push(dependency.toTaskId);
      }
    }
    const parentId = graph.nodes[id]?.parentId;
    if (parentId !== null && parentId !== undefined && !invalid.has(parentId)) {
      queue.push(parentId);
    }
  }
  return invalid;
}

/**
 * Seam Amendments Engine.
 *
 * Given a modified seam, identifies downstream and composite nodes consuming
 * this seam (or dependent on the producer), marks them as stale/obsolete,
 * cleans their git worktrees and branches, and returns the filtered results
 * so they are re-scheduled for execution.
 */
export class AmendmentsEngine {
  private readonly git: SimpleGitRunner;

  constructor() {
    this.git = new SimpleGitRunner();
  }

  async amendSeam(params: AmendSeamParams): Promise<InvalidationResult> {
    const { repoRoot, runId, graph, seamId, leafResults, integrationResults } = params;

    // Find the node that produces this seam
    let producerTaskId: string | null = null;
    for (const node of Object.values(graph.nodes)) {
      const produced = node.contract?.producedInterfaces ?? [];
      if (produced.some((i) => i.id === seamId)) {
        producerTaskId = node.id;
        break;
      }
    }

    if (producerTaskId === null) {
      // If no producer was declared, we can't trace dependencies, return original
      return { leafResults, integrationResults, invalidatedTaskIds: new Set() };
    }

    // Downstream of the producer: dependents + ancestor integrations.
    const invalidatedTaskIds = computeDownstreamClosure(graph, [producerTaskId]);
    return this.invalidate({ repoRoot, runId, graph, leafResults, integrationResults }, invalidatedTaskIds);
  }

  /**
   * Invalidate a whole subtree ahead of selective re-decomposition: cleans the
   * worktrees/branches of the closure and returns the surviving results so the
   * execution frontier re-enters with only the untouched work pre-seeded.
   */
  async invalidateTask(params: InvalidateTaskParams): Promise<InvalidationResult> {
    const { repoRoot, runId, graph, taskId, leafResults, integrationResults } = params;
    const invalidatedTaskIds = computeTaskInvalidationClosure(graph, taskId);
    return this.invalidate({ repoRoot, runId, graph, leafResults, integrationResults }, invalidatedTaskIds);
  }

  private async invalidate(
    params: {
      repoRoot: string;
      runId: string;
      graph: TaskGraph;
      leafResults: AgentExecutionResult[];
      integrationResults: IntegrationResult[];
    },
    invalidatedTaskIds: Set<string>
  ): Promise<InvalidationResult> {
    const { repoRoot, runId, graph, leafResults, integrationResults } = params;

    // Clean worktrees for invalidated tasks (best-effort: already-cleaned or
    // never-created worktrees are not errors).
    const worktreeManager = new WorktreeManager({ git: this.git, repoRoot });
    for (const taskId of invalidatedTaskIds) {
      const worktreePath = worktreePathFor({
        worktreesRoot: join(repoRoot, ".manyhands", "worktrees"),
        runId,
        taskId
      });
      const branch = worktreeBranchFor({ runId, taskId });
      await worktreeManager
        .clean({
          taskId,
          runId,
          kind: graph.nodes[taskId]?.kind === "leaf" ? "leaf" : "integration",
          path: worktreePath,
          branch,
          baseCommit: graph.baseCommit,
          status: "active",
          createdAt: new Date().toISOString()
        })
        .catch(() => undefined);
    }

    return {
      leafResults: leafResults.filter((r) => !invalidatedTaskIds.has(r.taskId)),
      integrationResults: integrationResults.filter((r) => !invalidatedTaskIds.has(r.compositeTaskId)),
      invalidatedTaskIds
    };
  }
}
