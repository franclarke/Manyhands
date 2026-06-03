import type { GraphNodeView } from "./graph-view-model";

export interface NodePosition {
  id: string;
  x: number;
  y: number;
}

export interface PhaseColumn {
  depth: number;
  label: string;
  x: number;
  nodeCount: number;
}

export interface LayoutResult {
  positions: Map<string, NodePosition>;
  columns: PhaseColumn[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  columnWidth?: number;
  rowHeight?: number;
  subtreeGap?: number;
  topPadding?: number;
  leftPadding?: number;
  nodeWidth?: number;
}

const DEFAULTS = {
  columnWidth: 374,
  rowHeight: 202,
  subtreeGap: 34,
  topPadding: 64,
  leftPadding: 80,
  nodeWidth: 292
};

const STATUS_ORDER = [
  "running",
  "failed",
  "gated",
  "ready",
  "blocked",
  "planned",
  "done"
] as const;

const statusRank: Record<string, number> = STATUS_ORDER.reduce((acc, status, idx) => {
  acc[status] = idx;
  return acc;
}, {} as Record<string, number>);

export function layoutByDepth(
  nodes: readonly GraphNodeView[],
  options: LayoutOptions = {}
): LayoutResult {
  const columnWidth = options.columnWidth ?? DEFAULTS.columnWidth;
  const rowHeight = options.rowHeight ?? DEFAULTS.rowHeight;
  const subtreeGap = options.subtreeGap ?? DEFAULTS.subtreeGap;
  const topPadding = options.topPadding ?? DEFAULTS.topPadding;
  const leftPadding = options.leftPadding ?? DEFAULTS.leftPadding;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const byDepth = new Map<number, GraphNodeView[]>();
  for (const node of nodes) {
    const depth = node.depth ?? 0;
    const bucket = byDepth.get(depth) ?? [];
    bucket.push(node);
    byDepth.set(depth, bucket);
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const positions = new Map<string, NodePosition>();
  const columns: PhaseColumn[] = [];
  const columnIndexByDepth = new Map(depths.map((depth, index) => [depth, index]));

  for (const [columnIndex, depth] of depths.entries()) {
    const bucket = byDepth.get(depth) ?? [];
    columns.push({
      depth,
      label: `DEPTH ${depth}`,
      x: leftPadding + columnIndex * columnWidth,
      nodeCount: bucket.length
    });
  }

  const childrenByParent = new Map<string, GraphNodeView[]>();
  for (const node of nodes) {
    if (node.parentId === null || node.parentId === undefined || !nodeById.has(node.parentId)) {
      continue;
    }
    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }
  for (const [parentId, siblings] of childrenByParent.entries()) {
    childrenByParent.set(parentId, siblings.sort(compareTreeSiblings));
  }

  const roots = nodes
    .filter((node) => node.parentId === null || node.parentId === undefined || !nodeById.has(node.parentId))
    .sort(compareTreeSiblings);
  let cursorY = topPadding;
  const visited = new Set<string>();

  const xForDepth = (depth: number): number => {
    const columnIndex = columnIndexByDepth.get(depth) ?? 0;
    return leftPadding + columnIndex * columnWidth;
  };

  const placeSubtree = (node: GraphNodeView): { top: number; bottom: number } => {
    if (visited.has(node.id)) {
      const existing = positions.get(node.id);
      const y = existing?.y ?? cursorY;
      return { top: y, bottom: y };
    }
    visited.add(node.id);

    const children = childrenByParent.get(node.id) ?? [];
    const depth = node.depth ?? 0;
    const x = xForDepth(depth);

    if (children.length === 0) {
      const y = cursorY;
      positions.set(node.id, { id: node.id, x, y });
      cursorY += rowHeight;
      return { top: y, bottom: y };
    }

    let top = Number.POSITIVE_INFINITY;
    let bottom = Number.NEGATIVE_INFINITY;
    children.forEach((child, index) => {
      if (index > 0) {
        cursorY += subtreeGap;
      }
      const childBounds = placeSubtree(child);
      top = Math.min(top, childBounds.top);
      bottom = Math.max(bottom, childBounds.bottom);
    });

    const y = top + (bottom - top) / 2;
    positions.set(node.id, { id: node.id, x, y });
    return { top: Math.min(top, y), bottom: Math.max(bottom, y) };
  };

  roots.forEach((root, index) => {
    if (index > 0) {
      cursorY += subtreeGap * 1.5;
    }
    placeSubtree(root);
  });

  for (const node of nodes) {
    if (positions.has(node.id)) continue;
    positions.set(node.id, {
      id: node.id,
      x: xForDepth(node.depth ?? 0),
      y: cursorY
    });
    cursorY += rowHeight;
  }

  const width = leftPadding + depths.length * columnWidth;
  const height = Math.max(topPadding + rowHeight, cursorY + 80);

  return { positions, columns, width, height };
}

function compareTreeSiblings(left: GraphNodeView, right: GraphNodeView): number {
  const statusCompare =
    (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99);
  if (statusCompare !== 0) return statusCompare;
  return left.id.localeCompare(right.id);
}
