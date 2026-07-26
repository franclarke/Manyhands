import { describe, expect, it } from "vitest";
import {
  WIDE_GRAPH_BASE_SHA,
  WIDE_GRAPH_SIZES,
  buildWideGraphPlan
} from "../docs/tesis/evidence/scripts/lib/wide-graph-study.mjs";

describe("wide graph study plan", () => {
  it("freezes the four agreed graph widths against the verified W1 delivery", () => {
    const plan = buildWideGraphPlan({ targetRepo: "C:/target" });

    expect(WIDE_GRAPH_SIZES).toEqual([4, 8, 16, 24]);
    expect(WIDE_GRAPH_BASE_SHA).toBe("71f61c9efa222103ca2fb2f67692434ab493d75c");
    expect(plan.map((cell) => cell.moduleCount)).toEqual([4, 8, 16, 24]);
    expect(plan.every((cell) => cell.baseSha === WIDE_GRAPH_BASE_SHA)).toBe(true);
  });

  it("names every independent module and keeps peers out of its fixed contract", () => {
    const [cell] = buildWideGraphPlan({ targetRepo: "C:/target" });

    expect(cell.goal).toContain("src/analytics/projection-01.ts");
    expect(cell.goal).toContain("src/analytics/projection-04.ts");
    expect(cell.goal).toContain("must not import another projection module");
    expect(cell.goal).toContain("src/analytics/registry.ts");
    expect(cell.goal).toContain("study:wide-graph");
    expect(cell.goal).toContain("exactly one JSON object");
  });
});
