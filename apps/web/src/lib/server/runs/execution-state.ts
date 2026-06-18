/**
 * Pure helpers over the persisted execution artifacts of a RunRecord.
 *
 * Single home for logic previously duplicated between the runner and the
 * decisions route: resolving the planned TaskGraph, reading leaf/integration
 * results, merging node results, readiness checks for the manual node
 * workflow, and downstream invalidation closures.
 */
import {
  computeGranularityVector,
  type AgentExecutionResult,
  type IntegrationResult,
  type RunExecutionResult,
  type RunNodeExecutionResult
} from "@manyhands/execution-core";
import { validationCommandSafetyIssues, type ExecutionValidationCommand, type MockPlanningFlowResult } from "@manyhands/core";
import { validateExecutableTaskGraph, type TaskGraph, type TaskValidationIssue } from "@manyhands/task-graph";
import type { DetectedCommands } from "../providers/command-detection";
import { RunValidationError } from "./errors";
import type { ProvisionedRepo } from "./repo-provisioner";
import type { RunRecord, RunValidationSummary } from "./schema";

export const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);

export interface ExecutionResults {
  leafResults: AgentExecutionResult[];
  integrationResults: IntegrationResult[];
}

/** Resolve the TaskGraph to execute from the persisted planning artifact. */
export function resolveExecutionGraph(run: RunRecord): TaskGraph {
  if (run.planning !== undefined && run.planning !== null) {
    return (run.planning as MockPlanningFlowResult).decomposition.graph;
  }
  throw new Error("Cannot execute a run without a generated plan. Run planning first.");
}

export function assertExecutableRunGraph(graph: TaskGraph): void {
  const errors = validateExecutableTaskGraph(graph).filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    throw new RunValidationError(
      `Executable graph is invalid: ${errors.slice(0, 5).map(formatValidationIssue).join("; ")}`
    );
  }
}

function formatValidationIssue(issue: TaskValidationIssue): string {
  return issue.taskId !== undefined
    ? `${issue.code} (${issue.taskId}): ${issue.message}`
    : `${issue.code}: ${issue.message}`;
}

export function provisionedFromRecord(record: RunRecord["provisioned"]): ProvisionedRepo | undefined {
  if (record === undefined) {
    return undefined;
  }
  return {
    repoRoot: record.repoRoot,
    baseBranch: record.baseBranch,
    baseCommit: record.baseCommit,
    cleanup: async () => undefined
  };
}

export function executionResultsFromRun(run: RunRecord): ExecutionResults {
  const execution = run.execution as Partial<RunExecutionResult> | undefined;
  return {
    leafResults: Array.isArray(execution?.leafResults) ? [...execution.leafResults] : [],
    integrationResults: Array.isArray(execution?.integrationResults) ? [...execution.integrationResults] : []
  };
}

export function integrationDurationMs(result: IntegrationResult): number {
  return result.repairResult?.executorDurationMs ?? 0;
}

export function collectRunValidationCommands(graph: TaskGraph) {
  const root = graph.nodes[graph.rootId];
  return root?.contract?.runValidationCommands ?? [];
}

const RUN_VALIDATION_TIMEOUT_MS = 120_000;

function detectedValidationCommand(detected: DetectedCommands | undefined): string | undefined {
  if (detected === undefined) return undefined;
  return detected.test ?? detected.build ?? detected.typecheck ?? detected.lint;
}

function toExecutionValidationCommand(detectedCommand: string): ExecutionValidationCommand | undefined {
  const tokens = detectedCommand.trim().split(/\s+/);
  const [command, ...args] = tokens;
  if (command === undefined || command.length === 0) return undefined;
  if (validationCommandSafetyIssues(command, args).length > 0) return undefined;
  return { command, args, timeoutMs: RUN_VALIDATION_TIMEOUT_MS, cwd: "worktree" };
}

/**
 * Deterministically backfill the root's run-level validation command from the
 * detected workspace commands when the decomposer left it empty.
 */
export function backfillRunValidationCommands(
  graph: TaskGraph,
  detected: DetectedCommands | undefined
): { graph: TaskGraph; backfilled?: ExecutionValidationCommand } {
  const existing = collectRunValidationCommands(graph);
  if (existing.length > 0) return { graph };

  const detectedCommand = detectedValidationCommand(detected);
  if (detectedCommand === undefined) return { graph };

  const command = toExecutionValidationCommand(detectedCommand);
  if (command === undefined) return { graph };

  const next = structuredClone(graph);
  const root = next.nodes[next.rootId] as { contract?: Record<string, unknown> } | undefined;
  if (root === undefined) return { graph };
  root.contract = { ...(root.contract ?? {}), runValidationCommands: [command] };
  return { graph: next, backfilled: command };
}

/** Summarize run-level validation for honest terminal status reporting. */
export function deriveRunValidationSummary(
  graph: TaskGraph,
  outcomeStatus: string,
  validationResult: { passed: boolean } | undefined,
  at: string
): RunValidationSummary | undefined {
  const commands = collectRunValidationCommands(graph);
  const label =
    commands.length > 0 ? `${commands[0]!.command} ${(commands[0]!.args ?? []).join(" ")}`.trim() : undefined;

  if (outcomeStatus === "completed") {
    return label === undefined ? { status: "unverified" } : { status: "passed", command: label, ranAt: at };
  }
  if (validationResult?.passed === false && label !== undefined) {
    return { status: "failed", command: label, ranAt: at };
  }
  return undefined;
}

