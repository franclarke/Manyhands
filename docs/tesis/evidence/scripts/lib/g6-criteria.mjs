/**
 * Criterios externos de G6, evaluados sobre el árbol entregado.
 *
 * Existe para corregir el defecto que invalidó la métrica primaria de G5: los
 * criterios de aceptación se compilaban por unidad de trabajo, de modo que
 * descomponer multiplicaba las obligaciones y cada condición terminaba medida
 * contra su propia vara. Éstos son diez, fijos, idénticos para A, B y C, y no
 * dependen de cómo se haya descompuesto el trabajo.
 *
 * Las capacidades se verifican **importando el código entregado** y
 * ejercitándolo, no leyendo lo que el probe dice de sí mismo: un probe puede
 * escribir `true`, una función importada tiene que hacer el trabajo.
 *
 * Los comandos y el probe se inyectan para que la lógica de veredicto sea
 * probable sin instalar dependencias ni ejecutar un repositorio real.
 */
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const G6_CRITERION_IDS = [
  "gate-install",
  "gate-test",
  "gate-typecheck",
  "gate-build",
  "integrity-baseline-tests",
  "behaviour-express-first",
  "behaviour-backorder-recorded",
  "behaviour-invalid-priority-rejected",
  "probe-single-json",
  "probe-deterministic"
];

const GATE_COMMANDS = {
  "gate-install": ["install", "--frozen-lockfile"],
  "gate-test": ["test"],
  "gate-typecheck": ["typecheck"],
  "gate-build": ["build"]
};

export async function evaluateG6Criteria({ treePath, baselineTestFiles, runCommand, runProbe }) {
  const criteria = [];

  for (const [id, command] of Object.entries(GATE_COMMANDS)) {
    const outcome = await runCommand(command).catch((error) => ({ exitCode: 1, stdout: "", stderr: String(error) }));
    criteria.push({
      id,
      satisfied: outcome.exitCode === 0,
      detail: outcome.exitCode === 0 ? `${command.join(" ")} exit 0` : `${command.join(" ")} exit ${outcome.exitCode}: ${tail(outcome.stderr || outcome.stdout)}`
    });
  }

  criteria.push(await evaluateBaselineTestIntegrity(treePath, baselineTestFiles));
  criteria.push(...await evaluateImportedBehaviour(treePath));
  criteria.push(...await evaluateProbe(runProbe));

  const ordered = G6_CRITERION_IDS.map((id) => criteria.find((entry) => entry.id === id)).filter(Boolean);
  return {
    total: G6_CRITERION_IDS.length,
    satisfied: ordered.filter((entry) => entry.satisfied).length,
    criteria: ordered
  };
}

/**
 * Un archivo de test del baseline que desaparece o queda vacío es la forma más
 * barata de aprobar un gate sin hacer el trabajo.
 */
async function evaluateBaselineTestIntegrity(treePath, baselineTestFiles) {
  const missing = [];
  for (const relativePath of baselineTestFiles ?? []) {
    const info = await stat(join(treePath, relativePath)).catch(() => undefined);
    if (info === undefined) missing.push(`${relativePath} (ausente)`);
    else if (info.size === 0) missing.push(`${relativePath} (vacío)`);
  }
  return {
    id: "integrity-baseline-tests",
    satisfied: missing.length === 0,
    detail: missing.length === 0
      ? `${(baselineTestFiles ?? []).length} archivos de test del baseline presentes y no vacíos`
      : `debilitados: ${missing.join(", ")}`
  };
}

async function evaluateImportedBehaviour(treePath) {
  const load = async (relativePath) => import(pathToFileURL(join(treePath, relativePath)).href);
  let orders;
  let planner;
  let scenario;
  try {
    orders = await load("src/domain/orders.ts");
    planner = await load("src/fulfillment/planner.ts");
    scenario = await load("src/scenarios/thesis-seed-2026.ts");
  } catch (error) {
    const detail = `no se pudo importar la superficie declarada: ${tail(String(error))}`;
    return [
      { id: "behaviour-express-first", satisfied: false, detail },
      { id: "behaviour-backorder-recorded", satisfied: false, detail },
      { id: "behaviour-invalid-priority-rejected", satisfied: false, detail }
    ];
  }

  const seed = scenario.buildThesisSeed2026();
  const sku = seed.skus[0];
  const standard = { id: "g6-standard", lines: [{ skuId: sku, quantity: 1 }], status: "reserved", priority: "standard" };
  const express = { id: "g6-express", lines: [{ skuId: sku, quantity: 1 }], status: "reserved", priority: "express" };

  return [
    expressFirstCriterion(planner, seed, standard, express),
    await backorderCriterion(orders, seed, sku),
    invalidPriorityCriterion(orders, seed, sku)
  ];
}

