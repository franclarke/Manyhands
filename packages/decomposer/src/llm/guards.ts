import { DecomposerLlmError } from "./errors";
import { GRANULARITY_PROFILES } from "./prompt-template";
import type { DecomposerLlmOutput } from "./output-schema";
import type { DecompositionMode } from "../index";

export interface GuardOptions {
  granularity: DecompositionMode;
  /** Relax the upper bound on node count by this factor (default 1.0). */
  upperFactor?: number;
}

/**
 * Hard guards applied to an LLM output before normalization. Any failure throws
 * `DecomposerLlmError(stage: "validate")` so the caller can transparently fall
 * back to the deterministic decomposer.
 */
export function runDecomposerGuards(output: DecomposerLlmOutput, options: GuardOptions): void {
  const profile = GRANULARITY_PROFILES[options.granularity];
  const upperFactor = options.upperFactor ?? 1.0;
  const maxNodes = Math.ceil(profile.maxNodes * upperFactor);

  if (output.nodes.length < Math.max(1, profile.minNodes - 1)) {
    throw new DecomposerLlmError(
      `node count ${output.nodes.length} is below the ${options.granularity} target ${profile.minNodes}`,
      undefined,
      "validate"
    );
  }
  if (output.nodes.length > maxNodes) {
    throw new DecomposerLlmError(
      `node count ${output.nodes.length} exceeds the ${options.granularity} cap ${maxNodes}`,
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

  // 4. Depth respects the granularity cap
  for (const node of output.nodes) {
    if (node.depth > profile.maxDepth) {
      throw new DecomposerLlmError(
        `node ${node.id} depth ${node.depth} exceeds ${options.granularity} cap ${profile.maxDepth}`,
        undefined,
        "validate"
      );
    }
  }

  // 5. parent-child depth consistency
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
