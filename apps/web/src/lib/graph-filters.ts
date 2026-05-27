import type {
  GraphNodeStatus,
  GraphNodeView,
  GraphRiskLevel
} from "./graph-view-model";

export type NodeKindFilter = "leaf" | "composite";

export interface GraphFilterState {
  text: string;
  statuses: ReadonlySet<GraphNodeStatus>;
  risks: ReadonlySet<GraphRiskLevel>;
  kinds: ReadonlySet<NodeKindFilter>;
  gateOnly: boolean;
}

export const EMPTY_FILTERS: GraphFilterState = {
  text: "",
  statuses: new Set(),
  risks: new Set(),
  kinds: new Set(),
  gateOnly: false
};

export function nodeMatchesFilters(
  node: GraphNodeView,
  filters: GraphFilterState
): boolean {
  if (filters.text.length > 0) {
    const needle = filters.text.toLowerCase();
    const haystack = `${node.id} ${node.title}`.toLowerCase();
    if (!haystack.includes(needle)) {
      return false;
    }
  }

  if (filters.statuses.size > 0 && !filters.statuses.has(node.status)) {
    return false;
  }

  if (filters.risks.size > 0) {
    if (node.riskLevel === undefined || !filters.risks.has(node.riskLevel)) {
      return false;
    }
  }

  if (filters.kinds.size > 0) {
    const kind = node.kind === "leaf" || node.kind === "composite" ? node.kind : null;
    if (kind === null || !filters.kinds.has(kind)) {
      return false;
    }
  }

  if (filters.gateOnly && node.gateRequired !== true) {
    return false;
  }

  return true;
}

export function filtersAreEmpty(filters: GraphFilterState): boolean {
  return (
    filters.text.length === 0 &&
    filters.statuses.size === 0 &&
    filters.risks.size === 0 &&
    filters.kinds.size === 0 &&
    !filters.gateOnly
  );
}

export function visibleNodeIds(
  nodes: readonly GraphNodeView[],
  filters: GraphFilterState
): Set<string> {
  const matched = new Set<string>();
  for (const node of nodes) {
    if (nodeMatchesFilters(node, filters)) {
      matched.add(node.id);
    }
  }
  return matched;
}

export function toggleSetValue<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}
