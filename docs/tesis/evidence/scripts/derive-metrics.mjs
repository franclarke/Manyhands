#!/usr/bin/env node
/**
 * Derives every reported G5 number from the preserved raw artifacts.
 *
 * Nothing here is transcribed by hand: the inputs are the journals and result
 * files each cell produced, and the outputs are a raw CSV, a per-run markdown
 * table and an SVG figure. Re-running it over the same evidence must reproduce
 * the same files byte for byte, so a reviewer can check the reported numbers
 * against the evidence without trusting the prose.
 *
 * Deliberately absent: significance tests. With two observations per cell there
 * is no basis for p-values, and the protocol (§8) pre-registers that only
 * descriptive statistics are reported.
 *
 * Usage: node derive-metrics.mjs --runs <dir-of-cell-outputs> --out <dir>
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const COLUMNS = [
  "cellId", "position", "taskId", "condition", "repetition", "runId", "delivered", "lifecycle",
  "finalSha", "stopReason", "wallClockSeconds", "attempts", "repairs", "criteriaTotal",
  "criteriaSatisfied", "criteriaCoverage", "tokensTotal", "usageReportedAttempts",
  "usageMissingAttempts", "failureModes", "scopeViolations",
  "formulaVersion", "leafThreshold", "leafCount", "graphDepth", "branchingFactor",
  "coalescedUnits", "resplitDeclined"
];

const runsRoot = resolve(argOf("--runs") ?? "docs/tesis/evidence/experiment/runs");
const outDir = resolve(argOf("--out") ?? "docs/tesis/evidence/experiment");
await mkdir(outDir, { recursive: true });

const cells = [];
for (const entry of (await readdir(runsRoot, { withFileTypes: true })).filter((item) => item.isDirectory())) {
  const dir = join(runsRoot, entry.name);
  const result = await readJson(join(dir, "result.json"));
  const cell = await readJson(join(dir, "cell.json"));
  if (result === undefined || cell === undefined) continue;
  const events = await readEvents(join(dir, "run.events.v2.jsonl"));
  const granularity = await readJson(join(dir, "run.granularity-metrics.json"));
  cells.push(measure({ cell, result, events, granularity }));
}
cells.sort((left, right) => (left.position ?? 0) - (right.position ?? 0));

await writeFile(join(outDir, "raw-results.csv"), toCsv(cells), "utf8");
await writeFile(join(outDir, "results.md"), toMarkdown(cells), "utf8");
await writeFile(join(outDir, "results.svg"), toFigure(cells), "utf8");
process.stdout.write(`derived ${cells.length} cells -> raw-results.csv, results.md, results.svg\n`);

/** One row per run. Every field traces to a journal event or a stored file. */
function measure({ cell, result, events, granularity }) {
  const times = events.map((event) => Date.parse(event.occurredAt)).filter(Number.isFinite);
  const attempts = events.filter((event) => event.type === "attempt.started").length;
  const repairs = events.filter((event) =>
    event.type === "attempt.repair_attempted" || event.type === "integration.repair_attempted").length;
  const failures = events.filter((event) => event.type === "failure.classified");
  const matrices = events
    .filter((event) => event.type === "validation.completed" || event.type === "integration.completed")
    .map((event) => event.payload.matrix)
    .filter((matrix) => matrix !== undefined);
  const criteria = matrices.flatMap((matrix) => matrix.criteria ?? []);
  const satisfied = criteria.filter((criterion) => criterion.status === "satisfied").length;
  const assessed = events.find((event) => event.type === "planning.granularity_assessed")?.payload;
  // Cost is summed only from attempts whose provider actually reported it.
  // Mixing a reported figure with a registry estimate would produce a number
  // that answers neither question, so estimates are counted separately.
  const usages = events
    .filter((event) => event.type === "attempt.candidate_created" || event.type === "attempt.failed")
    .map((event) => event.payload.usage)
    .filter((usage) => usage !== undefined);
  const reported = usages.filter((usage) => usage.source === "reported");
  const usage = reported.reduce(
    (total, item) => total + (item.tokensTotal ?? ((item.tokensIn ?? 0) + (item.tokensOut ?? 0))),
    0
  );

  // `result.json` nests the terminal state under `outcome`; reading it one level
  // too shallow silently reported every cell as undelivered.
  const outcome = result.outcome ?? result;
  return {
    cellId: cell.cellId,
    position: cell.position,
    taskId: cell.taskId,
    condition: cell.condition,
    repetition: cell.repetition,
    runId: result.runId,
    // Primary: a delivery counts only with a confirmed receipt, never on
    // lifecycle alone.
    delivered: outcome.lifecycle === "completed" && outcome.receipt?.confirmed === true,
    lifecycle: outcome.lifecycle ?? "",
    finalSha: outcome.finalSha ?? "",
    stopReason: outcome.reason ?? "",
    wallClockSeconds: times.length >= 2 ? Math.round((Math.max(...times) - Math.min(...times)) / 1000) : "",
    attempts,
    repairs,
    criteriaTotal: criteria.length,
    criteriaSatisfied: satisfied,
    criteriaCoverage: criteria.length === 0 ? "" : round(satisfied / criteria.length, 3),
    tokensTotal: reported.length === 0 ? "" : usage,
    usageReportedAttempts: reported.length,
    usageMissingAttempts: usages.length - reported.length,
    failureModes: [...new Set(failures.map((event) => event.payload.observation?.code ?? "unknown"))].join("|"),
    scopeViolations: failures.filter((event) => event.payload.observation?.code === "scope_violation").length,
    formulaVersion: assessed?.formulaVersion ?? "",
    leafThreshold: assessed?.leafThreshold ?? "",
    leafCount: granularity?.metrics?.totalLeafCount ?? "",
    graphDepth: granularity?.metrics?.maxGraphDepth ?? "",
    branchingFactor: granularity?.metrics?.averageBranchingFactor ?? "",
    coalescedUnits: granularity?.metrics?.coalescedUnitsCount ?? "",
    resplitDeclined: (assessed?.criticDecisions ?? []).filter((decision) => decision.kind === "resplit_declined").length
  };
}

