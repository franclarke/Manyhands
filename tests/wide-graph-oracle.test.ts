import { describe, expect, it } from "vitest";
import {
  checkWideGraphOutput,
  evaluateWideGraphOutput
} from "../docs/tesis/evidence/scripts/lib/wide-graph-oracle.mjs";
import { metricsFor } from "../docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs";

function report(overrides: Record<string, unknown> = {}, moduleCount = 4) {
  return {
    schemaVersion: 1,
    moduleCount,
    scenario: "thesis-seed-2026",
    projections: metricsFor(moduleCount).map((metric) => ({ projectionId: metric.id, value: metric.expected })),
    ...overrides
  } as {
    schemaVersion: number;
    moduleCount: number;
    scenario: string;
    projections: { projectionId: string; value?: unknown }[];
  };
}

describe("wide graph external oracle", () => {
  it("accepts a report that answers every question correctly", () => {
    expect(checkWideGraphOutput(report(), 4)).toEqual([]);
  });

  /**
   * La propiedad que motivó rehacer el oráculo. Verificar sólo estructura y
   * determinismo no distingue un módulo correcto de uno que devuelve un valor
   * plausible inventado: dos corridas de un stub son tan idénticas entre sí como
   * dos de una implementación real. Con el seed congelado hay una sola respuesta
   * correcta por pregunta, y se puede exigir.
   */
  it("rejects a well-formed report whose answer is wrong", () => {
    const stubbed = report();
    stubbed.projections[0]!.value = { "zone-1": 1, "zone-2": 1, "zone-3": 1, "zone-4": 1 };

    const failures = checkWideGraphOutput(stubbed, 4);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("zone-unit-totals");
    expect(failures[0]).toContain("expected");
  });

  it("rejects a module that reports no value at all", () => {
    const missing = report();
    delete missing.projections[2]!.value;

    expect(checkWideGraphOutput(missing, 4)).toEqual([expect.stringContaining("reported no value")]);
  });

  it("ignores key order inside an answer", () => {
    const reordered = report();
    reordered.projections[0]!.value = { "zone-4": 30, "zone-3": 65, "zone-2": 40, "zone-1": 35 };

    expect(checkWideGraphOutput(reordered, 4)).toEqual([]);
  });

  it("requires the projections in catalogue order, not alphabetical order", () => {
    const shuffled = report();
    shuffled.projections = [...shuffled.projections].reverse();

    expect(checkWideGraphOutput(shuffled, 4)).toEqual([expect.stringContaining("projection order must be")]);
    expect(evaluateWideGraphOutput(shuffled, 4).valuesCompared).toBe(false);
  });

  it("records that specimen values were compared when catalogue order permits it", () => {
    expect(evaluateWideGraphOutput(report(), 4).valuesCompared).toBe(true);
  });

  it("rejects a wrapper that does not match the frozen envelope", () => {
    expect(checkWideGraphOutput(report({ scenario: "other" }), 4)).toContainEqual(expect.stringContaining("scenario"));
    expect(checkWideGraphOutput(report({ moduleCount: 8 }), 4)).toContainEqual(expect.stringContaining("moduleCount"));
    expect(checkWideGraphOutput(report({ schemaVersion: 2 }), 4)).toContainEqual(expect.stringContaining("schemaVersion"));
  });

  it("scales to the widest cell without changing the contract", () => {
    expect(checkWideGraphOutput(report({}, 16), 16)).toEqual([]);
  });
});
