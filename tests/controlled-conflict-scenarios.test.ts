import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildStaticConflictSignals,
  buildTaskPairRiskMatrix
} from "@manyhands/conflict-risk";
import {
  MetadataDrivenMockDecomposer,
  contractsByTaskId
} from "@manyhands/decomposer";
import { BenchmarkFeatureSchema } from "@manyhands/evaluator";
import { buildRepositoryIndex } from "@manyhands/repository-index";

const repositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");
const schemaFeaturePath = path.resolve(process.cwd(), "benchmarks/conflict-v0/features/shared-schema-conflict.json");

describe("controlled conflict scenarios", () => {
  it("generates blocking static risk for a shared schema conflict", async () => {
    const feature = BenchmarkFeatureSchema.parse(JSON.parse(await readFile(schemaFeaturePath, "utf8")) as unknown);
    const decomposition = await new MetadataDrivenMockDecomposer().decompose(feature, { mode: "balanced" });
    const contracts = contractsByTaskId(decomposition.contracts);
    const repositoryIndex = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const staticSignals = buildStaticConflictSignals({ contracts, repositoryIndex });
    const matrix = buildTaskPairRiskMatrix({ contracts, staticSignals });

    expect(staticSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "critical_file_overlap",
        severity: "blocking"
      })
    ]));
    expect(matrix.some((prediction) => prediction.level === "blocking")).toBe(true);
  });
});