/** Rebuilds the persisted execution artifact from a (possibly reduced) result set. */
export function buildExecutionArtifact(
  runId: string,
  graph: TaskGraph,
  leafResults: AgentExecutionResult[],
  integrationResults: IntegrationResult[]
): RunExecutionResult | undefined {
  if (leafResults.length === 0 && integrationResults.length === 0) {
    return undefined;
  }
  const totalDurationMs =
    leafResults.reduce((sum, result) => sum + result.executorDurationMs, 0) +
    integrationResults.reduce((sum, result) => sum + integrationDurationMs(result), 0);
  const status =
    leafResults.every((result) => result.status === "success") &&
    integrationResults.every((result) => INTEGRATION_SUCCESS.has(result.status))
      ? "completed"
      : "failed";
  return {
    runId,
    status,
    leafResults,
    integrationResults,
    granularityVector: computeGranularityVector({ graph, leafResults, integrationResults, totalDurationMs }),
    totalDurationMs
  };
}

export function mergeNodeExecutionResult(input: {
  runId: string;
  graph: TaskGraph;
  existing: ExecutionResults;
  nodeResult: RunNodeExecutionResult;
}): RunExecutionResult {
  let leafResults = input.existing.leafResults;
  let integrationResults = input.existing.integrationResults;

  if (input.nodeResult.kind === "leaf") {
    const result = input.nodeResult.result;
    leafResults = [...input.existing.leafResults.filter((entry) => entry.taskId !== result.taskId), result];
  } else {
    const result = input.nodeResult.result;
    integrationResults = [
      ...input.existing.integrationResults.filter((entry) => entry.compositeTaskId !== result.compositeTaskId),
      result
    ];
  }

  return (
    buildExecutionArtifact(input.runId, input.graph, leafResults, integrationResults) ?? {
      runId: input.runId,
      status: "failed",
      leafResults,
      integrationResults,
      granularityVector: computeGranularityVector({
        graph: input.graph,
        leafResults,
        integrationResults,
        totalDurationMs: 0
      }),
      totalDurationMs: 0
    }
  );
}

/**
 * Set of tasks whose execution results become stale when `taskId` is reset: the
 * node itself, everything that transitively depends on it (dependency edges),
 * and every ancestor composite that integrated any of them. Re-running a node
 * must invalidate this whole closure so downstream results aren't left dangling.
 */
export function computeInvalidatedTasks(graph: TaskGraph, taskId: string): Set<string> {
  const invalid = new Set<string>();
  const queue = [taskId];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (invalid.has(id)) {
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

export type ManualReadiness =
  | { ready: true; childResults?: AgentExecutionResult[] }
  | { ready: false; reason: string };

export function manualReadinessForTask(
  graph: TaskGraph,
  taskId: string,
  existing: ExecutionResults
): ManualReadiness {
  const node = graph.nodes[taskId];
  if (node === undefined) {
    return { ready: false, reason: `Task "${taskId}" is not in the graph.` };
  }

  if (node.status === "blocked" || node.status === "running" || node.status === "validating") {
    return { ready: false, reason: `Task "${taskId}" is ${node.status} and cannot be executed manually.` };
  }

  if (!dependenciesAreImplemented(graph, taskId, existing)) {
    return { ready: false, reason: `Task "${taskId}" still has incomplete dependencies.` };
  }

  if (node.kind === "leaf") {
    const existingLeaf = existing.leafResults.find((result) => result.taskId === taskId);
    if (existingLeaf !== undefined) {
      return { ready: false, reason: `Leaf task "${taskId}" already has an execution result.` };
    }
    return { ready: true };
  }

  const existingIntegration = existing.integrationResults.find((result) => result.compositeTaskId === taskId);
  if (existingIntegration !== undefined) {
    return { ready: false, reason: `Composite task "${taskId}" already has an integration result.` };
  }

  if (node.childrenIds.length === 0) {
    return { ready: false, reason: `Composite task "${taskId}" has no children to integrate.` };
  }

  const childResults = node.childrenIds.map((childId) => implementedResultForTask(graph, childId, existing));
  const missing = node.childrenIds.filter((_, index) => childResults[index] === undefined);
  if (missing.length > 0) {
    return {
      ready: false,
      reason: `Composite task "${taskId}" cannot run until these children are implemented: ${missing.join(", ")}.`
    };
  }

  return {
    ready: true,
    childResults: childResults.filter((result): result is AgentExecutionResult => result !== undefined)
  };
}

function dependenciesAreImplemented(graph: TaskGraph, taskId: string, existing: ExecutionResults): boolean {
  const incoming = graph.dependencies.filter((dependency) => dependency.toTaskId === taskId);
  return incoming.every((dependency) => implementedResultForTask(graph, dependency.fromTaskId, existing) !== undefined);
}

function implementedResultForTask(
  graph: TaskGraph,
  taskId: string,
  existing: ExecutionResults
): AgentExecutionResult | undefined {
  const leaf = existing.leafResults.find((result) => result.taskId === taskId);
  if (leaf !== undefined) {
    return leaf.status === "success" && leaf.commitSha !== undefined ? leaf : undefined;
  }

  const integration = existing.integrationResults.find((result) => result.compositeTaskId === taskId);
  if (
    integration !== undefined &&
    INTEGRATION_SUCCESS.has(integration.status) &&
    integration.integrationCommitSha !== undefined
  ) {
    return syntheticManualCompositeResult(taskId, graph.baseCommit, integration.integrationCommitSha);
  }

  return undefined;
}

export function syntheticManualCompositeResult(
  taskId: string,
  baseHead: string,
  commitSha: string
): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead,
    currentHead: commitSha,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    commitSha,
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 0,
    executorTimedOut: false
  };
}
