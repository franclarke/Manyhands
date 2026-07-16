import { join } from "node:path";
import { stat } from "node:fs/promises";
import { SimpleGitRunner, type GitRunner } from "../git/runner.js";
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

/** Pure seam invalidation used to prepare a durable amendment before Git IO. */
export function computeSeamInvalidationClosure(graph: TaskGraph, seamId: string): Set<string> {
  const producer = Object.values(graph.nodes).find((node) =>
    (node.contract?.producedInterfaces ?? []).some((iface) => iface.id === seamId)
  );
  return producer === undefined ? new Set<string>() : computeDownstreamClosure(graph, [producer.id]);
}

export function filterInvalidatedResults(
  leafResults: AgentExecutionResult[],
  integrationResults: IntegrationResult[],
  invalidatedTaskIds: ReadonlySet<string>
): Pick<InvalidationResult, "leafResults" | "integrationResults"> {
  return {
    leafResults: leafResults.filter((result) => !invalidatedTaskIds.has(result.taskId)),
    integrationResults: integrationResults.filter(
      (result) => !invalidatedTaskIds.has(result.compositeTaskId)
    )
  };
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
  private readonly git: GitRunner;

  constructor(git: GitRunner = new SimpleGitRunner()) {
    this.git = git;
  }

  async amendSeam(params: AmendSeamParams): Promise<InvalidationResult> {
    const { repoRoot, runId, graph, seamId, leafResults, integrationResults } = params;
    const invalidatedTaskIds = computeSeamInvalidationClosure(graph, seamId);
    return this.invalidate({ repoRoot, runId, graph, leafResults, integrationResults }, invalidatedTaskIds);
  }

  /**
   * Perform only the physical cleanup for an already-durable invalidation.
   * Recovery can safely repeat this operation; missing worktrees/branches are
   * intentionally treated as already cleaned.
   */
  async cleanInvalidatedTasks(params: {
    repoRoot: string;
    runId: string;
    graph: TaskGraph;
    invalidatedTaskIds: ReadonlySet<string>;
  }): Promise<void> {
    await this.clean(params, params.invalidatedTaskIds);
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

    await this.clean(params, invalidatedTaskIds);

    return {
      ...filterInvalidatedResults(leafResults, integrationResults, invalidatedTaskIds),
      invalidatedTaskIds
    };
  }

  private async clean(
    params: { repoRoot: string; runId: string; graph: TaskGraph },
    invalidatedTaskIds: ReadonlySet<string>
  ): Promise<void> {
    const { repoRoot, runId, graph } = params;
    // A repeat after a crash may find the worktree and branch already gone.
    // That exact state is idempotent; every other Git failure must propagate so
    // the durable journal cannot claim `worktrees_cleaned` over leftovers.
    const worktreeManager = new WorktreeManager({ git: this.git, repoRoot });
    for (const taskId of invalidatedTaskIds) {
      const worktreePath = worktreePathFor({
        worktreesRoot: join(repoRoot, ".manyhands", "worktrees"),
        runId,
        taskId
      });
      const branch = worktreeBranchFor({ runId, taskId });
      try {
        await worktreeManager.clean({
          taskId,
          runId,
          kind: graph.nodes[taskId]?.kind === "leaf" ? "leaf" : "integration",
          path: worktreePath,
          branch,
          baseCommit: graph.baseCommit,
          status: "active",
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        await this.git.worktreePrune(repoRoot);
        if (await pathExists(worktreePath)) throw error;

        // `WorktreeManager.clean` stops at a missing worktree, so explicitly
        // finish an orphan branch. A missing branch is success only when the
        // repository itself remains readable.
        try {
          await this.git.branchDelete({ repoRoot, branch, force: true });
        } catch (branchError) {
          if (await this.branchExists(repoRoot, branch)) throw branchError;
        }
      }
    }
  }

  private async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    try {
      await this.git.revParse(repoRoot, `refs/heads/${branch}`);
      return true;
    } catch {
      // Distinguish an absent ref from an inaccessible/corrupt repository.
      await this.git.revParse(repoRoot, "HEAD");
      return false;
    }
  }
}

async function pathExists(value: string): Promise<boolean> {
  try {
    await stat(value);
    return true;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
