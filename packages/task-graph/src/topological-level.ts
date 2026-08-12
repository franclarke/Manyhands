import type { LegacyGraphRevisionV2 } from "./graph-revision.js";

/**
 * The topological level of every node: its longest path from the start of the
 * run.
 *
 * A wave used to be a mechanism — a barrier the runtime synchronised on, which
 * made every node wait for the slowest member of its batch. Dispatch is now
 * continuous over the ready set, and the wave survives only as this: a derived,
 * presentational fact the flow layout bands by. Nothing in the runtime reads
 * it, and that is the entire difference.
 *
 * A node's predecessors are everything that must finish before it can start:
 *
 *  - the producers of the artifacts it consumes, and
 *  - its own children, because a composite integrates what its children
 *    produced and is only ready once they are adopted.
 *
 * Levels are the longest path rather than the shortest: a node becomes
 * available only once its slowest predecessor chain is done, so banding by the
 * shortest path would draw it as reachable earlier than it can ever be.
 */
export function computeLegacyGraphRevisionV2TopologicalLevels(graph: LegacyGraphRevisionV2): Record<string, number> {
  const nodeIds = Object.keys(graph.nodes);
  const predecessors = new Map<string, Set<string>>(nodeIds.map((id) => [id, new Set<string>()]));

  const addEdge = (from: string, to: string): void => {
    // An edge naming a node outside this revision is not this function's to
    // diagnose; the compiler's critics own that. Ignoring it keeps a
    // presentational computation from failing a run.
    if (from === to || !predecessors.has(to) || !predecessors.has(from)) return;
    predecessors.get(to)!.add(from);
  };

  for (const requirement of graph.artifactRequirements) {
    addEdge(requirement.producerNodeId, requirement.consumerNodeId);
  }
  for (const node of Object.values(graph.nodes)) {
    if (node.parentId !== null) addEdge(node.id, node.parentId);
  }

  const levels: Record<string, number> = {};
  const resolving = new Set<string>();

  const levelOf = (nodeId: string): number => {
    const known = levels[nodeId];
    if (known !== undefined) return known;
    if (resolving.has(nodeId)) {
      throw new Error(`Graph ${graph.graphId} has a dependency cycle through ${nodeId}; topological levels are undefined.`);
    }
    resolving.add(nodeId);
    let level = 0;
    for (const predecessor of predecessors.get(nodeId)!) {
      level = Math.max(level, levelOf(predecessor) + 1);
    }
    resolving.delete(nodeId);
    levels[nodeId] = level;
    return level;
  };

  for (const nodeId of nodeIds) levelOf(nodeId);
  return levels;
}
