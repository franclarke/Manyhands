/**
 * Execution nodes for the ManyHands LangGraph orchestrator.
 *
 * These nodes handle the execution phase:
 *   - scheduleBatchesNode: topological sort → batch list
 *   - executeLeafNode: runs Gemini CLI in isolated worktree (D4, D5, D6)
 *   - integrateCompositeNode: cherry-pick bottom-up + Composer repair (D8)
 *   - runValidationNode: final run-level validation
 *
 * Design: docs/design/langgraph-orchestrator-design.md §4
 * Invariants: D4 (Gemini CLI only), D5 (git diff HEAD), D6 (orchestrator commits)
 */
import { interrupt, Send } from "@langchain/langgraph";
import type { RunState, RunStateUpdate } from "../state.js";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";

// ─── scheduleBatchesNode ───────────────────────────────────────────────────

export interface ScheduleBatchesNodeDeps {
  scheduleTasks: (params: {
    graph: NonNullable<RunState["graph"]>;
    maxParallel?: number;
  }) => Array<{ taskIds: string[] }>;
}

/**
 * Converts the task graph into an ordered list of batches for parallel execution.
 * Each batch contains task IDs that can run concurrently.
 */
export function makeScheduleBatchesNode(deps: ScheduleBatchesNodeDeps) {
  return function scheduleBatchesNode(state: RunState): RunStateUpdate {
    if (state.graph === null) {
      throw new Error("scheduleBatchesNode: graph is null");
    }

    const batchPlan = deps.scheduleTasks({ graph: state.graph });
    const batches = batchPlan.map((batch) => batch.taskIds);

    return {
      batches,
      currentBatchIndex: 0,
      status: "running"
    };
  };
}

// ─── executeBatchNode ──────────────────────────────────────────────────────

/**
 * Dispatches the current batch of tasks in parallel using LangGraph's Send pattern.
 * Each task runs as an independent `executeLeafNode` invocation.
 *
 * This is the entry point for map-reduce parallel execution (D9: maxParallel=6).
 */
export function executeBatchNode(state: RunState): Send[] | RunStateUpdate {
  const { batches, currentBatchIndex } = state;
  const batch = batches[currentBatchIndex];

  if (batch === undefined || batch.length === 0) {
    // No more batches — done with leaf execution
    return { currentBatchIndex: currentBatchIndex + 1 };
  }

  // Dispatch each task in the batch as a parallel Send
  return batch.map((taskId) =>
    new Send("executeLeafNode", {
      runId: state.runId,
      taskId,
      graph: state.graph,
      repoPath: state.repoPath
    })
  );
}

// ─── executeLeafNode ───────────────────────────────────────────────────────

export interface LeafExecutionInput {
  runId: string;
  taskId: string;
  graph: NonNullable<RunState["graph"]>;
  repoPath: string;
}

export interface ExecuteLeafNodeDeps {
  /**
   * Execute a single leaf task using Gemini CLI in an isolated worktree.
   * Worktree must be named `mh-{runId}-{taskId}` (D6: orchestrator commits).
   */
  executeLeaf: (params: LeafExecutionInput) => Promise<{
    result: AgentExecutionResult;
    validationPassed: boolean;
    validationOutput?: string;
  }>;

  /**
   * Attempt auto-repair using Gemini CLI on validation failure.
   * Returns null if repair was not attempted or failed.
   */
  repairLeaf: (params: LeafExecutionInput & { validationOutput: string }) => Promise<{
    result: AgentExecutionResult;
    validationPassed: boolean;
  } | null>;
}

/**
 * Runs a single leaf task. If validation fails, attempts 1 auto-repair.
 * If repair also fails, interrupts for human direction (D3).
 * Invariants: D4 (Gemini CLI), D5 (git diff HEAD), D6 (orchestrator commits).
 */
export function makeExecuteLeafNode(deps: ExecuteLeafNodeDeps) {
  return async function executeLeafNode(input: LeafExecutionInput): Promise<RunStateUpdate> {
    const { runId, taskId, graph, repoPath } = input;

    // Execute the leaf task
    const execution = await deps.executeLeaf({ runId, taskId, graph, repoPath });

    if (execution.validationPassed) {
      return {
        leafResults: [execution.result]
      };
    }

    // Validation failed — attempt up to 3 auto-repair iterations
    const maxRepairAttempts = 3;
    let repairCount = 0;
    let lastResult = execution.result;
    let lastValidationOutput = execution.validationOutput ?? "";
    let lastRepairResult = null;

    while (repairCount < maxRepairAttempts) {
      repairCount++;
      const repairResult = await deps.repairLeaf({
        runId,
        taskId,
        graph,
        repoPath,
        validationOutput: lastValidationOutput
      });

      if (repairResult !== null) {
        lastRepairResult = repairResult;
        lastResult = repairResult.result;
        lastValidationOutput = repairResult.result.validationResult?.output ?? "";
        if (repairResult.validationPassed) {
          // Auto-repair succeeded
          return {
            leafResults: [repairResult.result]
          };
        }
      } else {
        // No further repair attempted
        break;
      }
    }

    // Auto-repair failed or not attempted — interrupt for human direction
    interrupt({
      type: "leaf_validation_failed",
      runId,
      taskId,
      validationOutput: lastValidationOutput,
      autoRepairAttempted: repairCount > 0 && lastRepairResult !== null,
      autoRepairResult: lastResult
    });

    // After resume: accept the failing result or a user-provided fix
    return {
      leafResults: [lastResult]
    };
  };
}

