import { DecomposerLlmError } from "./errors";
import type { DecomposerLlmOutput } from "./output-schema";

/**
 * Anti-runaway safety rail. Granularity is an aggressiveness control, not a
 * count target, so there is no per-level node cap — but a single LLM response
 * with thousands of nodes is a malformed output, not a valid plan. This bound
 * only catches that, it never shapes the tree.
 */
const MAX_NODES_SAFETY_RAIL = 200;

/**
 * Hard guards applied to an LLM output before normalization. They check
 * structural validity only (single root, valid parents, depth consistency,
 * acyclic dependencies, leaf acceptance) plus an anti-runaway node cap — never
 * a granularity-derived depth or count target, so branches may reach different
 * depths and the tree may be asymmetric. Any failure throws
 * `DecomposerLlmError(stage: "validate")` so the caller can transparently fall
 * back to the deterministic decomposer.
 */
export function runDecomposerGuards(output: DecomposerLlmOutput): void {
  if (output.nodes.length === 0) {
    throw new DecomposerLlmError("decomposition produced no nodes", undefined, "validate");
  }
  if (output.nodes.length > MAX_NODES_SAFETY_RAIL) {
    throw new DecomposerLlmError(
      `node count ${output.nodes.length} exceeds the safety rail of ${MAX_NODES_SAFETY_RAIL}`,
      undefined,
      "validate"
    );
  }

  // 1. IDs unique
  const idSet = new Set<string>();
  for (const node of output.nodes) {
    if (idSet.has(node.id)) {
      throw new DecomposerLlmError(`duplicate node id: ${node.id}`, undefined, "validate");
    }
    idSet.add(node.id);
  }

  // 2. Exactly one root
  const roots = output.nodes.filter((node) => node.parentId === null);
  if (roots.length === 0) {
    throw new DecomposerLlmError("no root node (parentId === null) found", undefined, "validate");
  }
  if (roots.length > 1) {
    throw new DecomposerLlmError(`expected exactly one root, found ${roots.length}`, undefined, "validate");
  }
  const root = roots[0]!;
  if (root.depth !== 0) {
    throw new DecomposerLlmError(`root node ${root.id} must have depth 0, got ${root.depth}`, undefined, "validate");
  }

  // 3. Every parentId references an existing node
  for (const node of output.nodes) {
    if (node.parentId !== null && !idSet.has(node.parentId)) {
      throw new DecomposerLlmError(
        `node ${node.id} references unknown parentId ${node.parentId}`,
        undefined,
        "validate"
      );
    }
  }

  // 4. parent-child depth consistency (structural: depth must equal parent + 1).
  //    There is intentionally no granularity depth cap — branches may reach any
  //    depth the task complexity warrants.
  const byId = new Map(output.nodes.map((node) => [node.id, node]));
  for (const node of output.nodes) {
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (parent && node.depth !== parent.depth + 1) {
        throw new DecomposerLlmError(
          `node ${node.id} depth ${node.depth} does not equal parent ${parent.id} depth + 1`,
          undefined,
          "validate"
        );
      }
    }
  }

  // 6. Leaf nodes have at least one acceptance criterion
  for (const node of output.nodes) {
    if (node.kind === "leaf" && node.acceptanceCriteria.length === 0) {
      throw new DecomposerLlmError(
        `leaf node ${node.id} must declare at least one acceptanceCriteria entry`,
        undefined,
        "validate"
      );
    }
  }

  // 7. Dependencies reference existing nodes and have no self-loops
  for (const dependency of output.dependencies) {
    if (!idSet.has(dependency.fromTaskId)) {
      throw new DecomposerLlmError(
        `dependency references unknown fromTaskId ${dependency.fromTaskId}`,
        undefined,
        "validate"
      );
    }
    if (!idSet.has(dependency.toTaskId)) {
      throw new DecomposerLlmError(
        `dependency references unknown toTaskId ${dependency.toTaskId}`,
        undefined,
        "validate"
      );
    }
    if (dependency.fromTaskId === dependency.toTaskId) {
      throw new DecomposerLlmError(
        `dependency self-loop on ${dependency.fromTaskId}`,
        undefined,
        "validate"
      );
    }
  }

  // 8. No dependency cycles (DFS on adjacency)
  const adjacency = new Map<string, string[]>();
  for (const dependency of output.dependencies) {
    const list = adjacency.get(dependency.fromTaskId) ?? [];
    list.push(dependency.toTaskId);
    adjacency.set(dependency.fromTaskId, list);
  }
  const colors = new Map<string, "white" | "gray" | "black">();
  for (const node of output.nodes) colors.set(node.id, "white");

  function dfs(nodeId: string): void {
    colors.set(nodeId, "gray");
    for (const neighbour of adjacency.get(nodeId) ?? []) {
      const colour = colors.get(neighbour);
      if (colour === "gray") {
        throw new DecomposerLlmError(
          `dependency cycle detected involving ${nodeId} → ${neighbour}`,
          undefined,
          "validate"
        );
      }
      if (colour === "white") dfs(neighbour);
    }
    colors.set(nodeId, "black");
  }

  for (const node of output.nodes) {
    if (colors.get(node.id) === "white") dfs(node.id);
  }
}
