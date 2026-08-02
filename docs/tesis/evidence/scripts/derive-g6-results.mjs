#!/usr/bin/env node

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const CSV_COLUMNS = [
  "cellId", "position", "taskId", "condition", "repetition", "runId", "lifecycle",
  "classification", "finalSha", "criteriaSatisfied", "criteriaTotal", "coverage",
  "leafCount", "splitAdvantage", "durationSeconds", "tokens", "costUsd", "failureModes",
  "sourceRun"
];

export const DEFAULT_G6_CELLS_ROOT = "docs/tesis/evidence/g6/cells";
export const DEFAULT_G6_RUNS_ROOT = "docs/tesis/evidence/g6/canonical-runs";
export const DEFAULT_G6_OUTPUT_ROOT = "docs/tesis/evidence/g6";

export async function deriveG6Results({ cellsRoot, runsRoot, outputRoot }) {
  const manifests = await readManifests(resolve(cellsRoot));
  const runs = await readRuns(resolve(runsRoot));
  const rows = manifests
    .map((manifest) => selectRun(manifest, runs))
    .map(({ manifest, run }) => measureRow(manifest, run))
    .sort((left, right) => left.position - right.position || left.cellId.localeCompare(right.cellId));

  const summary = summarize(rows);
  const output = resolve(outputRoot);
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "results.csv"), toCsv(rows), "utf8");
  await writeFile(join(output, "results.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  await writeFile(join(output, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(join(output, "results.md"), toMarkdown(rows, summary), "utf8");
  return { rows, summary };
}

async function readManifests(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const manifests = [];
  for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort(byName)) {
    manifests.push(await readJson(join(root, entry.name)));
  }
  return manifests;
}

async function readRuns(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const runs = [];
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.endsWith("-planning")).sort(byName)) {
    const dir = join(root, entry.name);
    const cell = await readJsonIfPresent(join(dir, "cell.json"));
    const result = await readJsonIfPresent(join(dir, "result.json"));
    if (!cell || !result) continue;
    const verdict = await readJsonIfPresent(join(dir, "external-verdict.json"))
      ?? await readJsonIfPresent(join(dir, "oracle-result.json"));
    const events = await readEvents(join(dir, "run.events.v2.jsonl"));
    const granularity = await readJsonIfPresent(join(dir, "run.granularity-metrics.json"));
    runs.push({ name: entry.name, dir, cell, result, verdict, events, granularity });
  }
  return runs;
}

function selectRun(manifest, runs) {
  const canonical = canonicalCellId(manifest.cellId);
  const matching = runs
    .filter((run) => canonicalCellId(run.cell.cellId) === canonical)
    .sort((left, right) => finishedAt(right) - finishedAt(left) || right.name.localeCompare(left.name));
  const attributable = matching.filter(isAttributable);
  return { manifest, run: attributable[0] ?? matching[0] };
}

function measureRow(manifest, run) {
  const outcome = run?.result?.outcome ?? run?.result ?? {};
  const verdict = run?.verdict;
  const criteriaTotal = numberOrNull(verdict?.total);
  const criteriaSatisfied = numberOrNull(verdict?.satisfied);
  const coverage = criteriaTotal === null || criteriaTotal === 0 || criteriaSatisfied === null
    ? null
    : round(criteriaSatisfied / criteriaTotal, 3);
  const usage = measureUsage(run?.events ?? []);
  const failureModes = measureFailureModes(run, verdict);
  return {
    cellId: manifest.cellId,
    position: manifest.position ?? null,
    taskId: manifest.taskId ?? null,
    condition: manifest.condition ?? null,
    repetition: manifest.repetition ?? null,
    runId: run?.result?.runId ?? null,
    lifecycle: outcome.lifecycle ?? null,
    classification: isAttributable(run) ? "attributable" : "not_attributable",
    finalSha: outcome.finalSha ?? null,
    criteriaSatisfied,
    criteriaTotal,
    coverage,
    leafCount: run?.granularity?.metrics?.totalLeafCount ?? null,
    splitAdvantage: rootSplitAdvantage(run?.events ?? []),
    durationSeconds: durationSeconds(run?.result),
    tokens: usage.tokens,
    costUsd: usage.costUsd,
    failureModes,
    sourceRun: run?.name ?? null
  };
}

function isAttributable(run) {
  const outcome = run?.result?.outcome ?? run?.result ?? {};
  return outcome.lifecycle === "completed" && typeof outcome.finalSha === "string" && Boolean(run?.verdict);
}

function canonicalCellId(cellId) {
  return String(cellId ?? "").replace(/-remediation-\d+(?:-(?:full|planning))?$/u, "");
}

function finishedAt(run) {
  const value = run?.result?.finished ?? run?.result?.outcome?.finished;
  const timestamp = Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? timestamp : -Infinity;
}

function measureUsage(events) {
  const usages = events
    .filter((event) => event.type === "attempt.candidate_created" || event.type === "attempt.failed")
    .map((event) => event.payload?.usage)
    .filter((usage) => usage?.source === "reported");
  if (usages.length === 0) return { tokens: null, costUsd: null };
  const tokens = usages.reduce((sum, usage) => sum + (usage.tokensTotal ?? (usage.tokensIn ?? 0) + (usage.tokensOut ?? 0)), 0);
  const costUsd = usages.every((usage) => Number.isFinite(usage.costUsd))
    ? round(usages.reduce((sum, usage) => sum + usage.costUsd, 0), 7)
    : null;
  return { tokens, costUsd };
}

