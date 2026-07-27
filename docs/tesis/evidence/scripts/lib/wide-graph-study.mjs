export const WIDE_GRAPH_BASE_SHA = "71f61c9efa222103ca2fb2f67692434ab493d75c";
export const WIDE_GRAPH_SIZES = Object.freeze([4, 8, 16, 24]);

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

function wideGraphGoal(moduleCount) {
  const modules = Array.from(
    { length: moduleCount },
    (_, index) => `src/analytics/projection-${String(index + 1).padStart(2, "0")}.ts`
  );
  return [
    `Add exactly ${moduleCount} independent warehouse projection modules to the verified W1 codebase.`,
    `Create these modules: ${modules.join(", ")}.`,
    "Create src/analytics/contracts.ts exporting WarehouseProjection with id and project(scenario).",
    "Each projection must derive projectionId, totalUnits, and skuCount through the W1 Scenario and inventory functions.",
    "A projection module must not import another projection module; it may import only the fixed contract and W1 Scenario or inventory exports.",
    "Create src/analytics/registry.ts as the sole consumer of every projection and return all projections ordered by id.",
    "Add focused tests for every module and the registry, preserving all W1 behavior and checks.",
    "Do not hardcode scenario totals or duplicate the W1 inventory calculation.",
    "Add a package script named study:wide-graph that writes exactly one JSON object and no other output.",
    `Its JSON must include schemaVersion: 1, moduleCount: ${moduleCount}, scenario: thesis-seed-2026, and projections: an id-ordered array of exactly ${moduleCount} registry results.`,
    "Two invocations from the same commit must emit byte-identical JSON."
  ].join(" ");
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
