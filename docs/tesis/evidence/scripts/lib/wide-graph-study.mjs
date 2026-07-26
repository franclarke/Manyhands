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
    "Do not hardcode scenario totals or duplicate the W1 inventory calculation."
  ].join(" ");
}
