import type {
  GraphEdgeView,
  GraphNodeView,
  GraphRiskLevel,
  RunGraphViewModel
} from "@/lib/graph-view-model";

export interface OperationalMetrics {
  totalNodes: number;
  ready: number;
  running: number;
  blocked: number;
  needsReview: number;
  failed: number;
  integrated: number;
  highRisk: number;
  parallelBatches: number;
}

export function operationalMetrics(graph: RunGraphViewModel): OperationalMetrics {
  return {
    totalNodes: graph.summary.taskCount,
    ready: graph.status.ready + graph.status.approved,
    running: graph.status.running + graph.status.generating,
    blocked: graph.status.blocked,
    needsReview: graph.status.gated + graph.status.needs_review,
    failed: graph.status.failed,
    integrated: graph.status.integrated,
    highRisk: graph.nodes.filter((node) => node.riskLevel === "high" || node.riskLevel === "blocking").length,
    parallelBatches: estimateParallelBatches(graph.nodes)
  };
}

export function estimateParallelBatches(nodes: readonly GraphNodeView[]): number {
  const leafCountByDepth = new Map<number, number>();
  for (const node of nodes) {
    if (node.kind !== "leaf") continue;
    const depth = node.depth ?? 0;
    leafCountByDepth.set(depth, (leafCountByDepth.get(depth) ?? 0) + 1);
  }
  return [...leafCountByDepth.values()].filter((count) => count > 1).length;
}

export interface SelectionRelations {
  selectedTaskId: string;
  ancestors: ReadonlySet<string>;
  dependencies: ReadonlySet<string>;
  children: ReadonlySet<string>;
  related: ReadonlySet<string>;
}

export function selectionRelations(
  graph: RunGraphViewModel,
  selectedTaskId: string | null
): SelectionRelations | null {
  if (selectedTaskId === null || !graph.nodes.some((node) => node.id === selectedTaskId)) {
    return null;
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ancestors = new Set<string>();
  let parentId = nodeById.get(selectedTaskId)?.parentId ?? null;
  while (parentId !== null && parentId !== undefined && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = nodeById.get(parentId)?.parentId ?? null;
  }

  const dependencies = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.kind === "dependency" && edge.target === selectedTaskId) {
      dependencies.add(edge.source);
    }
  }

  const children = new Set(
    graph.nodes
      .filter((node) => node.parentId === selectedTaskId)
      .map((node) => node.id)
  );

  const related = new Set<string>([selectedTaskId]);
  for (const taskId of ancestors) related.add(taskId);
  for (const taskId of dependencies) related.add(taskId);
  for (const taskId of children) related.add(taskId);

  return {
    selectedTaskId,
    ancestors,
    dependencies,
    children,
    related
  };
}

export function nodeActionHint(node: Pick<GraphNodeView, "status" | "blockedReason" | "integrator">): string {
  switch (node.status) {
    case "ready":
    case "approved":
      return "Ready to run";
    case "running":
    case "generating":
      return node.integrator === true ? "Integrating child work" : "Agent running";
    case "blocked":
      return node.blockedReason ?? "Blocked by dependency";
    case "gated":
    case "needs_review":
      return "Needs review";
    case "done":
      return "Review output";
    case "integrated":
      return "Integrated";
    case "failed":
      return "Inspect failure";
    case "planned":
    default:
      return "Review contract";
  }
}

export function canNodeRunNow(node: Pick<GraphNodeView, "status" | "blockedReason">): boolean {
  return node.blockedReason === undefined && (node.status === "ready" || node.status === "approved");
}

export function riskLabel(level: GraphRiskLevel | undefined): string {
  return level === undefined ? "Risk none" : `Risk ${level}`;
}

export function nodeKindLabel(kind: string): string {
  if (kind === "leaf") return "Leaf";
  if (kind === "composite") return "Composite";
  if (kind === "integration") return "Integration";
  if (kind === "root") return "Root";
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

export function edgeIsRelated(edge: GraphEdgeView, relations: SelectionRelations | null): boolean {
  if (relations === null) return false;
  return relations.related.has(edge.source) && relations.related.has(edge.target);
}