// ─── integrateCompositeNode ────────────────────────────────────────────────

export interface IntegrateCompositeNodeDeps {
  /**
   * Integrate children bottom-up using git cherry-pick.
   * If conflict: attempts 1 Composer repair (D8).
   */
  integrateComposite: (params: {
    compositeTaskId: string;
    runId: string;
    graph: NonNullable<RunState["graph"]>;
    repoPath: string;
    childResults: AgentExecutionResult[];
  }) => Promise<IntegrationResult & { conflictDetails?: { files: string[]; diff: string } }>;
}

/**
 * Fuses children's git branches bottom-up via cherry-pick.
 * Attempts 1 Composer semantic repair on conflict (D8).
 * If repair fails, interrupts for user conflict resolution.
 */
export function makeIntegrateCompositeNode(deps: IntegrateCompositeNodeDeps) {
  return async function integrateCompositeNode(state: RunState): Promise<RunStateUpdate> {
    if (state.graph === null) {
      throw new Error("integrateCompositeNode: graph is null");
    }

    const { runId, repoPath, leafResults, integrationResults } = state;
    const graph = state.graph;

    // Find composites that need integration, bottom-up (deepest first)
    const composites = Object.values(graph.nodes)
      .filter((node) => node.kind !== "leaf" && node.childrenIds.length > 0)
      .sort((a, b) => b.depth - a.depth);

    const newIntegrationResults: IntegrationResult[] = [];
    const resultByTask = new Map<string, AgentExecutionResult>(
      leafResults.map((r) => [r.taskId, r])
    );

    // Also include previous integration results as synthetic leaf results for parent composites
    for (const ir of integrationResults) {
      if (ir.integrationCommitSha !== undefined) {
        resultByTask.set(ir.compositeTaskId, {
          taskId: ir.compositeTaskId,
          status: "success",
          baseHead: ir.integrationCommitSha,
          currentHead: ir.integrationCommitSha,
          agentCommittedUnexpectedly: false,
          diff: "",
          changedFiles: [],
          commitSha: ir.integrationCommitSha,
          scopeCheck: { passed: true, violations: [], outOfScope: [] },
          executorExitCode: 0,
          executorDurationMs: 0,
          executorTimedOut: false,
          stderrTail: "",
          stdoutTail: ""
        } satisfies AgentExecutionResult);
      }
    }

    for (const composite of composites) {
      // Skip if already integrated
      if (integrationResults.some((ir) => ir.compositeTaskId === composite.id)) {
        continue;
      }

      const childResults = composite.childrenIds
        .map((childId) => resultByTask.get(childId))
        .filter((r): r is AgentExecutionResult => r !== undefined);

      if (childResults.length !== composite.childrenIds.length) {
        // Missing child results — skip this composite for now
        continue;
      }

      const result = await deps.integrateComposite({
        compositeTaskId: composite.id,
        runId,
        graph,
        repoPath,
        childResults
      });

      newIntegrationResults.push(result);

      const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);
      if (!INTEGRATION_SUCCESS.has(result.status)) {
        // Integration failed even after auto-repair — interrupt for human
        interrupt({
          type: "merge_conflict",
          compositeTaskId: composite.id,
          status: result.status,
          conflictDetails: result.conflictDetails
        });
      }

      if (result.integrationCommitSha !== undefined) {
        resultByTask.set(composite.id, {
          taskId: composite.id,
          status: "success",
          baseHead: result.integrationCommitSha,
          currentHead: result.integrationCommitSha,
          agentCommittedUnexpectedly: false,
          diff: "",
          changedFiles: [],
          commitSha: result.integrationCommitSha,
          scopeCheck: { passed: true, violations: [], outOfScope: [] },
          executorExitCode: 0,
          executorDurationMs: 0,
          executorTimedOut: false,
          stderrTail: "",
          stdoutTail: ""
        } satisfies AgentExecutionResult);
      }
    }

    return {
      integrationResults: newIntegrationResults
    };
  };
}

// ─── runValidationNode ─────────────────────────────────────────────────────

export interface RunValidationNodeDeps {
  validateRun: (params: {
    runId: string;
    graph: NonNullable<RunState["graph"]>;
    repoPath: string;
    integrationResults: IntegrationResult[];
  }) => Promise<{ passed: boolean; output?: string }>;
}

/**
 * Runs final run-level validation after all integration is complete.
 */
export function makeRunValidationNode(deps: RunValidationNodeDeps) {
  return async function runValidationNode(state: RunState): Promise<RunStateUpdate> {
    if (state.graph === null) {
      throw new Error("runValidationNode: graph is null");
    }

    const validation = await deps.validateRun({
      runId: state.runId,
      graph: state.graph,
      repoPath: state.repoPath,
      integrationResults: state.integrationResults
    });

    return {
      status: validation.passed ? "completed" : "failed",
      ...(validation.passed ? {} : { errorMessage: validation.output ?? "Run validation failed" })
    };
  };
}
