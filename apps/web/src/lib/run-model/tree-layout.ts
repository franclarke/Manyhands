export interface TreeLayoutNode {
  id: string;
  parentId: string | null;
  layout?: { siblingIndex: number } | undefined;
}

const HORIZONTAL_STRIDE = 276;
const VERTICAL_STRIDE = 190;

export function layoutRunTree(rootId: string, nodes: readonly TreeLayoutNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const insertionOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const childrenByParent = new Map<string, TreeLayoutNode[]>();
  for (const node of nodes) {
    if (node.parentId === null || !byId.has(node.parentId)) continue;
    childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node]);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => {
      const siblingOrder = (left.layout?.siblingIndex ?? Number.MAX_SAFE_INTEGER) - (right.layout?.siblingIndex ?? Number.MAX_SAFE_INTEGER);
      return siblingOrder !== 0 ? siblingOrder : (insertionOrder.get(left.id) ?? 0) - (insertionOrder.get(right.id) ?? 0);
    });
  }

  const spanByNodeId = new Map<string, number>();
  const subtreeSpan = (nodeId: string, visiting = new Set<string>()): number => {
    const cached = spanByNodeId.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) return 1;
    const nextVisiting = new Set(visiting).add(nodeId);
    const children = childrenByParent.get(nodeId) ?? [];
    const span = Math.max(1, children.reduce((total, child) => total + subtreeSpan(child.id, nextVisiting), 0));
    spanByNodeId.set(nodeId, span);
    return span;
  };

  const roots = [
    ...(byId.has(rootId) ? [byId.get(rootId)!] : []),
    ...nodes.filter((node) => node.id !== rootId && (node.parentId === null || !byId.has(node.parentId)))
  ];
  const totalSpan = roots.reduce((total, root) => total + subtreeSpan(root.id), 0);
  const positions = new Map<string, { x: number; y: number }>();
  const place = (node: TreeLayoutNode, left: number, depth: number): void => {
    const span = subtreeSpan(node.id);
    positions.set(node.id, { x: (left + span / 2 - totalSpan / 2) * HORIZONTAL_STRIDE, y: depth * VERTICAL_STRIDE });
    let childLeft = left;
    for (const child of childrenByParent.get(node.id) ?? []) {
      place(child, childLeft, depth + 1);
      childLeft += subtreeSpan(child.id);
    }
  };
  let rootLeft = 0;
  for (const root of roots) {
    place(root, rootLeft, 0);
    rootLeft += subtreeSpan(root.id);
  }
  return positions;
}
