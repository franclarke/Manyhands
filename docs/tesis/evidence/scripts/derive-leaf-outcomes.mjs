#!/usr/bin/env node
/**
 * Deriva, desde los journals preservados, una fila por **intento de hoja** con
 * su tamaño declarado y su resultado terminal.
 *
 * Existe para responder la única parte de PI-2 que no estaba medida: qué hace
 * que una hoja sea implementable por un agente. Los proxies operativos del
 * sistema son las rutas planificadas y el alcance permitido, y ninguno estaba
 * anclado contra resultados reales.
 *
 * Es descriptivo por construcción. Las filas provienen de series con estímulos,
 * ejecutores y versiones distintas, así que la comparación no controla nada: no
 * autoriza inferencia, sólo describe lo observado. Toda cifra se deriva acá y
 * ninguna se transcribe a mano.
 *
 *   node docs/tesis/evidence/scripts/derive-leaf-outcomes.mjs \
 *     --evidence docs/tesis/evidence --out docs/tesis/evidence/leaf-outcomes
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const evidenceRoot = resolve(argOf("--evidence") ?? "docs/tesis/evidence");
const outDir = resolve(argOf("--out") ?? "docs/tesis/evidence/leaf-outcomes");

const journals = await findJournals(evidenceRoot);
const rows = [];
for (const journalPath of journals) {
  const events = await readJournal(journalPath);
  if (events.length === 0) continue;
  rows.push(...leafRows(journalPath, events));
}

rows.sort((left, right) => `${left.journal}${left.attemptId}`.localeCompare(`${right.journal}${right.attemptId}`));
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "leaf-outcomes.json"), `${JSON.stringify(rows, null, 2)}\n`, "utf8");
await writeFile(join(outDir, "leaf-outcomes.csv"), toCsv(rows), "utf8");
await writeFile(join(outDir, "summary.json"), `${JSON.stringify(summarize(rows), null, 2)}\n`, "utf8");
process.stdout.write(`${rows.length} leaf attempts from ${journals.length} journals -> ${outDir}\n`);

/**
 * Un intento de hoja se identifica por `attempt.started`; su resultado terminal
 * es el candidato creado o el fallo clasificado. Un intento sin hecho terminal
 * se conserva como `none`: es exactamente el caso que dejó celdas sin resultado
 * atribuible, y ocultarlo falsearía la tabla.
 */
function leafRows(journalPath, events) {
  const plannedPaths = plannedPathsByUnit(events);
  const scopePaths = scopePathsByNode(events);
  const unitKeyByNode = unitKeyByNodeId(events);
  const attempts = new Map();
  for (const event of events) {
    const payload = event.payload ?? {};
    const attemptId = payload.attemptId;
    if (attemptId === undefined) continue;
    if (event.type === "attempt.started") {
      const nodeId = payload.nodeId;
      const unitKey = unitKeyByNode.get(nodeId);
      attempts.set(attemptId, {
        journal: journalPath.replaceAll("\\", "/"),
        attemptId,
        nodeId,
        unitKey: unitKey ?? null,
        plannedPaths: unitKey === undefined ? null : plannedPaths.get(unitKey) ?? null,
        scopePaths: scopePaths.get(nodeId) ?? null,
        executorId: payload.executorProfile?.id ?? null,
        outcome: "none",
        changedFiles: null,
        tokensTotal: null,
        failureReason: null
      });
      continue;
    }
    const row = attempts.get(attemptId);
    if (row === undefined) continue;
    if (event.type === "attempt.candidate_created") {
      row.outcome = "candidate";
      row.changedFiles = (payload.changedFiles ?? []).length;
      row.tokensTotal = payload.usage?.tokensTotal ?? null;
    } else if (event.type === "attempt.failed") {
      row.outcome = "failed";
      row.failureReason = (payload.reason ?? "").slice(0, 200);
      row.tokensTotal = payload.usage?.tokensTotal ?? row.tokensTotal;
    } else if (event.type === "attempt.discarded") {
      row.outcome = "discarded";
      row.failureReason = (payload.reason ?? "").slice(0, 200);
    }
  }
  return [...attempts.values()];
}

function plannedPathsByUnit(events) {
  const sizes = new Map();
  for (const event of events) {
    if (event.type !== "planning.granularity_strategy_selected") continue;
    const root = event.payload?.candidateTree?.root;
    if (root === undefined) continue;
    const walk = (unit) => {
      sizes.set(unit.key, (unit.plannedPaths ?? []).length);
      for (const child of unit.children ?? []) walk(child);
    };
    walk(root);
  }
  return sizes;
}

