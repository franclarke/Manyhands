export interface FlowLayoutNode {
  id: string;
  parentId: string | null;
  /** Longest path from the start of the run, compiled onto the node. */
  topologicalLevel?: number | undefined;
}

export interface FlowBand {
  level: number;
  nodeIds: string[];
  count: number;
  /** Row centre in flow coordinates, for drawing the band behind its nodes. */
  y: number;
}

export interface FlowLayout {
  positions: Map<string, { x: number; y: number }>;
  bands: FlowBand[];
}

const HORIZONTAL_STRIDE = 276;
const VERTICAL_STRIDE = 210;

/**
 * Bands the graph by topological level: everything that became eligible at the
 * same distance from the start sits on one row.
 *
 * A band is NOT a wave. The wave was a barrier the runtime synchronised on, and
 * it was removed; naming it here would put back into the operator's head the
 * very thing we took out of the scheduler. Two nodes on a row do not run at the
 * same time — they became eligible at the same depth.
 *
 * Positions are a pure function of structure. If they depended on run state, a
 * node would jump the moment it turned green, which destroys the operator's
 * mental map exactly the way an auto-fitView does, only by another route.
 */
export function layoutRunFlow(
  nodes: readonly FlowLayoutNode[],
  /**
   * Level per node. Supplied by the caller because a revision compiled before
   * stage 4 carries none, and banding those together under "no dependencies"
   * would state something false about a graph that plainly has them — the
   * caller derives the levels from the graph instead.
   */
  levelOf?: (nodeId: string) => number | undefined
): FlowLayout {
  const byLevel = new Map<number, FlowLayoutNode[]>();
  const resolved = new Map(nodes.map((node) => [node.id, levelOf?.(node.id) ?? node.topologicalLevel]));
  // Whatever still has no level goes to a band of its own AFTER the known ones,
  // so it reads as "not placed" rather than as "ready to start".
  const fallbackLevel = Math.max(-1, ...[...resolved.values()].map((level) => level ?? -1)) + 1;
  for (const node of nodes) {
    const level = resolved.get(node.id) ?? fallbackLevel;
    byLevel.set(level, [...(byLevel.get(level) ?? []), node]);
  }

  const ownershipPath = pathResolver(nodes);
  const positions = new Map<string, { x: number; y: number }>();
  const bands: FlowBand[] = [];

  for (const level of [...byLevel.keys()].sort((left, right) => left - right)) {
    // Ownership first so siblings stay together, then id: an order that depends
    // on how the model happened to deliver the nodes would slide a node
    // sideways between renders.
    const members = [...byLevel.get(level)!].sort((left, right) => {
      const byPath = ownershipPath(left.id).localeCompare(ownershipPath(right.id));
      return byPath !== 0 ? byPath : left.id.localeCompare(right.id);
    });
    const y = level * VERTICAL_STRIDE;
    members.forEach((node, index) => {
      positions.set(node.id, { x: (index - (members.length - 1) / 2) * HORIZONTAL_STRIDE, y });
    });
    bands.push({ level, nodeIds: members.map((node) => node.id), count: members.length, y });
  }

  return { positions, bands };
}

/**
 * The offset to apply to the incoming layout so an anchor node lands exactly
 * where it already was on screen.
 *
 * Switching layout moves every node, and without this the node the operator was
 * reading leaves the screen. The correction is applied to the LAYOUT, not to the
 * camera: moving the camera means an imperative call that the re-render laying
 * the nodes out again silently discards, and it would also be the kind of
 * camera motion the interaction model is careful about. Offsetting positions is
 * pure, deterministic, and testable without a browser.
 *
 * Rendered position is `base(arrangement) + offset`. `anchorBefore` is the
 * anchor's RENDERED position, which already contains the current offset, so the
 * new one replaces it rather than accumulating on top of it:
 * `offset' = rendered_before(anchor) - base_after(anchor)`.
 *
 * Adding to the current offset instead double-counts, and the error only shows
 * on the second switch — the first one looks perfect.
 */
export function nextLayoutOffset(
  offset: { x: number; y: number },
  anchorRenderedBefore: { x: number; y: number } | undefined,
  anchorBaseAfter: { x: number; y: number } | undefined
): { x: number; y: number } {
  if (anchorRenderedBefore === undefined || anchorBaseAfter === undefined) return offset;
  return {
    x: anchorRenderedBefore.x - anchorBaseAfter.x,
    y: anchorRenderedBefore.y - anchorBaseAfter.y
  };
}

/** Applies a layout offset to every position. */
export function offsetPositions(
  positions: ReadonlyMap<string, { x: number; y: number }>,
  offset: { x: number; y: number }
): Map<string, { x: number; y: number }> {
  if (offset.x === 0 && offset.y === 0) return new Map(positions);
  return new Map([...positions].map(([id, position]) => [id, { x: position.x + offset.x, y: position.y + offset.y }]));
}

/** Root-to-node key, so siblings sort adjacently and stably. */
function pathResolver(nodes: readonly FlowLayoutNode[]): (nodeId: string) => string {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const cache = new Map<string, string>();
  return function resolve(nodeId: string): string {
    const cached = cache.get(nodeId);
    if (cached !== undefined) return cached;
    const seen = new Set<string>();
    const segments: string[] = [];
    let current: string | null | undefined = nodeId;
    while (current !== null && current !== undefined && !seen.has(current)) {
      seen.add(current);
      segments.unshift(current);
      current = parentOf.get(current) ?? null;
    }
    const path = segments.join("/");
    cache.set(nodeId, path);
    return path;
  };
}

/**
 * Where the camera sits when a run is opened.
 *
 * The canvas used a constant `{ x: 84, y: 110, zoom: 0.84 }`, so the graph
 * appeared wherever that happened to land — usually against the left edge. This
 * places the root in the middle of the pane instead.
 *
 * It runs once, before the operator has a frame of reference to preserve, which
 * is what separates it from the auto-fit the interaction model forbids: that
 * rule is about the camera moving in response to server events.
 */
export function initialViewport(input: {
  root?: { x: number; y: number } | undefined;
  containerWidth: number;
  nodeWidth: number;
  zoom: number;
  y?: number;
}): { x: number; y: number; zoom: number } | null {
  if (input.root === undefined || input.containerWidth <= 0) return null;
  const rootCentre = (input.root.x + input.nodeWidth / 2) * input.zoom;
  return {
    x: input.containerWidth / 2 - rootCentre,
    y: input.y ?? 110,
    zoom: input.zoom
  };
}
