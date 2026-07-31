import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  /**
   * Claude was added for the H1 measurement after Codex became unusable on the
   * study machine. A different executor produces a different candidate tree, so
   * its cells are NOT comparable with the frozen Codex series. The generator has
   * to refuse to emit them as an ordinary delivery series: a series that changes
   * the controlled variable must say so durably, or a later synthesis will read
   * both as one sweep.
   */
  it("refuses a non-Codex series that does not declare itself a measurement", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-undeclared-measurement-"));
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
        stderr: expect.stringMatching(/claude.+not comparable.+--kind measurement/iu)
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("rejects an executor the registry does not know", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-unavailable-executor-"));
    try {
      await expect(run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs",
          "--target",
          "C:/target",
          "--executor",
          "gemini",
          "--out",
          outDir
        ],
        { cwd: process.cwd(), windowsHide: true }
      )).rejects.toMatchObject({
        stderr: expect.stringMatching(/Unknown executor selection "gemini".+expected one of codex, claude/iu)
      });
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  /**
   * A measurement series stops at the compiled plan, so it can never produce a
   * candidate. Declaring that in the manifest is what keeps `not_run` honest:
   * the oracle was not skipped, it had nothing to grade.
   */
  it("freezes a measurement series as planning-only and not comparable", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-measurement-"));
    try {
      await run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/generate-wide-graph-cells.mjs",
          "--target",
          "C:/target",
          "--executor",
          "claude",
          "--kind",
          "measurement",
          "--out",
          outDir
        ],
        { cwd: process.cwd(), windowsHide: true }
      );

      const manifest = JSON.parse(await readFile(join(outDir, "manifest.json"), "utf8"));
      const selection = { executorId: "claude-code-cli", model: "haiku" };

      expect(manifest.seriesKind).toBe("measurement");
      expect(manifest.stopAfter).toBe("planning");
      expect(manifest.comparableWith).toEqual([]);
      expect(manifest.executorSelection).toEqual(selection);

      for (const { cellId } of manifest.cells) {
        const cell = JSON.parse(await readFile(join(outDir, `${cellId}.json`), "utf8"));
        expect(cell.seriesKind, cellId).toBe("measurement");
        expect(cell.stopAfter, cellId).toBe("planning");
        expect(cell.planningSelection, cellId).toEqual(selection);
        expect(cell.executionSelection, cellId).toEqual(selection);
        expect(cell.repairSelection, cellId).toEqual(selection);
      }
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("keeps a delivery series comparable and free of a stop point", async () => {
    const outDir = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-delivery-kind-"));
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

      expect(manifest.seriesKind).toBe("delivery");
      expect(manifest.stopAfter).toBeUndefined();
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

      expect(manifest.schemaVersion).toBe(2);
      expect(manifest.protocol).toEqual({ id: "warehouse-wide-graph", version: 2 });
      expect(manifest.executorSelection).toEqual(selection);
      expect(manifest.granularityCondition).toBe("C");
      expect(manifest.oracleContract).toMatchObject({
        oracleId: "warehouse-wide-graph-v2",
        oracleContractVersion: 2,
        contractSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        criterionMappings: expect.arrayContaining([
          expect.objectContaining({ criterionId: "projection-values" }),
          expect.objectContaining({ criterionId: "projection-order" })
        ])
      });
      expect(cells.every((cell) =>
        ["planningSelection", "executionSelection", "repairSelection"]
          .every((field) => JSON.stringify(cell[field]) === JSON.stringify(selection))
      )).toBe(true);
      expect(cells.every((cell) =>
        JSON.stringify(cell.oracleContract) === JSON.stringify(manifest.oracleContract)
      )).toBe(true);
      expect(cells.every((cell) => cell.schemaVersion === 2)).toBe(true);
      expect(cells.every((cell) =>
        JSON.stringify(cell.protocol) === JSON.stringify(manifest.protocol)
      )).toBe(true);
      expect(cells.every((cell) =>
        cell.condition === "C" && cell.granularityCondition === "C"
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
    expect(wideGraphSelection("claude")).toEqual({ executorId: "claude-code-cli", model: "haiku" });
    expect(() => wideGraphSelection("gemini")).toThrow(/unknown executor selection/iu);
  });
});

/**
 * The measurement the thesis still needs is produced by planning alone: the
 * granularity assessment is journalled before the approval decision is raised.
 * Driving past that point would spend a full execution to learn nothing new,
 * so the cell stops at the compiled plan — and it must stop by *not answering*,
 * because answering `approve` is what starts execution.
 */
describe("planning-only measurement cell", () => {
  it("stops at the compiled plan without approving it", async () => {
    const root = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-planning-only-"));
    const runsDir = join(root, "runs");
    const outDir = join(root, "out");
    const runId = "11111111-2222-3333-4444-555555555555";
    const posts: string[] = [];
    await mkdir(runsDir, { recursive: true });
    await writeFile(
      join(runsDir, `${runId}.events.v2.jsonl`),
      `${JSON.stringify({
        schemaVersion: 4,
        event: {
          eventId: `${runId}:decision:1`,
          runId,
          sequence: 1,
          occurredAt: "2026-07-30T00:00:00.000Z",
          type: "decision.raised",
          payload: {
            decision: {
              id: "approve-plan:graph-measurement:r1",
              kind: "approve_plan",
              question: "Approve graph revision 1?",
              options: [{ id: "approve", label: "Approve plan" }]
            }
          }
        }
      })}\n`,
      "utf8"
    );

    const server = createServer((request, response) => {
      if (request.method === "POST") posts.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ lifecycle: "needs_approval" }));
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const port = (server.address() as AddressInfo).port;

    const configPath = join(root, "cell.json");
    await writeFile(configPath, JSON.stringify({
      cellId: "warehouse-wide-n04",
      condition: "C",
      taskId: "warehouse-wide-graph",
      moduleCount: 4,
      seriesKind: "measurement",
      stopAfter: "planning",
      baseUrl: `http://127.0.0.1:${port}`,
      runsDir,
      pollIntervalMs: 50
    }), "utf8");

    try {
      const outcome = await run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/run-experiment.mjs",
          "--config",
          configPath,
          "--out",
          outDir,
          "--attach",
          runId
        ],
        { cwd: process.cwd(), windowsHide: true, env: { ...process.env, MANYHANDS_SESSION_TOKEN: "test-token" } }
      ).catch((error: unknown) => error as { code?: number });

      expect((outcome as { code?: number }).code).toBe(1);
      expect(posts).toEqual([]);

      const result = JSON.parse(await readFile(join(outDir, "result.json"), "utf8"));
      expect(result.outcome.reason).toBe("measurement_only_planning");
      expect(result.outcome.finalSha).toBeUndefined();
      expect(result.outcome.lifecycle).toBe("needs_approval");
    } finally {
      await new Promise<void>((closed) => server.close(() => closed()));
      await rm(root, { recursive: true, force: true });
    }
  });
});

