import { describe, expect, it } from "vitest";

import { initialViewport } from "@/lib/run-model/flow-layout";

/**
 * The canvas opened at a fixed camera — `{ x: 84, y: 110, zoom: 0.84 }` —
 * regardless of how wide the pane was or where the layout put the root, so a
 * run opened with its graph pushed against the left edge.
 *
 * Centring once on open is not the auto-fit the interaction model forbids:
 * that rule is about the camera moving in response to server events. This runs
 * before the operator has a frame of reference to preserve.
 */
describe("The camera a run opens with", () => {
  const zoom = 0.84;
  const nodeWidth = 246;

  it("puts the root in the middle of the pane", () => {
    const viewport = initialViewport({ root: { x: 0, y: 0 }, containerWidth: 1000, nodeWidth, zoom });

    const rootCentre = viewport!.x + (0 + nodeWidth / 2) * zoom;
    expect(Math.round(rootCentre)).toBe(500);
    expect(viewport!.zoom).toBe(zoom);
  });

  it("centres a root the layout placed far from the origin", () => {
    const viewport = initialViewport({ root: { x: 1200, y: 40 }, containerWidth: 800, nodeWidth, zoom });

    const rootCentre = viewport!.x + (1200 + nodeWidth / 2) * zoom;
    expect(Math.round(rootCentre)).toBe(400);
  });

  it("centres the root even when the pane is narrower than one node", () => {
    // Clamping x to zero here was my first attempt and it was wrong: it left a
    // far-right root off screen entirely. A node too wide for the pane should
    // be clipped evenly, which is what centring already does.
    const viewport = initialViewport({ root: { x: 0, y: 0 }, containerWidth: 120, nodeWidth, zoom });

    const rootCentre = viewport!.x + (nodeWidth / 2) * zoom;
    expect(Math.round(rootCentre)).toBe(60);
  });

  it("has nothing to place before the pane is measured", () => {
    expect(initialViewport({ root: { x: 0, y: 0 }, containerWidth: 0, nodeWidth, zoom })).toBeNull();
    expect(initialViewport({ containerWidth: 900, nodeWidth, zoom })).toBeNull();
  });
});
