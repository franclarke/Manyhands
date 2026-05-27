import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BENCHMARK_MANIFEST_SCHEMA_VERSION,
  BenchmarkFeatureSchema,
  BenchmarkManifestSchema
} from "@manyhands/evaluator";

const manifestPath = path.resolve(process.cwd(), "benchmarks/mock-v0/benchmark.json");

describe("BenchmarkManifest", () => {
  it("parses the mock-v0 manifest", async () => {
    const manifest = BenchmarkManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);

    expect(manifest.id).toBe("mock-v0");
    expect(manifest.metadata.schemaVersion).toBe(BENCHMARK_MANIFEST_SCHEMA_VERSION);
    expect(manifest.features).toHaveLength(5);
    expect(manifest.configurations.map((configuration) => configuration.id)).toEqual(["B0", "B1", "B2", "B3"]);
  });

  it("rejects an invalid manifest with a clear schema error", () => {
    const result = BenchmarkManifestSchema.safeParse({
      id: "invalid",
      version: "0.1.0",
      name: "Invalid",
      description: "Invalid benchmark",
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

  it("parses every benchmark feature fixture", async () => {
    const manifest = BenchmarkManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")) as unknown);

    for (const featureRef of manifest.features) {
      const featurePath = path.resolve(path.dirname(manifestPath), featureRef.path);
      const feature = BenchmarkFeatureSchema.parse(JSON.parse(await readFile(featurePath, "utf8")) as unknown);

      expect(feature.id).toBe(featureRef.id);
      expect(feature.expectedModules.length).toBeGreaterThan(0);
      expect(feature.fixtureVersion).toBe("0.1.0");
    }
  });
});
