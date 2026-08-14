import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");

describe("Stage 6 productive cutover boundary", () => {
  it("keeps productive planning, execution, and readiness on canonical inputs only", async () => {
    const files = await Promise.all([
      "apps/daemon/src/current-lifecycle-adapters.ts",
      "apps/daemon/src/transitional-unsafe-worker.ts",
      "apps/daemon/src/product-run-application.ts",
      "packages/orchestrator-graph/src/canonical-execution-driver.ts",
      "packages/scheduler/src/canonical-frontier.ts"
    ].map(async (file) => ({ file, source: await readFile(path.join(root, file), "utf8") })));
    const productSource = files.map(({ source }) => source).join("\n");

    expect(productSource).toContain("PlanningEngine");
    expect(productSource).toContain("GraphRevisionSchema");
    expect(productSource).toContain("CanonicalExecutionDriver");
    expect(productSource).toContain("evaluateReadiness");
    expect(productSource).not.toMatch(/LegacyGraphRevisionV2|selectReadyWaveV2|TaskPairRiskMatrix|RecursivePlanner|projectSemanticPlanForLegacyCompiler|compileGraphRevision|conflictConstraints/u);
  });
});
