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
  topPadding?: number;
  leftPadding?: number;
  nodeWidth?: number;
}

const DEFAULTS = {
  columnWidth: 304,
  rowHeight: 164,
  topPadding: 64,
  leftPadding: 80,
  nodeWidth: 248
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
  const topPadding = options.topPadding ?? DEFAULTS.topPadding;
  const leftPadding = options.leftPadding ?? DEFAULTS.leftPadding;

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
  let maxRows = 0;

  for (const [columnIndex, depth] of depths.entries()) {
    const bucket = byDepth.get(depth) ?? [];
    const ordered = [...bucket].sort((left, right) => {
      const parentCompare = (left.parentId ?? "").localeCompare(right.parentId ?? "");
      if (parentCompare !== 0) return parentCompare;
      const statusCompare =
        (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99);
      if (statusCompare !== 0) return statusCompare;
      return left.id.localeCompare(right.id);
    });

    const x = leftPadding + columnIndex * columnWidth;

    ordered.forEach((node, rowIndex) => {
      positions.set(node.id, {
        id: node.id,
        x,
        y: topPadding + rowIndex * rowHeight
      });
    });

    columns.push({
      depth,
      label: `DEPTH ${depth}`,
      x,
      nodeCount: ordered.length
    });
    maxRows = Math.max(maxRows, ordered.length);
  }

  const width = leftPadding + depths.length * columnWidth;
  const height = topPadding + maxRows * rowHeight + 80;

  return { positions, columns, width, height };
}
