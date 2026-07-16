export interface TaskLayoutNode {
  id: string;
  parentId: string | null;
  depth: number;
  title: string;
}

export interface TaskNodePosition {
  x: number;
  y: number;
}

const DEFAULT_X_GAP = 280;
const DEFAULT_Y_GAP = 160;

/** Stable top-to-bottom tree layout for the canonical task hierarchy. */
export function layoutVerticalTaskDag(
  nodes: readonly TaskLayoutNode[],
  collapsedIds: ReadonlySet<string>,
  xGap = DEFAULT_X_GAP,
  yGap = DEFAULT_Y_GAP
): Map<string, TaskNodePosition> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, TaskLayoutNode[]>();
  for (const node of nodes) {
    if (node.parentId === null || !byId.has(node.parentId)) continue;
    const bucket = children.get(node.parentId) ?? [];
    bucket.push(node);
    children.set(node.parentId, bucket);
  }
  for (const bucket of children.values()) {
    bucket.sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  }

  const positions = new Map<string, TaskNodePosition>();
  let leafCursor = 0;
  const place = (node: TaskLayoutNode): number => {
    const visibleChildren = collapsedIds.has(node.id) ? [] : children.get(node.id) ?? [];
    let x: number;
    if (visibleChildren.length === 0) {
      x = leafCursor * xGap;
      leafCursor += 1;
    } else {
      const childXs = visibleChildren.map(place);
      x = (childXs[0]! + childXs[childXs.length - 1]!) / 2;
    }
    positions.set(node.id, { x, y: node.depth * yGap });
    return x;
  };

  const roots = nodes
    .filter((node) => node.parentId === null || !byId.has(node.parentId))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  for (const root of roots) place(root);
  return positions;
}
