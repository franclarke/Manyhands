import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  WIDE_GRAPH_METRICS,
  WIDE_GRAPH_SCENARIO,
  WIDE_GRAPH_SIZES,
  WIDE_GRAPH_TOTAL_UNITS,
  metricsFor,
  moduleIdFor
} from "../docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs";

const run = promisify(execFile);

/**
 * El catálogo es un specimen congelado: sus valores son el resultado correcto de
 * cada pregunta sobre el seed de W1, y de él salen tanto el estímulo como el
 * oráculo. Si un número está mal transcrito, el oráculo pide algo imposible y la
 * celda entera queda invalidada — que es como se perdieron los primeros W1.
 *
 * Estas pruebas no reimplementan las métricas; verifican que el catálogo sea
 * internamente coherente, que es lo que un error de transcripción rompe.
 */
describe("wide graph metric catalogue", () => {
  it("re-derives all sixteen catalogue values from a Git scenario blob", async () => {
    const repository = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-specimen-"));
    try {
      const scenarioDirectory = join(repository, "src", "scenarios");
      await mkdir(scenarioDirectory, { recursive: true });
      await writeFile(
        join(scenarioDirectory, "thesis-seed-2026.ts"),
        `const ZONE_NAMES = ["Receiving", "Bulk Storage", "Pick Face", "Shipping"];
const BINS_PER_ZONE = 4;
const SKUS = ["SKU-1001", "SKU-1002", "SKU-1003", "SKU-1004", "SKU-1005"];
const stockPlan: ReadonlyArray<readonly [binId: string, skuId: string, qty: number]> = [
  ["bin-1-1", SKUS[0], 20],
  ["bin-1-2", SKUS[1], 15],
  ["bin-2-1", SKUS[2], 30],
  ["bin-2-2", SKUS[0], 10],
  ["bin-3-1", SKUS[3], 25],
  ["bin-3-2", SKUS[4], 40],
  ["bin-4-1", SKUS[2], 12],
  ["bin-4-2", SKUS[3], 18],
];
`,
        "utf8"
      );
      await run("git", ["init", "--quiet"], { cwd: repository, windowsHide: true });
      await run("git", ["config", "user.email", "specimen@example.invalid"], { cwd: repository, windowsHide: true });
      await run("git", ["config", "user.name", "Specimen Test"], { cwd: repository, windowsHide: true });
      await run("git", ["add", "."], { cwd: repository, windowsHide: true });
      await run("git", ["commit", "--quiet", "-m", "fixture"], { cwd: repository, windowsHide: true });

      const { stdout } = await run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/derive-wide-graph-specimen.mjs",
          "--repository",
          repository,
          "--commit",
          "HEAD"
        ],
        { cwd: process.cwd(), windowsHide: true }
      );

      expect(JSON.parse(stdout)).toEqual({
        schemaVersion: 1,
        scenario: WIDE_GRAPH_SCENARIO,
        metrics: WIDE_GRAPH_METRICS.map(
          ({ id, expected }: { id: string; expected: unknown }) => ({ id, value: expected })
        )
      });
    } finally {
      await rm(repository, { recursive: true, force: true });
    }
  });

  it("declares sixteen distinct questions with unique ids", () => {
    expect(WIDE_GRAPH_METRICS).toHaveLength(16);
    expect(new Set(WIDE_GRAPH_METRICS.map((metric) => metric.id)).size).toBe(16);
    expect(WIDE_GRAPH_METRICS.every((metric) =>
      typeof metric.question === "string" && metric.question.trim().length > 0 && metric.expected !== undefined
    )).toBe(true);
  });

  it("keeps both independent partitions of the total in agreement", () => {
    const byId = new Map(WIDE_GRAPH_METRICS.map((metric) => [metric.id, metric.expected]));
    const sum = (record: Record<string, number>) => Object.values(record).reduce((total, value) => total + value, 0);

    expect(sum(byId.get("zone-unit-totals") as Record<string, number>)).toBe(WIDE_GRAPH_TOTAL_UNITS);
    expect(sum(byId.get("sku-unit-totals") as Record<string, number>)).toBe(WIDE_GRAPH_TOTAL_UNITS);
  });

  it("keeps occupancy, empty bins and per-zone counts consistent with each other", () => {
    const byId = new Map(WIDE_GRAPH_METRICS.map((metric) => [metric.id, metric.expected]));
    const occupancy = byId.get("bin-occupancy") as { occupied: number; empty: number; total: number };
    const emptyIds = byId.get("empty-bin-ids") as string[];
    const perZone = byId.get("occupied-bins-per-zone") as Record<string, number>;

    expect(occupancy.occupied + occupancy.empty).toBe(occupancy.total);
    expect(emptyIds).toHaveLength(occupancy.empty);
    expect(new Set(emptyIds).size).toBe(emptyIds.length);
    expect(Object.values(perZone).reduce((total, value) => total + value, 0)).toBe(occupancy.occupied);
  });

  it("keeps the SKU spread consistent with the single- and multi-bin answers", () => {
    const byId = new Map(WIDE_GRAPH_METRICS.map((metric) => [metric.id, metric.expected]));
    const spread = byId.get("sku-bin-spread") as Record<string, number>;
    const single = byId.get("single-bin-skus") as string[];
    const multi = byId.get("multi-bin-skus") as Record<string, string[]>;

    expect(Object.entries(spread).filter(([, bins]) => bins === 1).map(([sku]) => sku).sort()).toEqual(single);
    for (const [sku, bins] of Object.entries(multi)) expect(bins).toHaveLength(spread[sku]!);
  });

  /**
   * Los tamaños tienen que ser prefijos exactos: si N=4 no fuera un subconjunto
   * de N=8, entre dos puntos del barrido cambiaría el estímulo además de la
   * anchura, y la serie dejaría de ser comparable.
   */
  it("makes every sweep size a prefix of the next one", () => {
    expect(WIDE_GRAPH_SIZES).toEqual([4, 8, 16]);
    const [small, medium, large] = WIDE_GRAPH_SIZES.map((size) => metricsFor(size).map((metric) => metric.id));

    expect(medium!.slice(0, small!.length)).toEqual(small);
    expect(large!.slice(0, medium!.length)).toEqual(medium);
    expect(large).toHaveLength(16);
  });

  it("refuses a size the catalogue cannot support without padding", () => {
    expect(() => metricsFor(24)).toThrow(/unknown wide graph size 24/iu);
  });

  it("names modules in catalogue order", () => {
    expect(moduleIdFor(0)).toBe("projection-01");
    expect(moduleIdFor(15)).toBe("projection-16");
  });
});
