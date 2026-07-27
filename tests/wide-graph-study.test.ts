import { describe, expect, it } from "vitest";
import {
  findExecutorModel,
  isExecutorSelection
} from "../packages/shared/src/executor-registry";
import {
  WIDE_GRAPH_BASE_SHA,
  WIDE_GRAPH_SELECTIONS,
  WIDE_GRAPH_SIZES,
  buildWideGraphPlan,
  wideGraphSelection
} from "../docs/tesis/evidence/scripts/lib/wide-graph-study.mjs";
import { metricsFor } from "../docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs";

describe("wide graph study plan", () => {
  it("freezes the agreed graph widths against the verified W1 delivery", () => {
    const plan = buildWideGraphPlan({ targetRepo: "C:/target" });

    expect(WIDE_GRAPH_SIZES).toEqual([4, 8, 16]);
    expect(WIDE_GRAPH_BASE_SHA).toBe("71f61c9efa222103ca2fb2f67692434ab493d75c");
    expect(plan.map((cell) => cell.moduleCount)).toEqual([4, 8, 16]);
    expect(plan.every((cell) => cell.baseSha === WIDE_GRAPH_BASE_SHA)).toBe(true);
  });

  it("names every independent module and keeps peers out of its fixed contract", () => {
    const [cell] = buildWideGraphPlan({ targetRepo: "C:/target" });

    expect(cell.goal).toContain("src/analytics/projection-01.ts");
    expect(cell.goal).toContain("src/analytics/projection-04.ts");
    expect(cell.goal).toContain("must not import another module");
    expect(cell.goal).toContain("src/analytics/registry.ts");
    expect(cell.goal).toContain("study:wide-graph");
    expect(cell.goal).toContain("exactly one JSON object");
  });

  /**
   * Las tres propiedades que el estímulo anterior no tenía, y que son la razón
   * de este rediseño.
   */
  it("gives each module its own question instead of a shared derivation", () => {
    const [cell] = buildWideGraphPlan({ targetRepo: "C:/target" });

    for (const metric of metricsFor(cell.moduleCount)) {
      expect(cell.goal).toContain(metric.question);
      expect(cell.goal).toContain(`"${metric.id}"`);
    }
  });

  it("gives each module its own test file so no two leaves contest one output", () => {
    const [cell] = buildWideGraphPlan({ targetRepo: "C:/target" });

    expect(cell.goal).toContain("src/analytics/projection-01.test.ts");
    expect(cell.goal).toContain("src/analytics/projection-04.test.ts");
    expect(cell.goal).toContain("src/analytics/registry.test.ts");
    expect(cell.goal).not.toContain("projections.test.ts");
  });

  it("never states an expected answer, so a module cannot hardcode one", () => {
    for (const cell of buildWideGraphPlan({ targetRepo: "C:/target" })) {
      for (const metric of metricsFor(cell.moduleCount)) {
        expect(cell.goal, metric.id).not.toContain(JSON.stringify(metric.expected));
      }
    }
  });
});

/**
 * The generator used to hardcode one executor, so running the sweep under a
 * different model meant editing the instrument. A cell has to declare which
 * executor produced it, and that declaration has to be one the registry knows —
 * otherwise a frozen cell can name a model that cannot run.
 */
describe("wide graph executor selection", () => {
  it("offers only selections the executor registry knows", () => {
    for (const [name, selection] of Object.entries(WIDE_GRAPH_SELECTIONS)) {
      expect(isExecutorSelection(selection), name).toBe(true);
      expect(findExecutorModel(selection), name).toBeDefined();
    }
  });

  it("carries a reasoning effort only when the model exposes one", () => {
    for (const [name, selection] of Object.entries(WIDE_GRAPH_SELECTIONS)) {
      const model = findExecutorModel(selection);
      if (model?.efforts === null) {
        expect(selection, name).not.toHaveProperty("effort");
      } else {
        expect(model?.efforts, name).toContain(selection.effort);
      }
    }
  });

  it("resolves a named selection and refuses an unknown one", () => {
    expect(wideGraphSelection("claude")).toEqual({ executorId: "claude-code-cli", model: "sonnet" });
    expect(wideGraphSelection("codex")).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(() => wideGraphSelection("gemini")).toThrow(/unknown executor selection/iu);
  });
});
