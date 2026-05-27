import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_MANIFEST_SCHEMA_VERSION,
  BenchmarkFeatureSchema,
  BenchmarkManifestSchema
} from "@manyhands/evaluator";

const manifestPath = path.resolve(process.cwd(), "benchmarks/conflict-v0/benchmark.json");

describe("conflict-v0 benchmark manifest", () => {
  it("parses the controlled conflict manifest with B4", async () => {
    const manifest = BenchmarkManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);

    expect(manifest.id).toBe("conflict-v0");
    expect(manifest.metadata.schemaVersion).toBe(BENCHMARK_MANIFEST_SCHEMA_VERSION);
    expect(manifest.features).toHaveLength(5);
    expect(manifest.configurations.map((configuration) => configuration.id)).toEqual(["B0", "B1", "B2", "B3", "B4"]);
    expect(manifest.configurations.find((configuration) => configuration.id === "B4")).toEqual(
      expect.objectContaining({
        humanGate: true,
        schedulerPolicy: "risk_aware",
        repositoryIndex: true,
        staticSignals: true
      })
    );
  });

  it("rejects an invalid conflict manifest with a clear error", () => {
    const result = BenchmarkManifestSchema.safeParse({
      id: "conflict-v0",
      version: "0.1.0",
      name: "Invalid",
      description: "Invalid",
      repositoryFixture: "examples/repos/aprobado-lite",
      features: [],
      configurations: [],
      metadata: {
        schemaVersion: BENCHMARK_MANIFEST_SCHEMA_VERSION,
        deterministic: true,
        createdFor: "mock_structural_evaluation"
      }
    });

    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path.join("."))).toContain("features");
  });

  it("parses controlled scenario feature metadata", async () => {
    const manifest = BenchmarkManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);

    for (const featureRef of manifest.features) {
      const featurePath = path.resolve(path.dirname(manifestPath), featureRef.path);
      const feature = BenchmarkFeatureSchema.parse(JSON.parse(await readFile(featurePath, "utf8")) as unknown);

      expect(feature.controlledScenarios.length).toBeGreaterThan(0);
      expect(feature.fixtureVersion).toBe("0.1.0");
    }
  });
});