function rootSplitAdvantage(events) {
  const selected = events.find((event) => event.type === "planning.granularity_strategy_selected");
  if (!selected) return null;
  const rootKey = selected.payload?.candidateTree?.root?.key;
  const assessment = (selected.payload?.assessments ?? []).find((item) => item.unitKey === rootKey);
  return numberOrNull(assessment?.splitAdvantage);
}

function durationSeconds(result) {
  const start = Date.parse(result?.started ?? "");
  const finish = Date.parse(result?.finished ?? "");
  return Number.isFinite(start) && Number.isFinite(finish) ? round((finish - start) / 1000, 3) : null;
}

function measureFailureModes(run, verdict) {
  const modes = [];
  for (const criterion of verdict?.criteria ?? []) {
    if (criterion.satisfied === false) modes.push(`criterion:${criterion.id}`);
  }
  for (const event of run?.events ?? []) {
    const code = event.type === "failure.classified" ? event.payload?.observation?.code : undefined;
    if (code) modes.push(`failure:${code}`);
  }
  return [...new Set(modes)];
}

function summarize(rows) {
  const conditions = {};
  for (const condition of ["A", "B", "C"]) {
    const group = rows.filter((row) => row.condition === condition);
    const values = group.map((row) => row.coverage).filter((value) => value !== null);
    const mean = values.length === 0 ? null : round(values.reduce((sum, value) => sum + value, 0) / values.length, 3);
    const min = values.length === 0 ? null : Math.min(...values);
    const max = values.length === 0 ? null : Math.max(...values);
    const dispersion = values.length === 0 ? null : round(Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length), 3);
    conditions[condition] = {
      condition,
      repetitions: group.length,
      observed: values.length,
      notAttributable: group.length - values.length,
      values,
      mean,
      min,
      max,
      range: values.length === 0 ? null : round(max - min, 3),
      dispersion
    };
  }
  return { schemaVersion: 1, primaryMetric: "coverage", rowCount: rows.length, conditions };
}

function toCsv(rows) {
  return `${[CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(","))].join("\n")}\n`;
}

function toMarkdown(rows, summary) {
  const lines = [
    "<!-- GENERATED by derive-g6-results.mjs. Do not edit by hand. -->",
    "# G6 — Resultados derivados",
    "",
    `Filas canónicas: **${rows.length}**. Métrica primaria: cobertura de criterios externos satisfechos.`,
    "Las filas sin candidate atribuible conservan `coverage: null` y clasificación `not_attributable`.",
    "",
    "## Por celda",
    "",
    "| Celda | Cond. | Rep. | Lifecycle | Clasificación | Criterios | Cobertura | Hojas | splitAdvantage raíz | Duración (s) | Tokens | Costo (USD) | Modos de falla |",
    "|---|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|"
  ];
  for (const row of rows) {
    const criteria = row.criteriaTotal === null ? "null" : `${row.criteriaSatisfied}/${row.criteriaTotal}`;
    const coverage = row.coverage === null ? "null" : row.coverage;
    lines.push(`| ${row.cellId} | ${row.condition} | ${row.repetition} | ${row.lifecycle ?? "null"} | ${row.classification} | ${criteria} | ${coverage} | ${row.leafCount ?? "null"} | ${row.splitAdvantage ?? "null"} | ${row.durationSeconds ?? "null"} | ${row.tokens ?? "null"} | ${row.costUsd ?? "null"} | ${row.failureModes.join(", ") || "—"} |`);
  }
  lines.push("", "## Por condición", "", "| Condición | Repeticiones | Observadas | No atribuibles | Valores | Media | Mín. | Máx. | Rango | Dispersión |", "|---|---:|---:|---:|---|---:|---:|---:|---:|---:|");
  for (const condition of ["A", "B", "C"]) {
    const item = summary.conditions[condition];
    lines.push(`| ${condition} | ${item.repetitions} | ${item.observed} | ${item.notAttributable} | ${item.values.join(", ") || "—"} | ${item.mean ?? "null"} | ${item.min ?? "null"} | ${item.max ?? "null"} | ${item.range ?? "null"} | ${item.dispersion ?? "null"} |`);
  }
  lines.push("", "## Qué no se concluye", "", "- Estas tablas no confirman ni falsan H-G6; sólo derivan la métrica registrada.", "- Las filas `not_attributable` no se convierten en cero ni se eliminan.", "- Con dos repeticiones por condición no se hace inferencia estadística.", "");
  return lines.join("\n");
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJsonIfPresent(path) {
  try { return await readJson(path); } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readEvents(path) {
  const text = await readFile(path, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  return text.split(/\r?\n/u).filter(Boolean).map((line) => {
    const parsed = JSON.parse(line);
    return parsed.event ?? parsed;
  });
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function csvCell(value) {
  if (value === null || value === undefined) return "null";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function byName(left, right) {
  return left.name.localeCompare(right.name);
}

if (process.argv[1] && process.argv[1].endsWith("derive-g6-results.mjs")) {
  const cellsRoot = argument("--cells") ?? DEFAULT_G6_CELLS_ROOT;
  const runsRoot = argument("--runs") ?? DEFAULT_G6_RUNS_ROOT;
  const outputRoot = argument("--out") ?? DEFAULT_G6_OUTPUT_ROOT;
  const { rows } = await deriveG6Results({ cellsRoot, runsRoot, outputRoot });
  process.stdout.write(`derived ${rows.length} canonical G6 cells\n`);
}

function argument(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
