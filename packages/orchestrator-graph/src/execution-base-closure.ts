import type { GraphRevision } from "@manyhands/task-graph";

export interface ExecutionBaseArtifactRef {
  producerNodeId: string;
  artifactContract: { id: string; revision: number };
}

/**
 * Which artifacts a node has to lay down before it can start, in the order they
 * must be applied.
 *
 * An artifact is a change set against one exact tree: its manifest names the
 * `baseTreeSha` it was computed on, and materializing it onto a different tree
 * is refused. So a node cannot apply only the artifacts it directly consumes —
 * it needs everything those were built on top of, applied underneath them.
 *
 * The rehearsal run of 2026-08-16 is the case. `unit:sentence-length` consumed
 * `unit:top-words`, which had itself been built on top of `unit:word-total`.
 * Only the direct input was materialized, so the worktree tree was the run base
 * while the manifest expected base-plus-word-total, and the attempt failed with
 * `artifact_error`. Nothing was wrong with either artifact.
 *
 * Two leaves under one root never showed this: the single producer's base was
 * the run base. It appears the moment a graph is three deep, which is every
 * graph worth showing.
 */
export function executionBaseArtifacts(
  graph: GraphRevision,
  nodeId: string
): ExecutionBaseArtifactRef[] {
  // Depth-first from the consumer, so a producer is emitted only after
  // everything it was itself built on. `visiting` keeps this terminating even
  // though the graph validator already rejects artifact cycles.
  const order: string[] = [];
  const done = new Set<string>();
  const visiting = new Set<string>();

  const visit = (current: string): void => {
    if (done.has(current) || visiting.has(current)) return;
    visiting.add(current);
    for (const requirement of graph.artifactRequirements) {
      if (requirement.consumerNodeId === current) visit(requirement.producerNodeId);
    }
    visiting.delete(current);
    done.add(current);
    if (current !== nodeId) order.push(current);
  };
  visit(nodeId);

  const reachable = new Set([...order, nodeId]);
  const artifacts: ExecutionBaseArtifactRef[] = [];
  for (const producerNodeId of order) {
    for (const requirement of graph.artifactRequirements) {
      if (requirement.producerNodeId !== producerNodeId) continue;
      // An artifact whose only consumer is outside this node's base is not part
      // of it — a sibling's input does not belong under this node's tree.
      if (!reachable.has(requirement.consumerNodeId)) continue;
      const contract = { id: requirement.artifactContract.id, revision: requirement.artifactContract.revision };
      if (artifacts.some((entry) => entry.artifactContract.id === contract.id && entry.artifactContract.revision === contract.revision)) continue;
      artifacts.push({ producerNodeId, artifactContract: contract });
    }
  }
  return artifacts;
}
