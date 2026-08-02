import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { deriveG6Results } from "./derive-g6-results.mjs";

test("derives canonical cells, prefers the latest attributable remediation, and is reproducible", async () => {
  const root = await mkdtemp(join(tmpdir(), "g6-results-fixture-"));
  const cellsRoot = join(root, "cells");
  const runsRoot = join(root, "runs");
  const outputRoot = join(root, "output");
  await mkdir(cellsRoot, { recursive: true });
  await mkdir(runsRoot, { recursive: true });

  await writeJson(join(cellsRoot, "g6-01-T1-A-r1.json"), {
    cellId: "g6-01-T1-A-r1", position: 1, taskId: "T1", condition: "A", repetition: 1
  });
  await writeJson(join(cellsRoot, "g6-02-T1-C-r1.json"), {
    cellId: "g6-02-T1-C-r1", position: 2, taskId: "T1", condition: "C", repetition: 1
  });

  await writeRun(runsRoot, "g6-01-T1-A-r1", {
    cellId: "g6-01-T1-A-r1", position: 1, taskId: "T1", condition: "A", repetition: 1
  }, {
    runId: "run-old", lifecycle: "completed", finalSha: "a".repeat(40),
    started: "2026-01-01T00:00:00.000Z", finished: "2026-01-01T00:00:01.000Z"
  }, { satisfied: 1, total: 10 }, 1, 0.1, 10, 0.05);
  await writeRun(runsRoot, "g6-01-T1-A-r1-remediation-1", {
    cellId: "g6-01-T1-A-r1-remediation-1", position: 1, taskId: "T1", condition: "A", repetition: 1
  }, {
    runId: "run-new", lifecycle: "completed", finalSha: "b".repeat(40),
    started: "2026-01-02T00:00:00.000Z", finished: "2026-01-02T00:00:03.000Z"
  }, { satisfied: 8, total: 10 }, 2, 0.25, 20, 0.1);
  await writeRun(runsRoot, "g6-02-T1-C-r1-remediation-1", {
    cellId: "g6-02-T1-C-r1-remediation-1", position: 2, taskId: "T1", condition: "C", repetition: 1
  }, {
    runId: "run-blocked", lifecycle: "waiting_for_input", finalSha: undefined,
    started: "2026-01-03T00:00:00.000Z", finished: "2026-01-03T00:00:02.000Z",
    reason: "clarification_required"
  }, undefined, undefined, undefined, undefined, undefined, "clarification_required");

  try {
    await deriveG6Results({ cellsRoot, runsRoot, outputRoot });
    const rows = JSON.parse(await readFile(join(outputRoot, "results.json"), "utf8"));
    const summary = JSON.parse(await readFile(join(outputRoot, "summary.json"), "utf8"));
    assert.deepEqual(rows.map((row) => row.cellId), ["g6-01-T1-A-r1", "g6-02-T1-C-r1"]);
    assert.equal(rows[0].runId, "run-new");
    assert.equal(rows[0].coverage, 0.8);
    assert.equal(rows[0].splitAdvantage, 0.25);
    assert.equal(rows[0].tokens, 20);
    assert.equal(rows[0].costUsd, 0.1);
    assert.equal(rows[1].classification, "not_attributable");
    assert.equal(rows[1].coverage, null);
    assert.equal(summary.conditions.A.mean, 0.8);
    assert.equal(summary.conditions.C.observed, 0);

    const first = await readOutputs(outputRoot);
    await deriveG6Results({ cellsRoot, runsRoot, outputRoot });
    assert.deepEqual(await readOutputs(outputRoot), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function writeRun(runsRoot, name, cell, result, verdict, leafCount, splitAdvantage, tokens, costUsd, failureCode) {
  const dir = join(runsRoot, name);
  await mkdir(dir, { recursive: true });
  await writeJson(join(dir, "cell.json"), cell);
  await writeJson(join(dir, "result.json"), { cellId: cell.cellId, runId: result.runId, started: result.started, finished: result.finished, outcome: result });
  if (verdict) await writeJson(join(dir, "external-verdict.json"), { total: verdict.total, satisfied: verdict.satisfied });
  await writeJson(join(dir, "run.granularity-metrics.json"), { metrics: { totalLeafCount: leafCount } });
  const events = [
    { event: { occurredAt: result.started, type: "planning.granularity_strategy_selected", payload: { candidateTree: { root: { key: "root" } }, assessments: [{ unitKey: "root", splitAdvantage }] } } }
  ];
  if (tokens !== undefined) {
    events.push({ event: { occurredAt: result.finished, type: "attempt.candidate_created", payload: { usage: { tokensTotal: tokens, costUsd, source: "reported" } } } });
  }
  if (failureCode) {
    events.push({ event: { occurredAt: result.finished, type: "failure.classified", payload: { observation: { code: failureCode } } } });
  }
  await writeFile(join(dir, "run.events.v2.jsonl"), `${events.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readOutputs(outputRoot) {
  const names = ["results.csv", "results.json", "summary.json", "results.md"];
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await readFile(join(outputRoot, name), "utf8")] )));
}
