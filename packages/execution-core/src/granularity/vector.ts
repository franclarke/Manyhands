import type { TaskGraph } from "@manyhands/task-graph";

import {
  GranularityVectorSchema,
  type AgentExecutionResult,
  type GranularityVector,
  type IntegrationResult
} from "../types";

export interface ComputeGranularityVectorParams {
  graph: TaskGraph;
  leafResults: AgentExecutionResult[];
  integrationResults?: IntegrationResult[];
  /** Run-level wall-clock duration. */
  totalDurationMs: number;
  /** Optional pass-through from validation aggregation (0-1). */
  testsPassedRate?: number;
  /** Optional pre-execution heuristic. */
  estimatedTokensPerLeaf?: number;
}

const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);

/**
 * Computes the experiment's GranularityVector: pre-execution DAG-structure
 * metrics plus post-execution outcome rates. Pure — derives everything from the
 * graph and the collected execution/integration results so it can be unit
 * tested without running anything.
 */
export function computeGranularityVector(
  params: ComputeGranularityVectorParams
): GranularityVector {
  const nodes = Object.values(params.graph.nodes);
  const leaves = nodes.filter((node) => node.kind === "leaf");
  const composites = nodes.filter((node) => node.kind !== "leaf");
  const integrations = params.integrationResults ?? [];

  const leafDepths = leaves.map((leaf) => leaf.depth);
  const depth = nodes.reduce((max, node) => Math.max(max, node.depth), 0);

  const leafSuccess = params.leafResults.filter((result) => result.status === "success").length;
  const integrationSuccess = integrations.filter((result) =>
    INTEGRATION_SUCCESS.has(result.status)
  ).length;

  const repairResults = integrations
    .map((result) => result.repairResult)
    .filter((result): result is AgentExecutionResult => result !== undefined);
  const allResults = [...params.leafResults, ...repairResults];

  const linesChanged = allResults.reduce((sum, result) => sum + countDiffLines(result.diff), 0);
  const totalCostUsd = sumOptional(allResults.map((result) => result.costUsd));

  const conflictingIntegrations = integrations.filter(
    (result) => result.repairAttempted || result.conflictDetails !== undefined
  ).length;
  const leafPairs = (leaves.length * (leaves.length - 1)) / 2;

  const vector: Record<string, unknown> = {
    depth,
    leafCount: leaves.length,
    compositeCount: composites.length,
    avgLeafDepth: mean(leafDepths),
    maxLeafDepth: leafDepths.reduce((max, value) => Math.max(max, value), 0),
    dependencyCount: params.graph.dependencies.length,
    avgAcceptanceCriteriaPerLeaf: mean(
      leaves.map((leaf) => leaf.acceptanceCriteria?.length ?? 0)
    ),

    integrationSuccessRate: rate(integrationSuccess, integrations.length),
    leafSuccessRate: rate(leafSuccess, params.leafResults.length),
    conflictRate: leafPairs === 0 ? 0 : Math.min(1, conflictingIntegrations / leafPairs),
    totalDurationMs: params.totalDurationMs,
    linesChanged,
    unexpectedCommitCount: params.leafResults.filter((r) => r.agentCommittedUnexpectedly).length,
    scopeViolationCount: allResults.filter((r) => r.status === "scope_violation").length
  };

  if (params.estimatedTokensPerLeaf !== undefined) {
    vector.estimatedTokensPerLeaf = params.estimatedTokensPerLeaf;
  }
  if (totalCostUsd !== undefined) {
    vector.totalCostUsd = totalCostUsd;
  }
  if (params.testsPassedRate !== undefined) {
    vector.testsPassedRate = params.testsPassedRate;
  }

  return GranularityVectorSchema.parse(vector);
}

/** Empty set is vacuously successful: a run with nothing to do has no failures. */
function rate(passed: number, total: number): number {
  return total === 0 ? 1 : passed / total;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sumOptional(values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length === 0) {
    return undefined;
  }
  return present.reduce((sum, value) => sum + value, 0);
}

/** Counts added/removed content lines in a unified diff, ignoring file headers. */
function countDiffLines(diff: string): number {
  let count = 0;
  for (const line of diff.split("\n")) {
    if ((line.startsWith("+") || line.startsWith("-")) && !isHeaderLine(line)) {
      count += 1;
    }
  }
  return count;
}

function isHeaderLine(line: string): boolean {
  return line.startsWith("+++") || line.startsWith("---");
}
