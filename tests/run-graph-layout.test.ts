import { describe, expect, it } from "vitest";
import { layoutVerticalTaskDag } from "@/lib/run-model/run-graph-layout";

const NODES = [
  { id: "root", parentId: null, depth: 0, title: "Root" },
  { id: "a", parentId: "root", depth: 1, title: "A" },
  { id: "b", parentId: "root", depth: 1, title: "B" },
  { id: "a1", parentId: "a", depth: 2, title: "A1" },
  { id: "a2", parentId: "a", depth: 2, title: "A2" }
];

describe("vertical task DAG layout", () => {
  it("uses depth as the vertical axis and packs siblings without overlap", () => {
    const positions = layoutVerticalTaskDag(NODES, new Set());

    expect(positions.get("root")?.y).toBe(0);
    expect(positions.get("a")?.y).toBeGreaterThan(positions.get("root")!.y);
    expect(positions.get("a")?.y).toBe(positions.get("b")?.y);
    expect(positions.get("a1")?.y).toBeGreaterThan(positions.get("a")!.y);
    expect(Math.abs(positions.get("a1")!.x - positions.get("a2")!.x)).toBeGreaterThanOrEqual(260);
  });

  it("centers a parent over the visible span of its children", () => {
    const positions = layoutVerticalTaskDag(NODES, new Set());
    const childMidpoint = (positions.get("a1")!.x + positions.get("a2")!.x) / 2;
    expect(positions.get("a")?.x).toBe(childMidpoint);
  });

  it("treats a collapsed composite as a leaf without moving descendants into the visible layout", () => {
    const positions = layoutVerticalTaskDag(NODES, new Set(["a"]));
    expect(positions.has("a")).toBe(true);
    expect(positions.has("a1")).toBe(false);
    expect(positions.has("a2")).toBe(false);
  });

  it("keeps fifty-task graphs stable and non-overlapping at every depth", () => {
    const nodes = [{ id: "root", parentId: null, depth: 0, title: "Root" }];
    for (let branch = 0; branch < 7; branch += 1) {
      const parentId = `branch-${branch}`;
      nodes.push({ id: parentId, parentId: "root", depth: 1, title: `Branch ${branch}` });
      for (let leaf = 0; leaf < 5; leaf += 1) {
        nodes.push({ id: `${parentId}-leaf-${leaf}`, parentId, depth: 2, title: `Leaf ${branch}.${leaf}` });
      }
    }
    for (let tail = 0; tail < 7; tail += 1) {
      nodes.push({ id: `tail-${tail}`, parentId: "root", depth: 1, title: `Tail ${tail}` });
    }

    const first = layoutVerticalTaskDag(nodes, new Set());
    const second = layoutVerticalTaskDag(nodes, new Set());
    expect(first.size).toBe(50);
    expect(Array.from(first.entries())).toEqual(Array.from(second.entries()));

    for (const depth of [0, 1, 2]) {
      const xs = nodes.filter((node) => node.depth === depth).map((node) => first.get(node.id)!.x).sort((a, b) => a - b);
      for (let index = 1; index < xs.length; index += 1) {
        expect(xs[index]! - xs[index - 1]!).toBeGreaterThanOrEqual(260);
      }
    }
  });
});
