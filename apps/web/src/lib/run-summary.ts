import type { RunSnapshot } from "@manyhands/core";
import type { GranularityVector, RunExecutionResult } from "@manyhands/execution-core";

/**
 * Run Summary (done phase). Two halves, kept honest:
 *
 * - `pre`  : pure structure of the DAG — always computable now. Tied to the real
 *            `GranularityVector` schema (a `Pick` of its pre-execution fields) so
 *            it slots straight into the experiment metrics once those land.
 * - `post` : execution outcomes. Computed from `agentRunResults` when present
 *            (mock/Lab today). Integration-level metrics need `IntegrationResult`
 *            from the execution core (Etapa 1) → `integrationPending` until then.
 *
 * No invented data: anything we cannot derive is left `undefined` and surfaced as
 * an explicit pending state in the UI.
 */
export type RunSummaryPre = Pick<
  GranularityVector,
  | "depth"
  | "leafCount"
  | "compositeCount"
  | "avgLeafDepth"
  | "maxLeafDepth"
  | "dependencyCount"
  | "avgAcceptanceCriteriaPerLeaf"
>;

export interface RunSummaryPost {
  /** True when at least one agent run result exists (mock/Lab today). */
  executed: boolean;
  leafSuccessRate?: number;
  testsPassedRate?: number;
  totalDurationMs?: number;
  totalCostUsd?: number;
  changedFilesCount?: number;
  scopeViolationCount?: number;
  /** True until the execution core produces IntegrationResults (Lab/mock runs). */
  integrationPending: boolean;
  /** Integration success rate (0-1), present once the execution core ran. */
  integrationSuccessRate?: number;
  /** Conflict rate (0-1) across integrated leaf pairs, from the execution core. */
  conflictRate?: number;
}

export interface RunSummary {
  pre: RunSummaryPre;
  post: RunSummaryPost;
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds the run summary. When `execution` (a real-engine RunExecutionResult)
 * is provided it is the source of truth — including integration metrics, so
 * `integrationPending` is cleared. Without it, the summary falls back to the
 * Lab-mode snapshot (`agentRunResults`), with integration left pending.
 */
export function buildRunSummary(snapshot: RunSnapshot, execution?: RunExecutionResult): RunSummary {
  const nodes = Object.values(snapshot.graphSnapshot.nodes);
  const leaves = nodes.filter((node) => node.kind === "leaf");
  const leafDepths = leaves.map((leaf) => leaf.depth);
  const contractByTaskId = new Map(snapshot.contracts.map((contract) => [contract.taskId, contract]));

  const acceptanceCounts = leaves.map((leaf) => {
    const contract = contractByTaskId.get(leaf.id) ?? leaf.contract;
    return contract?.acceptance.length ?? 0;
  });

  const pre: RunSummaryPre = {
    depth: nodes.reduce((max, node) => Math.max(max, node.depth), 0),
    leafCount: leaves.length,
    compositeCount: nodes.length - leaves.length,
    avgLeafDepth: mean(leafDepths),
    maxLeafDepth: leafDepths.reduce((max, depth) => Math.max(max, depth), 0),
    dependencyCount: snapshot.graphSnapshot.dependencies.length,
    avgAcceptanceCriteriaPerLeaf: mean(acceptanceCounts)
  };

  // Real execution core result wins: it carries integration metrics too.
  if (execution !== undefined) {
    return { pre: preFromVector(execution.granularityVector), post: postFromExecution(execution) };
  }

  const results = snapshot.agentRunResults;
  const executed = results.length > 0;

  const post: RunSummaryPost = {
    executed,
    integrationPending: true
  };

  if (executed) {
    const successes = results.filter((result) => result.success).length;
    const validated = results.filter((result) => result.validation.passed).length;
    post.leafSuccessRate = successes / results.length;
    post.testsPassedRate = validated / results.length;
    post.totalDurationMs = results.reduce((sum, result) => sum + result.metrics.durationMs, 0);
    post.totalCostUsd = results.reduce((sum, result) => sum + result.metrics.costUsd, 0);
    post.changedFilesCount = results.reduce((sum, result) => sum + result.changedFiles.length, 0);
    post.scopeViolationCount = results.reduce((sum, result) => sum + result.scopeViolations.length, 0);
  }

  return { pre, post };
}

function preFromVector(vector: GranularityVector): RunSummaryPre {
  return {
    depth: vector.depth,
    leafCount: vector.leafCount,
    compositeCount: vector.compositeCount,
    avgLeafDepth: vector.avgLeafDepth,
    maxLeafDepth: vector.maxLeafDepth,
    dependencyCount: vector.dependencyCount,
    avgAcceptanceCriteriaPerLeaf: vector.avgAcceptanceCriteriaPerLeaf
  };
}

function postFromExecution(execution: RunExecutionResult): RunSummaryPost {
  const vector = execution.granularityVector;
  const post: RunSummaryPost = {
    executed: execution.leafResults.length > 0,
    leafSuccessRate: vector.leafSuccessRate,
    totalDurationMs: vector.totalDurationMs,
    changedFilesCount: execution.leafResults.reduce((sum, leaf) => sum + leaf.changedFiles.length, 0),
    scopeViolationCount: vector.scopeViolationCount,
    integrationPending: false,
    integrationSuccessRate: vector.integrationSuccessRate,
    conflictRate: vector.conflictRate
  };
  if (vector.testsPassedRate !== undefined) post.testsPassedRate = vector.testsPassedRate;
  if (vector.totalCostUsd !== undefined) post.totalCostUsd = vector.totalCostUsd;
  return post;
}
