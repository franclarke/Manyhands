import type { RunSnapshot } from "@manyhands/core";
import type { GranularityVector } from "@manyhands/execution-core";

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
  /** Integration metrics (integration/conflict rates) need the execution core. */
  integrationPending: boolean;
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

export function buildRunSummary(snapshot: RunSnapshot): RunSummary {
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