function scopePathsByNode(events) {
  const sizes = new Map();
  for (const event of events) {
    if (event.type !== "graph.compiled") continue;
    for (const bundle of event.payload?.contracts ?? []) {
      const nodeId = bundle.task?.nodeId;
      if (nodeId === undefined) continue;
      sizes.set(nodeId, (bundle.scope?.allowedPaths ?? []).length);
    }
  }
  return sizes;
}

/** El id de nodo compilado lleva el `unitKey` del árbol candidato como prefijo. */
function unitKeyByNodeId(events) {
  const keys = new Set(plannedPathsByUnit(events).keys());
  const byNode = new Map();
  for (const event of events) {
    if (event.type !== "graph.compiled") continue;
    for (const nodeId of Object.keys(event.payload?.graph?.nodes ?? {})) {
      const match = [...keys]
        .filter((key) => nodeId.startsWith(`node-${key}-`))
        .sort((left, right) => right.length - left.length)[0];
      if (match !== undefined) byNode.set(nodeId, match);
    }
  }
  return byNode;
}

function summarize(rows) {
  const byOutcome = {};
  for (const row of rows) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + 1;
  const distribution = (outcome, field) => {
    const values = rows
      .filter((row) => row.outcome === outcome && Number.isInteger(row[field]))
      .map((row) => row[field])
      .sort((left, right) => left - right);
    if (values.length === 0) return null;
    return {
      n: values.length,
      min: values[0],
      median: values[Math.floor(values.length / 2)],
      max: values[values.length - 1]
    };
  };
  const fields = ["plannedPaths", "scopePaths", "changedFiles", "tokensTotal"];
  const outcomes = Object.keys(byOutcome);
  return {
    journals: new Set(rows.map((row) => row.journal)).size,
    attempts: rows.length,
    byOutcome,
    distributions: Object.fromEntries(fields.map((field) => [
      field,
      Object.fromEntries(outcomes.map((outcome) => [outcome, distribution(outcome, field)]))
    ])),
    failureReasons: rows.filter((row) => row.outcome === "failed").map((row) => row.failureReason),
    failureClasses: classifyFailures(rows)
  };
}

/**
 * Clasifica cada fallo de hoja por si el tamaño de la unidad podría explicarlo.
 *
 * Un fallo de pool de worktrees o un ejecutor que sale sin causa reconocible le
 * habría ocurrido a una hoja de cualquier tamaño; contarlos junto a los demás
 * inflaría cualquier separación por tamaño que se quiera leer en la tabla.
 */
function classifyFailures(rows) {
  const classes = {};
  const attributable = {};
  for (const row of rows) {
    if (row.outcome !== "failed") continue;
    const reason = row.failureReason ?? "";
    const kind = /worktree|pool/iu.test(reason) ? "infrastructure"
      : /executor_error/iu.test(reason) ? "executor"
      : /timeout/iu.test(reason) ? "timeout"
      : /scope_violation/iu.test(reason) ? "scope_violation"
      : /empty_diff/iu.test(reason) ? "product_defect"
      : "other";
    classes[kind] = (classes[kind] ?? 0) + 1;
    // Sólo el vencimiento de tiempo y la violación de alcance admiten una
    // lectura por tamaño de la unidad.
    if (kind === "timeout" || kind === "scope_violation") {
      attributable[kind] = [...(attributable[kind] ?? []), row.scopePaths];
    }
  }
  return { classes, scopePathsOfSizeAttributableFailures: attributable };
}

async function findJournals(root) {
  const found = [];
  const walk = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith(".events.v2.jsonl")) found.push(full);
    }
  };
  await walk(root);
  return found.sort();
}

async function readJournal(path) {
  const raw = await readFile(path, "utf8").catch(() => "");
  const events = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const record = JSON.parse(line);
      events.push(record.event ?? record);
    } catch {
      // Una línea ilegible se omite; el journal preservado no se modifica.
    }
  }
  return events;
}

function toCsv(rows) {
  if (rows.length === 0) return "\n";
  const columns = Object.keys(rows[0]);
  const escape = (value) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(","), ...rows.map((row) => columns.map((column) => escape(row[column])).join(","))].join("\n") + "\n";
}

function argOf(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}
