import { describe, expect, it } from "vitest";

import { layoutRunFlow, nextLayoutOffset, offsetPositions } from "@/lib/run-model/flow-layout";

/**
 * Stage 6 of `docs/plans/2026-08-05-robust-graph-execution-redesign.md`.
 *
 * The flow layout bands the graph by topological level: what became eligible at
 * the same distance from the start. Positions are a pure function of structure,
 * never of run state — a node that moved when it turned green would destroy the
 * operator's mental map exactly the way an auto-fitView does, just by another
 * route.
 */

const NODES = [
  { id: "root", parentId: null, topologicalLevel: 2 },
  { id: "domain", parentId: "root", topologicalLevel: 0 },
  { id: "api", parentId: "root", topologicalLevel: 1 },
  { id: "ui", parentId: "root", topologicalLevel: 0 }
];

describe("flow layout", () => {
  it("puts every node of one level on one row", () => {
    const { positions } = layoutRunFlow(NODES);

    expect(positions.get("domain")!.y).toBe(positions.get("ui")!.y);
    expect(positions.get("api")!.y).toBeGreaterThan(positions.get("domain")!.y);
    expect(positions.get("root")!.y).toBeGreaterThan(positions.get("api")!.y);
  });

  it("spreads the nodes of a level so none overlap", () => {
    const { positions } = layoutRunFlow(NODES);

    expect(positions.get("domain")!.x).not.toBe(positions.get("ui")!.x);
  });

  it("reports one band per occupied level, with its members", () => {
    const { bands } = layoutRunFlow(NODES);

    expect(bands.map((band) => band.level)).toEqual([0, 1, 2]);
    expect(bands[0]!.nodeIds).toEqual(["domain", "ui"]);
    expect(bands[0]!.count).toBe(2);
  });

  /**
   * Order inside a band follows ownership then id, so it does not depend on the
   * order the model happened to deliver. A node that slid sideways between
   * renders would be as disorienting as one that jumped rows.
   */
  it("orders a band the same way whatever order the nodes arrive in", () => {
    const forward = layoutRunFlow(NODES);
    const reversed = layoutRunFlow([...NODES].reverse());

    expect([...reversed.positions.entries()].sort()).toEqual([...forward.positions.entries()].sort());
    expect(reversed.bands[0]!.nodeIds).toEqual(forward.bands[0]!.nodeIds);
  });

  /**
   * A revision compiled before stage 4 carries no level. Dropping those nodes
   * would make the layout silently lose work; they collapse into a level of
   * their own instead, which is visible and therefore fixable.
   */
  it("keeps nodes that carry no topological level", () => {
    const { positions, bands } = layoutRunFlow([
      { id: "a", parentId: null, topologicalLevel: 0 },
      { id: "b", parentId: null }
    ]);

    expect(positions.has("b")).toBe(true);
    expect(bands.some((band) => band.nodeIds.includes("b"))).toBe(true);
  });

  it("depends on structure alone, so run state cannot move a node", () => {
    const before = layoutRunFlow(NODES);
    // The same structure with different status/selection would be the same
    // input here: the function has no channel through which state could enter.
    const after = layoutRunFlow(NODES.map((node) => ({ ...node })));

    expect([...after.positions.entries()]).toEqual([...before.positions.entries()]);
  });
});

describe("anchoring across a layout change", () => {
  /**
   * Switching layout moves every node. Without this the node the operator was
   * looking at leaves the screen. The correction is applied to the layout
   * rather than to the camera: an imperative camera call is discarded by the
   * very re-render that lays the nodes out again, and offsetting positions is
   * pure, so it can be proven here instead of in a browser.
   */
  it("offsets the incoming layout so the anchor keeps its place", () => {
    const offset = nextLayoutOffset({ x: 0, y: 0 }, { x: -690, y: 380 }, { x: 276, y: 0 });

    expect(offset).toEqual({ x: -966, y: 380 });
    // Applying it puts the anchor back exactly where it was.
    expect(offsetPositions(new Map([["token", { x: 276, y: 0 }]]), offset).get("token"))
      .toEqual({ x: -690, y: 380 });
  });

  /**
   * The offset REPLACES the previous one. `before` is the anchor's rendered
   * position and already contains the current offset, so adding to it
   * double-counts — and the error hides until the second switch, because the
   * first one looks perfect.
   */
  it("replaces the previous offset instead of accumulating it", () => {
    const first = nextLayoutOffset({ x: 0, y: 0 }, { x: -690, y: 380 }, { x: 276, y: 0 });
    expect(first).toEqual({ x: -966, y: 380 });

    // Switching back: the anchor is rendered at -690 and its base position in
    // the outgoing layout is -690, so the layout needs no offset at all.
    const second = nextLayoutOffset(first, { x: -690, y: 380 }, { x: -690, y: 380 });
    expect(second).toEqual({ x: 0, y: 0 });
  });

  it("keeps the anchor fixed across a round trip", () => {
    const ownBase = { x: -690, y: 380 };
    const flowBase = { x: 276, y: 0 };

    const toFlow = nextLayoutOffset({ x: 0, y: 0 }, ownBase, flowBase);
    const renderedInFlow = offsetPositions(new Map([["token", flowBase]]), toFlow).get("token")!;
    expect(renderedInFlow).toEqual(ownBase);

    const backToOwnership = nextLayoutOffset(toFlow, renderedInFlow, ownBase);
    const renderedBack = offsetPositions(new Map([["token", ownBase]]), backToOwnership).get("token")!;
    expect(renderedBack).toEqual(ownBase);
  });

  it("leaves the layout alone when there is no anchor", () => {
    expect(nextLayoutOffset({ x: 7, y: 9 }, undefined, { x: 0, y: 0 })).toEqual({ x: 7, y: 9 });
    expect(nextLayoutOffset({ x: 7, y: 9 }, { x: 0, y: 0 }, undefined)).toEqual({ x: 7, y: 9 });
  });

  it("returns the positions untouched when the offset is zero", () => {
    const positions = new Map([["a", { x: 1, y: 2 }]]);
    expect(offsetPositions(positions, { x: 0, y: 0 }).get("a")).toEqual({ x: 1, y: 2 });
  });
});