function toCsv(rows) {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((column) => csvCell(row[column])).join(","));
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function toMarkdown(rows) {
  const lines = [
    "<!-- GENERATED by docs/tesis/evidence/scripts/derive-metrics.mjs. Do not edit by hand. -->",
    "# G5 — Resultados por run",
    "",
    `Runs analizados: **${rows.length}**. Cada fila es un run individual; el`,
    "protocolo (§8.2) exige publicar los valores por run y no solo agregados.",
    "No se aplican pruebas de significancia (§8.1).",
    "",
    "## Runs",
    "",
    "| # | Tarea | Cond. | Rep. | Entregado | Wall-clock (s) | Intentos | Reparaciones | Criterios | Hojas | Modos de falla |",
    "|---|---|---|---|---|---|---|---|---|---|---|"
  ];
  for (const row of rows) {
    lines.push([
      row.position, row.taskId, row.condition, row.repetition,
      row.delivered ? "sí" : "no",
      row.wallClockSeconds, row.attempts, row.repairs,
      row.criteriaTotal === 0 ? "—" : `${row.criteriaSatisfied}/${row.criteriaTotal}`,
      row.leafCount === "" ? "—" : row.leafCount,
      row.failureModes === "" ? "—" : row.failureModes
    ].join(" | ").replace(/^/u, "| ").concat(" |"));
  }

  lines.push("", "## Por celda", "", "| Tarea | Cond. | Entregas | Wall-clock por run (s) | Hojas por run |", "|---|---|---|---|---|");
  for (const task of ["T1", "T2"]) {
    for (const condition of ["A", "B", "C"]) {
      const group = rows.filter((row) => row.taskId === task && row.condition === condition);
      if (group.length === 0) continue;
      lines.push(`| ${task} | ${condition} | ${group.filter((row) => row.delivered).length}/${group.length} | ${group.map((row) => row.wallClockSeconds).join(", ")} | ${group.map((row) => row.leafCount).join(", ")} |`);
    }
  }

  // §8.4 — a cell whose repetitions disagree is itself a reportable result.
  const split = [];
  for (const task of ["T1", "T2"]) {
    for (const condition of ["A", "B", "C"]) {
      const group = rows.filter((row) => row.taskId === task && row.condition === condition);
      if (group.length >= 2 && new Set(group.map((row) => row.delivered)).size > 1) {
        split.push(`${task}/${condition}`);
      }
    }
  }
  lines.push("", "## Discrepancia interna (§8.4)", "");
  lines.push(split.length === 0
    ? "Ninguna celda discrepa entre repeticiones en la métrica primaria."
    : `Celdas cuyas repeticiones discrepan en la entrega verificada: **${split.join(", ")}**. Para esas celdas la varianza del planificador domina sobre el efecto de la condición.`);
  return `${lines.join("\n")}\n`;
}

/** A small dot plot: one mark per run, so nothing is hidden behind a mean. */
function toFigure(rows) {
  const width = 720;
  const rowHeight = 34;
  const groups = [];
  for (const task of ["T1", "T2"]) {
    for (const condition of ["A", "B", "C"]) {
      groups.push({ label: `${task} · ${condition}`, runs: rows.filter((row) => row.taskId === task && row.condition === condition) });
    }
  }
  const height = 70 + groups.length * rowHeight;
  const maxSeconds = Math.max(1, ...rows.map((row) => Number(row.wallClockSeconds) || 0));
  const left = 90;
  const right = width - 30;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" font-family="serif" font-size="12">`,
    `<text x="${left}" y="22" font-size="14">Duración wall-clock por run (cada punto es un run)</text>`,
    `<line x1="${left}" y1="${height - 30}" x2="${right}" y2="${height - 30}" stroke="#333"/>`,
    `<text x="${right}" y="${height - 14}" text-anchor="end">${maxSeconds}s</text>`,
    `<text x="${left}" y="${height - 14}">0</text>`
  ];
  groups.forEach((group, index) => {
    const y = 50 + index * rowHeight;
    parts.push(`<text x="${left - 8}" y="${y + 4}" text-anchor="end">${group.label}</text>`);
    for (const run of group.runs) {
      const seconds = Number(run.wallClockSeconds) || 0;
      const x = left + (seconds / maxSeconds) * (right - left);
      const fill = run.delivered ? "#1a7f37" : "#b42318";
      parts.push(`<circle cx="${round(x, 1)}" cy="${y}" r="5" fill="${fill}"><title>${run.cellId}: ${seconds}s, ${run.delivered ? "entregado" : run.lifecycle}</title></circle>`);
    }
  });
  parts.push(`<text x="${left}" y="${height - 46}" font-size="11">verde = entrega verificada · rojo = no entregado</text>`, "</svg>");
  return `${parts.join("\n")}\n`;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

async function readEvents(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  return raw.split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const record = JSON.parse(line);
      return record.event ?? record;
    });
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function argOf(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