/** El estándar se pasa primero a propósito: si el planner ignora la prioridad, el orden de entrada lo delata. */
function expressFirstCriterion(planner, seed, standard, express) {
  try {
    const plan = planner.planFulfillment(seed.layout, seed.inventory, [standard, express], 2);
    const wave = (plan.waves ?? []).find((candidate) => (candidate.orderIds ?? []).includes(express.id));
    if (wave === undefined) {
      return { id: "behaviour-express-first", satisfied: false, detail: "ninguna ola incluye el pedido express" };
    }
    const expressIndex = wave.orderIds.indexOf(express.id);
    const standardIndex = wave.orderIds.indexOf(standard.id);
    const satisfied = standardIndex === -1 || expressIndex < standardIndex;
    return {
      id: "behaviour-express-first",
      satisfied,
      detail: `orden de la ola: ${wave.orderIds.join(", ")}`
    };
  } catch (error) {
    return { id: "behaviour-express-first", satisfied: false, detail: `planFulfillment lanzó: ${tail(String(error))}` };
  }
}

/** El faltante debe registrarse; lanzar es exactamente lo que la tarea pide reemplazar. */
async function backorderCriterion(orders, seed, sku) {
  try {
    const available = orders.availableUnits === undefined ? undefined : undefined;
    void available;
    const state = orders.createWarehouseState(seed.inventory);
    const huge = { id: "g6-backorder", lines: [{ skuId: sku, quantity: 1_000_000 }], status: "pending", priority: "standard" };
    const placed = orders.placeOrder(state, huge);
    const reserved = orders.reserveOrder(placed, huge.id);
    const recorded = orders.listBackorders(reserved);
    const entry = recorded.find((candidate) => candidate.orderId === huge.id && candidate.skuId === sku);
    const satisfied = entry !== undefined && Number.isInteger(entry.missing) && entry.missing > 0;
    return {
      id: "behaviour-backorder-recorded",
      satisfied,
      detail: satisfied ? `faltante registrado: ${entry.missing}` : `listBackorders devolvió ${JSON.stringify(recorded)}`
    };
  } catch (error) {
    return { id: "behaviour-backorder-recorded", satisfied: false, detail: `lanzó en vez de registrar: ${tail(String(error))}` };
  }
}

function invalidPriorityCriterion(orders, seed, sku) {
  const invalid = { id: "g6-invalid", lines: [{ skuId: sku, quantity: 1 }], status: "pending", priority: "urgent" };
  try {
    orders.placeOrder(orders.createWarehouseState(seed.inventory), invalid);
    return { id: "behaviour-invalid-priority-rejected", satisfied: false, detail: "placeOrder aceptó la prioridad \"urgent\"" };
  } catch (error) {
    const satisfied = error instanceof orders.OrderError;
    return {
      id: "behaviour-invalid-priority-rejected",
      satisfied,
      detail: satisfied ? "rechazado con OrderError" : `rechazado con ${tail(String(error))}`
    };
  }
}

async function evaluateProbe(runProbe) {
  const first = await runProbe().catch((error) => ({ exitCode: 1, stdout: "", stderr: String(error) }));
  const second = await runProbe().catch((error) => ({ exitCode: 1, stdout: "", stderr: String(error) }));
  const singleJson = first.exitCode === 0 && isSingleJsonObject(first.stdout);
  return [
    {
      id: "probe-single-json",
      satisfied: singleJson,
      detail: singleJson ? "un único objeto JSON en stdout" : `stdout no es un único objeto JSON: ${tail(first.stdout || first.stderr)}`
    },
    {
      id: "probe-deterministic",
      satisfied: singleJson && first.stdout === second.stdout,
      // Sin un probe que emita un objeto JSON no hay determinismo que medir. Dos
      // fallos idénticos no son una salida reproducible, y decir que lo son
      // sería el tipo de reporte que hace pasar la ausencia por evidencia.
      detail: !singleJson
        ? "no evaluable: el probe no emitió un objeto JSON"
        : first.stdout === second.stdout
          ? "dos invocaciones byte-idénticas"
          : "dos invocaciones difieren"
    }
  ];
}

function isSingleJsonObject(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function tail(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim().slice(-200);
}

export async function readBaselineTestFiles(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
