import { join } from "node:path";
import { SimpleGitRunner } from "../git/runner.js";
import { WorktreeManager } from "../worktree/manager.js";
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

export interface InvalidationResult {
  leafResults: AgentExecutionResult[];
  integrationResults: IntegrationResult[];
  invalidatedTaskIds: Set<string>;
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

    // Compute downstream invalidated tasks
    const invalidatedTaskIds = this.computeInvalidatedTasks(graph, producerTaskId);

    // Clean worktrees for invalidated tasks
    const worktreeManager = new WorktreeManager({ git: this.git, repoRoot });
    for (const taskId of invalidatedTaskIds) {
      // Skip the producer itself if it was already successfully executed and we don't want to reset it,
      // but wait: if the seam is amended, it means the producer's output contract changed, so the producer
      // itself might need to be re-run, or it already completed.
      // Usually, if a seam is amended, it's either because the producer failed/changed, or the user requested.
      // So we clean all invalidated worktrees.
      const worktreePath = join(repoRoot, ".manyhands", "worktrees", runId, taskId);
      const branch = `mh/${runId}/${taskId}`;
      await worktreeManager.clean({
        taskId,
        runId,
        kind: graph.nodes[taskId]?.kind === "leaf" ? "leaf" : "integration",
        path: worktreePath,
        branch,
        baseCommit: graph.baseCommit,
        status: "active",
        createdAt: new Date().toISOString()
      }).catch(() => undefined); // Ignore if already cleaned or doesn't exist
    }

    // Filter out invalidated tasks from results
    const filteredLeaves = leafResults.filter((r) => !invalidatedTaskIds.has(r.taskId));
    const filteredIntegrations = integrationResults.filter((r) => !invalidatedTaskIds.has(r.compositeTaskId));

    return {
      leafResults: filteredLeaves,
      integrationResults: filteredIntegrations,
      invalidatedTaskIds
    };
  }

  private computeInvalidatedTasks(graph: TaskGraph, taskId: string): Set<string> {
    const invalid = new Set<string>();
    const queue = [taskId];
    while (queue.length > 0) {
      const id = queue.pop()!;
      if (invalid.has(id)) {
        continue;
      }
      // Don't include the producer itself if it's the one we started with, unless it has a consumer dependency,
      // but wait: standard computeInvalidatedTasks includes the starting taskId.
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
}
