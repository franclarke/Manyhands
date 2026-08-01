import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertG6ComparativeCellProtocol,
  executionConfigForG6Cell
} from "../docs/tesis/evidence/scripts/lib/g6-cell-protocol.mjs";

const validCell = {
  cellId: "g6-03-T1-B-r1",
  seriesKind: "comparative",
  executionConfig: {
    maxParallel: 2,
    maxPlanningAttempts: 1,
    automaticRetryBudget: 0,
    maxCostUsd: 8
  },
  g6Protocol: {
    version: 1,
    maxPlanningAttempts: 1,
    maxAutomaticRetryBudget: 0,
    maxCellCostUsd: 8,
    maxSeriesCostUsd: 40,
    maxSeriesTokens: 2_000_000
  }
};

describe("G6 comparative cell protocol", () => {
  it("accepts a cell whose persisted execution policy matches the frozen protocol", () => {
    expect(assertG6ComparativeCellProtocol(validCell)).toEqual(validCell.g6Protocol);
    expect(executionConfigForG6Cell(validCell)).toEqual(validCell.executionConfig);
  });

  it("rejects a comparative cell that omits the zero-retry policy", () => {
    expect(() => assertG6ComparativeCellProtocol({
      ...validCell,
      executionConfig: { ...validCell.executionConfig, automaticRetryBudget: undefined }
    })).toThrow(/automaticRetryBudget/);
  });

  it("rejects a cell whose effective config differs from its declared protocol", () => {
    expect(() => assertG6ComparativeCellProtocol({
      ...validCell,
      executionConfig: { ...validCell.executionConfig, maxCostUsd: 7 }
    })).toThrow(/maxCostUsd/);
  });

  it("rejects a cell whose planner attempt cap differs from its declared protocol", () => {
    expect(() => assertG6ComparativeCellProtocol({
      ...validCell,
      executionConfig: { ...validCell.executionConfig, maxPlanningAttempts: 3 }
    })).toThrow(/maxPlanningAttempts/);
  });

  it("accepts every frozen G6 comparative cell", () => {
    const cells = [
      "g6-01-T1-A-r1",
      "g6-02-T1-C-r1",
      "g6-03-T1-B-r1",
      "g6-04-T1-C-r2",
      "g6-05-T1-A-r2",
      "g6-06-T1-B-r2"
    ].map((cellId) => JSON.parse(readFileSync(`docs/tesis/evidence/g6/cells/${cellId}.json`, "utf8")));
    for (const cell of cells) expect(assertG6ComparativeCellProtocol(cell)).toEqual(validCell.g6Protocol);
  });
});
