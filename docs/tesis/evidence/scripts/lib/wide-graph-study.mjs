import { WIDE_GRAPH_SIZES, metricsFor, moduleIdFor } from "./wide-graph-metrics.mjs";

export const WIDE_GRAPH_BASE_SHA = "71f61c9efa222103ca2fb2f67692434ab493d75c";
export { WIDE_GRAPH_SIZES };

export function buildWideGraphPlan({ targetRepo }) {
  return WIDE_GRAPH_SIZES.map((moduleCount, position) => ({
    cellId: `warehouse-wide-n${String(moduleCount).padStart(2, "0")}`,
    position: position + 1,
    moduleCount,
    targetRepo,
    baseSha: WIDE_GRAPH_BASE_SHA,
    goal: wideGraphGoal(moduleCount)
  }));
}

/**
 * El estímulo se renderiza desde el catálogo. Cada módulo recibe su pregunta
 * analítica, y cada módulo escribe **su propio** archivo de test — las dos cosas
 * que faltaban antes.
 *
 * La primera versión pedía N módulos que derivaban los mismos tres valores y sólo
 * se diferenciaban por un id: eso medía la maquinaria del grafo sobre un fan-out
 * sintético, y un planner se detuvo a objetarlo en vez de construirlo. Además
 * daba a las N hojas un único `projections.test.ts` compartido, que hacía
 * imposible la integración.
 *
 * El estímulo no dice el resultado esperado de ninguna métrica: eso lo verifica
 * el oráculo externo contra el specimen. Decirlo acá permitiría hardcodear.
 */
function wideGraphGoal(moduleCount) {
  const metrics = metricsFor(moduleCount);
  const assignments = metrics.map((metric, index) =>
    `- src/analytics/${moduleIdFor(index)}.ts exports the projection "${metric.id}": ${metric.question} Its focused tests live in src/analytics/${moduleIdFor(index)}.test.ts.`
  );
  return [
    `Add exactly ${moduleCount} independent warehouse analytics modules to the verified W1 codebase.`,
    "Create src/analytics/contracts.ts exporting WarehouseProjection with a readonly id and project(scenario), where project returns the answer to that module's question.",
    "Each module answers one question, computed from the W1 Scenario, layout and inventory exports:",
    ...assignments,
    "A module must not import another module; it may import only the fixed contract and W1 exports.",
    "Every answer must be derived from the scenario at run time. Do not hardcode results, and do not duplicate the W1 inventory or layout calculations.",
    "Create src/analytics/registry.ts as the sole consumer of every module, returning all projections in the order the modules are listed above, with its own tests in src/analytics/registry.test.ts.",
    "Preserve all existing W1 behaviour and checks.",
    "Add a package script named study:wide-graph that writes exactly one JSON object to stdout and no other output.",
    `Its JSON must be { "schemaVersion": 1, "moduleCount": ${moduleCount}, "scenario": "thesis-seed-2026", "projections": [ { "projectionId": "<the module's projection id>", "value": <that module's answer> }, … ] } with exactly ${moduleCount} entries in the order the modules are listed above.`,
    "Two invocations from the same commit must emit byte-identical JSON."
  ].join("\n");
}

/**
 * Which executor produced a cell has to be declared by the cell, not compiled
 * into the generator. Codex reports `usageSource: "unavailable"`, so under it
 * the sweep reports tokens as a floor and cost as unavailable; Claude Code
 * reports both. Claude models expose no reasoning-effort knob (`efforts: null`
 * in the registry), so those selections carry no `effort` field by design.
 */
export const WIDE_GRAPH_SELECTIONS = Object.freeze({
  codex: Object.freeze({ executorId: "codex-cli", model: "gpt-5.5", effort: "high" }),
  claude: Object.freeze({ executorId: "claude-code-cli", model: "sonnet" })
});

export function wideGraphSelection(name) {
  const selection = WIDE_GRAPH_SELECTIONS[name];
  if (selection === undefined) {
    throw new Error(`Unknown executor selection "${name}"; expected one of ${Object.keys(WIDE_GRAPH_SELECTIONS).join(", ")}.`);
  }
  return { ...selection };
}