/**
 * `retry-11` lost three cells to an owner process that died mid-attempt: the
 * run stayed `running` with a frozen heartbeat and the driver kept polling until
 * someone labelled the cell by hand. An unattributable cell is worse than a
 * failed one, so the driver has to notice the dead owner and record a terminal
 * result itself. The heartbeat cadence is 4 s, so a minute of silence is not a
 * slow step.
 */
describe("stalled run owner", () => {
  it("records an attributable terminal result instead of polling a dead owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "manyhands-wide-graph-stalled-owner-"));
    const runsDir = join(root, "runs");
    const outDir = join(root, "out");
    const runId = "99999999-8888-7777-6666-555555555555";
    await mkdir(runsDir, { recursive: true });
    await writeFile(join(runsDir, `${runId}.events.v2.jsonl`), "", "utf8");
    await writeFile(join(runsDir, `${runId}.json`), JSON.stringify({
      version: 2,
      run: {
        runId,
        projection: { lifecycle: "running", eventSequence: 29 },
        activeOperation: {
          operationId: "dead-owner",
          kind: "execution",
          fencingToken: 3,
          acquiredAt: "2026-07-30T00:47:21.514Z",
          heartbeatAt: "2026-07-30T00:54:22.432Z"
        },
        heartbeatAt: "2026-07-30T00:54:22.432Z"
      }
    }), "utf8");

    const posts: string[] = [];
    const server = createServer((request, response) => {
      if (request.method === "POST") posts.push(request.url ?? "");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ lifecycle: "running" }));
    });
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const port = (server.address() as AddressInfo).port;

    const configPath = join(root, "cell.json");
    await writeFile(configPath, JSON.stringify({
      cellId: "warehouse-wide-n04",
      condition: "C",
      taskId: "warehouse-wide-graph",
      moduleCount: 4,
      baseUrl: `http://127.0.0.1:${port}`,
      runsDir,
      pollIntervalMs: 50,
      ownerHeartbeatStaleMs: 60_000
    }), "utf8");

    try {
      const outcome = await run(
        process.execPath,
        [
          "docs/tesis/evidence/scripts/run-experiment.mjs",
          "--config",
          configPath,
          "--out",
          outDir,
          "--attach",
          runId
        ],
        { cwd: process.cwd(), windowsHide: true, env: { ...process.env, MANYHANDS_SESSION_TOKEN: "test-token" } }
      ).catch((error: unknown) => error as { code?: number });

      expect((outcome as { code?: number }).code).toBe(1);

      const result = JSON.parse(await readFile(join(outDir, "result.json"), "utf8"));
      expect(result.outcome.reason).toMatch(/owner.+heartbeat/iu);
      expect(result.outcome.reason).toContain("2026-07-30T00:54:22.432Z");
      expect(result.outcome.lifecycle).toBe("running");

      // Detectarlo no alcanza: si nadie reclama la operación vencida, el run
      // queda `running` para siempre y la celda no es atribuible del lado del
      // producto. El driver lo lleva a un estado terminal antes de irse.
      expect(posts).toContain(`/api/runs/${runId}/cancel`);
      expect(result.outcome.abandonedRunCancelled).toBe(true);
    } finally {
      await new Promise<void>((closed) => server.close(() => closed()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
