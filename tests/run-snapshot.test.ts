import path from "node:path";
import { describe, expect, it } from "vitest";
import { runMockExecutionFlow } from "@manyhands/core";
import { buildRepositoryIndex } from "@manyhands/repository-index";
import {
  RUN_SNAPSHOT_SCHEMA_VERSION,
  RunSnapshotSchema,
  computeInputHash,
  computeRunSnapshotOutputHash
} from "@manyhands/run-store";

const fixturePath = path.resolve(process.cwd(), "examples/features/passwordless-login.json");
const repositoryPath = path.resolve(process.cwd(), "examples/repos/aprobado-lite");

describe("RunSnapshot", () => {
  it("builds a valid snapshot from the mock execution flow", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });

    expect(RunSnapshotSchema.safeParse(result.snapshot).success).toBe(true);
    expect(result.snapshot.runId).toBe(result.summary.runId);
    expect(result.snapshot.status).toBe("executed");
  });

  it("includes the full planning and execution artifact surface", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });
    const snapshot = result.snapshot;

    expect(snapshot.featureRequest.id).toBe("passwordless-login");
    expect(Object.keys(snapshot.graphSnapshot.nodes)).toHaveLength(result.summary.planning.taskCount);
    expect(snapshot.contracts).toHaveLength(result.summary.planning.contractCount);
    expect(snapshot.riskPredictions).toHaveLength(result.summary.planning.riskPredictionCount);
    expect(snapshot.scheduledBatches).toHaveLength(result.summary.planning.batchCount);
    expect(snapshot.agentRunResults).toHaveLength(result.summary.execution.executedTasks);
    expect(snapshot.scopeValidationResults).toHaveLength(result.summary.execution.executedTasks);
    expect(snapshot.traceEvents).toHaveLength(result.summary.traceEventCount);
  });

  it("uses a versioned schema", async () => {
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced" });

    expect(result.snapshot.metadata.schemaVersion).toBe(RUN_SNAPSHOT_SCHEMA_VERSION);
  });

  it("computes deterministic input and output hashes", async () => {
    const first = await runMockExecutionFlow({ fixturePath, mode: "balanced" });
    const second = await runMockExecutionFlow({ fixturePath, mode: "balanced" });

    expect(first.snapshot.metadata.inputHash).toBe(second.snapshot.metadata.inputHash);
    expect(first.snapshot.metadata.outputHash).toBe(second.snapshot.metadata.outputHash);
    expect(first.snapshot.metadata.inputHash).toBe(
      computeInputHash({
        featureRequest: first.snapshot.featureRequest,
        decompositionMode: first.snapshot.decompositionMode
      })
    );
    expect(first.snapshot.metadata.outputHash).toBe(computeRunSnapshotOutputHash(first.snapshot));
  });

  it("can include repository index metadata and static conflict signals", async () => {
    const repositoryIndex = await buildRepositoryIndex({ rootPath: repositoryPath, repositoryId: "aprobado-lite" });
    const result = await runMockExecutionFlow({ fixturePath, mode: "balanced", repositoryIndex });

    expect(result.snapshot.repositoryIndexSummary).toEqual(
      expect.objectContaining({
        repositoryId: "aprobado-lite",
        indexHash: result.snapshot.repositoryIndexHash
      })
    );
    expect(result.snapshot.repositoryIndexHash).toBeDefined();
    expect(result.snapshot.staticConflictSignals.length).toBeGreaterThan(0);
  });
});
