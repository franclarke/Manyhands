import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadBenchmarkManifest } from "@manyhands/core";
import { SCENARIOS, findScenario, getScenario } from "@/lib/scenarios";

const REPO_ROOT = path.resolve(__dirname, "..");

describe("scenarios catalog", () => {
  it("declares at least one scenario", () => {
    expect(SCENARIOS.length).toBeGreaterThan(0);
  });

  it("getScenario throws on unknown ids", () => {
    expect(() => getScenario("does-not-exist")).toThrow();
  });

  it("findScenario returns undefined for unknown ids", () => {
    expect(findScenario("does-not-exist")).toBeUndefined();
  });

  it("supportedGranularities is never empty", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.supportedGranularities.length).toBeGreaterThan(0);
    }
  });

  it("every scenario references a feature that exists in its benchmark manifest", async () => {
    const manifestCache = new Map<string, Awaited<ReturnType<typeof loadBenchmarkManifest>>>();
    for (const scenario of SCENARIOS) {
      let manifest = manifestCache.get(scenario.benchmarkId);
      if (manifest === undefined) {
        manifest = await loadBenchmarkManifest(
          path.resolve(REPO_ROOT, "benchmarks", scenario.benchmarkId, "benchmark.json")
        );
        manifestCache.set(scenario.benchmarkId, manifest);
      }
      const featureRef = manifest.features.find((entry) => entry.id === scenario.featureId);
      expect(featureRef, `${scenario.id} → ${scenario.featureId}`).toBeDefined();
    }
  });
});
