export interface DependencyValidationNode {
  id: string;
}

export interface DependencyValidationEdge {
  source: string;
  target: string;
}

export type DependencyFormInvalidReason =
  | "missing_endpoint"
  | "self_dependency"
  | "duplicate_dependency"
  | "cycle";

export interface DependencyFormState {
  valid: boolean;
  reason?: DependencyFormInvalidReason;
  message?: string;
}

export function dependencyAlreadyExists(
  edges: readonly DependencyValidationEdge[],
  fromTaskId: string,
  toTaskId: string
): boolean {
  return edges.some((edge) => edge.source === fromTaskId && edge.target === toTaskId);
}

export function dependencyWouldCreateCycle(
  nodes: readonly DependencyValidationNode[],
  edges: readonly DependencyValidationEdge[],
  fromTaskId: string,
  toTaskId: string
): boolean {
  if (fromTaskId.length === 0 || toTaskId.length === 0 || fromTaskId === toTaskId) {
    return fromTaskId === toTaskId && fromTaskId.length > 0;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  nodeIds.add(fromTaskId);
  nodeIds.add(toTaskId);
  const adjacency = new Map<string, string[]>([...nodeIds].map((id) => [id, []]));
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }
  adjacency.get(fromTaskId)?.push(toTaskId);

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return true;
    }
    if (visited.has(nodeId)) {
      return false;
    }
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) {
      if (visit(next)) {
        return true;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };

  for (const nodeId of nodeIds) {
    if (visit(nodeId)) {
      return true;
    }
  }
  return false;
}

export function dependencyFormState(input: {
  nodes: readonly DependencyValidationNode[];
  edges: readonly DependencyValidationEdge[];
  fromTaskId: string;
  toTaskId: string;
}): DependencyFormState {
  const { nodes, edges, fromTaskId, toTaskId } = input;
  if (fromTaskId.length === 0 || toTaskId.length === 0) {
    return { valid: false, reason: "missing_endpoint", message: "Choose both endpoints" };
  }
  if (fromTaskId === toTaskId) {
    return { valid: false, reason: "self_dependency", message: "A task cannot depend on itself" };
  }
  if (dependencyAlreadyExists(edges, fromTaskId, toTaskId)) {
    return { valid: false, reason: "duplicate_dependency", message: "Dependency already exists" };
  }
  if (dependencyWouldCreateCycle(nodes, edges, fromTaskId, toTaskId)) {
    return { valid: false, reason: "cycle", message: "Dependency would create a cycle" };
  }
  return { valid: true };
}
