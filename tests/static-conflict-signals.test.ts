import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentTaskContractSchema,
  type AgentTaskContract
} from "@manyhands/contracts";
import {
  buildStaticConflictSignals,
  buildTaskPairRiskMatrix,
  findRiskPrediction
} from "@manyhands/conflict-risk";
import {
  MockDecomposer,
  contractsByTaskId,
  type FeatureRequest
} from "@manyhands/decomposer";
import { buildRepositoryIndex } from "@manyhands/repository-index";
import { scheduleTasks } from "@manyhands/scheduler";
import { loadFeatureFixture } from "@manyhands/core";

const featurePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");
const repositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

async function buildBalancedFixture(): Promise<{
  feature: FeatureRequest;
  contracts: Record<string, AgentTaskContract>;
  graph: Awaited<ReturnType<MockDecomposer["decompose"]>>["graph"];
}> {
  const feature = await loadFeatureFixture(featurePath);
  const decomposition = await new MockDecomposer().decompose(feature, { mode: "balanced" });

  return {
    feature,
    contracts: contractsByTaskId(decomposition.contracts),
    graph: decomposition.graph
  };
}

describe("StaticConflictSignals", () => {
  it("generates static signals between fixture contracts", async () => {
    const { contracts } = await buildBalancedFixture();
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const signals = buildStaticConflictSignals({ contracts, repositoryIndex: index });

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.map((signal) => signal.type)).toEqual(
      expect.arrayContaining(["producer_consumer_symbol", "same_declared_symbol_file"])
    );
  });

  it("detects a missing expected symbol", async () => {
    const { contracts } = await buildBalancedFixture();
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const contract = contracts["passwordless-login:balanced:token-model"];

    expect(contract).toBeDefined();

    const modified = AgentTaskContractSchema.parse({
      ...contract,
      relevantSymbols: [...(contract?.relevantSymbols ?? []), "NotActuallyDeclared"],
      expectedOutput: {
        ...contract?.expectedOutput,
        producedSymbols: [...(contract?.expectedOutput.producedSymbols ?? []), "NotActuallyDeclared"]
      }
    });
    const signals = buildStaticConflictSignals({
      contracts: {
        ...contracts,
        [modified.taskId]: modified
      },
      repositoryIndex: index
    });

    expect(signals).toContainEqual(
      expect.objectContaining({
        taskAId: modified.taskId,
        type: "missing_expected_symbol"
      })
    );
  });

  it("detects a missing expected file", async () => {
    const { contracts } = await buildBalancedFixture();
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const contract = contracts["passwordless-login:balanced:login-ui"];

    expect(contract).toBeDefined();

    const modified = AgentTaskContractSchema.parse({
      ...contract,
      expectedOutput: {
        ...contract?.expectedOutput,
        changedFiles: [...(contract?.expectedOutput.changedFiles ?? []), "src/app/login/missing-page.tsx"]
      }
    });
    const signals = buildStaticConflictSignals({
      contracts: {
        ...contracts,
        [modified.taskId]: modified
      },
      repositoryIndex: index
    });

    expect(signals).toContainEqual(
      expect.objectContaining({
        taskAId: modified.taskId,
        type: "missing_expected_file"
      })
    );
  });

  it("keeps metadata-only risk behavior unchanged without static signals", async () => {
    const { contracts } = await buildBalancedFixture();

    expect(buildTaskPairRiskMatrix({ contracts })).toEqual(
      buildTaskPairRiskMatrix({ contracts, staticSignals: [] })
    );
  });

  it("adds auditable evidence when static signals are provided", async () => {
    const { contracts } = await buildBalancedFixture();
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const signals = buildStaticConflictSignals({ contracts, repositoryIndex: index });
    const enhanced = buildTaskPairRiskMatrix({ contracts, staticSignals: signals });
    const prediction = findRiskPrediction(
      enhanced,
      "passwordless-login:balanced:token-model",
      "passwordless-login:balanced:request-action"
    );

    expect(prediction?.evidence.some((item) => item.signal.startsWith("static_"))).toBe(true);
  });

  it("keeps the scheduler compatible with enhanced risk", async () => {
    const { contracts, graph } = await buildBalancedFixture();
    const index = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const staticSignals = buildStaticConflictSignals({ contracts, repositoryIndex: index });
    const riskMatrix = buildTaskPairRiskMatrix({ contracts, staticSignals });
    const plan = scheduleTasks({
      graph,
      contracts,
      riskMatrix,
      maxParallel: 3,
      policy: "risk_aware"
    });

    for (const batch of plan.batches) {
      for (let leftIndex = 0; leftIndex < batch.taskIds.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < batch.taskIds.length; rightIndex += 1) {
          const left = batch.taskIds[leftIndex];
          const right = batch.taskIds[rightIndex];

          if (left && right) {
            expect(findRiskPrediction(riskMatrix, left, right)?.level).not.toMatch(/high|blocking/u);
          }
        }
      }
    }
  });
});
