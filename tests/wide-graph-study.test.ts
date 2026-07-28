import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  findExecutorModel,
  isExecutorSelection
} from "../packages/shared/src/executor-registry";
import {
  WIDE_GRAPH_BASE_SHA,
  WIDE_GRAPH_SELECTIONS,
  WIDE_GRAPH_SIZES,
  assertWideGraphSeriesSelection,
  buildWideGraphPlan,
  wideGraphSelection
} from "../docs/tesis/evidence/scripts/lib/wide-graph-study.mjs";
import { metricsFor } from "../docs/tesis/evidence/scripts/lib/wide-graph-metrics.mjs";

const run = promisify(execFile);

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
  it("rejects Claude for a new series when only Codex is available", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-unavailable-executor-"));
    try {
      await expect(run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs",
          "--target",
          "C:/target",
          "--executor",
          "claude",
          "--out",
          outDir
        ],
        { cwd: process.cwd(), windowsHide: true }
      )).rejects.toMatchObject({
        stderr: expect.stringMatching(/Unknown executor selection "claude".+expected one of codex/iu)
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("rejects a heterogeneous frozen series in the productive driver preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-driver-"));
    const cellsDir = join(root, "cells");
    const outDir = join(root, "runs");
    const codex = wideGraphSelection("codex");
    const otherExecutor = { executorId: "other-cli", model: "other-model" };
    try {
      await mkdir(cellsDir);
      await writeFile(join(cellsDir, "manifest.json"), JSON.stringify({
        executorSelection: codex,
        cells: [{ cellId: "warehouse-wide-n04" }, { cellId: "warehouse-wide-n08" }]
      }));
      await writeFile(join(cellsDir, "warehouse-wide-n04.json"), JSON.stringify({
        cellId: "warehouse-wide-n04",
        position: 1,
        planningSelection: codex,
        executionSelection: codex,
        repairSelection: codex
      }));
      await writeFile(join(cellsDir, "warehouse-wide-n08.json"), JSON.stringify({
        cellId: "warehouse-wide-n08",
        position: 2,
        planningSelection: codex,
        executionSelection: otherExecutor,
        repairSelection: codex
      }));

      await expect(run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/run-g5.mjs",
          "--cells",
          cellsDir,
          "--out",
          outDir,
          "--only",
          "no-such-cell"
        ],
        { cwd: process.cwd(), windowsHide: true }
      )).rejects.toMatchObject({
        stderr: expect.stringMatching(/warehouse-wide-n08.+execution selection differs.+not comparable/iu)
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a homogeneous unavailable executor in the productive driver preflight", async () => {
    const root = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-driver-unavailable-"));
    const cellsDir = join(root, "cells");
    const outDir = join(root, "runs");
    const unavailable = { executorId: "other-cli", model: "other-model" };
    try {
      await mkdir(cellsDir);
      await writeFile(join(cellsDir, "manifest.json"), JSON.stringify({
        executorSelection: unavailable,
        cells: [{ cellId: "warehouse-wide-n04" }]
      }));
      await writeFile(join(cellsDir, "warehouse-wide-n04.json"), JSON.stringify({
        cellId: "warehouse-wide-n04",
        position: 1,
        planningSelection: unavailable,
        executionSelection: unavailable,
        repairSelection: unavailable
      }));

      await expect(run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/run-g5.mjs",
          "--cells",
          cellsDir,
          "--out",
          outDir,
          "--only",
          "no-such-cell"
        ],
        { cwd: process.cwd(), windowsHide: true }
      )).rejects.toMatchObject({
        stderr: expect.stringMatching(/executor selection.+is not available for a new run/iu)
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("records the homogeneous executor selection in every committed series manifest", async () => {
    const root = join(process.cwd(), "docs", "tesis", "evidence", "warehouse", "wide-graph");
    const seriesDirectories = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    for (const series of seriesDirectories) {
      const cellsDirectory = join(root, series, "cells");
      const names = await readdir(cellsDirectory).catch(() => []);
      if (!names.includes("manifest.json")) continue;
      const manifest = JSON.parse(await readFile(join(cellsDirectory, "manifest.json"), "utf8"));

      expect(manifest.executorSelection, series).toEqual(expect.objectContaining({
        executorId: expect.any(String),
        model: expect.any(String)
      }));
      for (const { cellId } of manifest.cells) {
        const cell = JSON.parse(await readFile(join(cellsDirectory, `${cellId}.json`), "utf8"));
        for (const field of ["planningSelection", "executionSelection", "repairSelection"]) {
          expect(cell[field], `${series}/${cellId}/${field}`).toEqual(manifest.executorSelection);
        }
      }
    }
  });

  it("rejects a series whose cells do not share the frozen executor selection", () => {
    const codex = wideGraphSelection("codex");
    const otherExecutor = { executorId: "other-cli", model: "other-model" };
    const cells = [
      {
        cellId: "warehouse-wide-n04",
        planningSelection: codex,
        executionSelection: codex,
        repairSelection: codex
      },
      {
        cellId: "warehouse-wide-n08",
        planningSelection: codex,
        executionSelection: otherExecutor,
        repairSelection: codex
      }
    ];

    expect(() => assertWideGraphSeriesSelection(cells, codex))
      .toThrow(/warehouse-wide-n08.+execution selection differs.+not comparable/iu);
  });

  it("freezes one executor selection in the manifest and every generated cell", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-executor-"));
    try {
      await run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs",
          "--target",
          "C:/target",
          "--executor",
          "codex",
          "--out",
          outDir
        ],
        { cwd: process.cwd(), windowsHide: true }
      );

      const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8"));
      const cells = await Promise.all(
        ["warehouse-wide-n04.json", "warehouse-wide-n08.json", "warehouse-wide-n16.json"]
          .map(async (name) => JSON.parse(await readFile(join(outDir, name), "utf8")))
      );
      const selection = { executorId: "codex-cli", model: "gpt-5.5", effort: "high" };

      expect(manifest.executorSelection).toEqual(selection);
      expect(cells.every((cell) =>
        ["planningSelection", "executionSelection", "repairSelection"]
          .every((field) => JSON.stringify(cell[field]) === JSON.stringify(selection))
      )).toBe(true);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

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
    expect(wideGraphSelection("codex")).toEqual({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" });
    expect(() => wideGraphSelection("claude")).toThrow(/unknown executor selection/iu);
    expect(() => wideGraphSelection("gemini")).toThrow(/unknown executor selection/iu);
  });
});
