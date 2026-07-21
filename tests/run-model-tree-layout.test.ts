import { describe, expect, it } from "vitest";

import { layoutRunTree } from "@/lib/run-model/tree-layout";

describe("run graph tree layout", () => {
  it("reserves horizontal space for descendant subtrees without overlapping cards", () => {
    const positions = layoutRunTree("root", [
      node("root", null, 0),
      node("foundation", "root", 0),
      node("features", "root", 1),
      node("scaffold", "foundation", 0),
      node("domain", "foundation", 1),
      node("storage", "foundation", 2),
      node("participants", "features", 0),
      node("expenses", "features", 1),
      node("balances", "features", 2),
      node("responsive", "features", 3)
    ]);

    const leafXs = ["scaffold", "domain", "storage", "participants", "expenses", "balances", "responsive"]
      .map((id) => positions.get(id)?.x)
      .filter((value): value is number => value !== undefined)
      .sort((left, right) => left - right);

    expect(leafXs).toHaveLength(7);
    expect(leafXs.slice(1).every((value, index) => value - leafXs[index]! >= 276)).toBe(true);
    expect(positions.get("foundation")?.x).toBeLessThan(positions.get("features")?.x ?? 0);
    expect(positions.get("root")).toEqual({ x: 0, y: 0 });
  });

  it("keeps sibling order deterministic while a subtree grows", () => {
    const positions = layoutRunTree("root", [
      node("root", null, 0),
      node("left", "root", 0),
      node("right", "root", 1),
      node("left-a", "left", 0),
      node("left-b", "left", 1)
    ]);

    expect(positions.get("left")?.x).toBeLessThan(positions.get("right")?.x ?? 0);
    expect(positions.get("left-a")?.x).toBeLessThan(positions.get("left-b")?.x ?? 0);
  });
});

function node(id: string, parentId: string | null, siblingIndex: number) {
  return {
    id,
    parentId,
    layout: { depth: parentId === null ? 0 : id.includes("-") ? 2 : 1, siblingIndex, siblingCount: 4 }
  };
}
