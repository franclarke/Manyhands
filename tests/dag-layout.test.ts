import { describe, expect, it } from "vitest";
import { layoutByDepth } from "@/lib/dag-layout";
import type { GraphNodeView } from "@/lib/graph-view-model";

describe("dag layout", () => {
  it("centers parent nodes over their visible child subtree", () => {
    const layout = layoutByDepth([
      node("root", null, 0),
      node("setup", "root", 1),
      node("ui", "root", 1),
      node("setup-data", "setup", 2),
      node("setup-tests", "setup", 2),
      node("ui-board", "ui", 2)
    ]);

    const setup = layout.positions.get("setup")!;
    const setupData = layout.positions.get("setup-data")!;
    const setupTests = layout.positions.get("setup-tests")!;
    const ui = layout.positions.get("ui")!;
    const uiBoard = layout.positions.get("ui-board")!;

    expect(setup.y).toBe((setupData.y + setupTests.y) / 2);
    expect(ui.y).toBe(uiBoard.y);
    expect(setupTests.y).toBeLessThan(uiBoard.y);
  });

  it("keeps sibling subtrees separated instead of flattening by depth only", () => {
    const layout = layoutByDepth([
      node("root", null, 0),
      node("alpha", "root", 1),
      node("beta", "root", 1),
      node("alpha-1", "alpha", 2),
      node("alpha-2", "alpha", 2),
      node("beta-1", "beta", 2),
      node("beta-2", "beta", 2)
    ]);

    const alphaBottom = Math.max(layout.positions.get("alpha-1")!.y, layout.positions.get("alpha-2")!.y);
    const betaTop = Math.min(layout.positions.get("beta-1")!.y, layout.positions.get("beta-2")!.y);

    expect(betaTop - alphaBottom).toBeGreaterThan(40);
  });
});

function node(id: string, parentId: string | null, depth: number): GraphNodeView {
  return {
    id,
    parentId,
    depth,
    title: id,
    description: id,
    kind: parentId === null ? "root" : "composite",
    status: "planned"
  };
}
