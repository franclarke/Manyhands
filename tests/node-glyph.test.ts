/**
 * Node glyph — pure status→glyph mapping for the DAG task node (C1, "Glyph dial").
 *
 * The DAG node used to encode status almost entirely in the COLOUR of an 8px dot,
 * so pending (grey) and done (sage) were both solid discs distinguishable only by
 * hue — illegible at low zoom and for colour-blind operators. The v-next direction
 * carries state in the glyph's SHAPE first: a hollow ring (pending), a filled disc
 * (active/done), a filled square (failed), a dashed ring (blocked/obsolete), and a
 * Hand glyph (gated — waiting on a person). This mapping is pure and node-testable;
 * the component just renders the descriptor it returns.
 */
import { describe, expect, it } from "vitest";
import { nodeGlyph, type NodeGlyph } from "@/lib/run-model/node-glyph";
import type { VitalStatus } from "@/lib/run-model/workspace-view";

const ALL_STATUSES: VitalStatus[] = [
  "idle",
  "planning",
  "running",
  "verifying",
  "repairing",
  "gated",
  "done",
  "obsolete",
  "blocked",
  "failed"
];

describe("nodeGlyph", () => {
  it("renders pending (not-started) as a hollow ring — the only state with no fill", () => {
    expect(nodeGlyph("idle")).toEqual<NodeGlyph>({ kind: "dot", variant: "pending" });
  });

  it("renders every live phase as the filled active disc (the pulse is added by the component)", () => {
    for (const status of ["planning", "running", "verifying", "repairing"] as const) {
      expect(nodeGlyph(status)).toEqual<NodeGlyph>({ kind: "dot", variant: "active" });
    }
  });

  it("renders done as the filled disc with a rest ring", () => {
    expect(nodeGlyph("done")).toEqual<NodeGlyph>({ kind: "dot", variant: "done" });
  });

  it("renders failed as the square glyph — the only non-circular silhouette", () => {
    expect(nodeGlyph("failed")).toEqual<NodeGlyph>({ kind: "dot", variant: "failed" });
  });

  it("renders gated as the Hand glyph — it waits on a human, not the system", () => {
    expect(nodeGlyph("gated")).toEqual<NodeGlyph>({ kind: "hand" });
  });

  it("renders blocked and obsolete as the dashed ring (stalled/superseded, never failed)", () => {
    expect(nodeGlyph("blocked")).toEqual<NodeGlyph>({ kind: "dot", variant: "blocked" });
    expect(nodeGlyph("obsolete")).toEqual<NodeGlyph>({ kind: "dot", variant: "blocked" });
  });

  it("maps every VitalStatus to a glyph (exhaustive, no gaps)", () => {
    for (const status of ALL_STATUSES) {
      expect(nodeGlyph(status)).toBeDefined();
    }
  });
});
