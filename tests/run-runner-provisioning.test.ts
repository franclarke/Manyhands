import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runExecutionPipeline,
  type ExecutionEngine,
  type ExecutionEngineInput
} from "@/lib/server/runs/runner";
import type { RepoProvisioner } from "@/lib/server/runs/repo-provisioner";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";
import type { GranularityVector, RunExecutionResult } from "@manyhands/execution-core";
import { InMemoryTraceStore } from "@manyhands/trace-store";

const STUB_VECTOR: GranularityVector = {
  depth: 1,
  leafCount: 0,
  compositeCount: 1,
  avgLeafDepth: 0,
  maxLeafDepth: 0,
  dependencyCount: 0,
  avgAcceptanceCriteriaPerLeaf: 0,
  integrationSuccessRate: 1,
  leafSuccessRate: 1,
  conflictRate: 0,
  totalDurationMs: 0,
  linesChanged: 0,
  unexpectedCommitCount: 0,
  scopeViolationCount: 0
};

function completedResult(runId: string): RunExecutionResult {
  return {
    runId,
    status: "completed",
    leafResults: [],
    integrationResults: [],
    granularityVector: STUB_VECTOR,
    totalDurationMs: 0
  };
}

const BASE_COMMIT = "a".repeat(40);

function fakeProvisioner(): RepoProvisioner {
  return {
    async provision({ runId }) {
      return {
        repoRoot: `/tmp/fake/${runId}/repo`,
        baseBranch: "main",
        baseCommit: BASE_COMMIT,
        cleanup: async () => undefined
      };
    }
  };
}

let tempDir: string;
let runsDir: string;

async function saveApprovedRun(runId: string, extra: Record<string, unknown> = {}): Promise<JsonRunRecordStore> {
  const store = new JsonRunRecordStore({ directory: runsDir });
  await store.save({
    runId,
    workspaceId: "ws-1",
    scenarioId: "passwordless-login",
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "",
    title: "test",
    status: "approved",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    ...extra
  });
  return store;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-provisioning-"));
  runsDir = path.join(tempDir, "runs");
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  process.env.MANYHANDS_REPO_ROOT = path.resolve(__dirname, "..");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_RUNS_DIR;
  delete process.env.MANYHANDS_REPO_ROOT;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("runExecutionPipeline provisioning", () => {
  it("fails with an actionable message when no repo is configured (default engine)", async () => {
    const runId = "run-no-repo";
    const store = await saveApprovedRun(runId);

    // No engine injected → default engine path → requires a real repo.
    await runExecutionPipeline(runId, { intervalMs: 0 });

    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("failed");
    expect(finalRun.errorMessage).toContain("no target repository");
    expect(finalRun.provisioned).toBeUndefined();
  });

  it("provisions the repo, persists it, and threads it into the engine", async () => {
    const runId = "run-with-repo";
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "fixture", fixtureId: "task-manager-api" }
    });

    let received: ExecutionEngineInput | undefined;
    const engine: ExecutionEngine = {
      run: async (input) => {
        received = input;
        return completedResult(runId);
      }
    };

    await runExecutionPipeline(runId, {
      intervalMs: 0,
      engine,
      provisioner: fakeProvisioner()
    });

    // The engine received the provisioned repo.
    expect(received?.provisioned?.baseCommit).toBe(BASE_COMMIT);

    // The provisioned repo was persisted as a run artifact.
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("completed");
    expect(finalRun.provisioned?.baseCommit).toBe(BASE_COMMIT);
    expect(finalRun.provisioned?.baseBranch).toBe("main");
  }, 30000);

  it("persists the engine's trace events on the run record (Etapa D)", async () => {
    const runId = "run-traces";
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "fixture", fixtureId: "task-manager-api" }
    });

    // Pipeline-owned trace store; the stub engine appends to it like the real engine.
    const traceStore = new InMemoryTraceStore();
    const engine: ExecutionEngine = {
      run: async () => {
        traceStore.append({ type: "agent_started", actor: "system", taskId: "leaf-a", payload: {} });
        traceStore.append({ type: "run_completed", actor: "system", payload: { runId } });
        return completedResult(runId);
      }
    };

    await runExecutionPipeline(runId, {
      intervalMs: 0,
      engine,
      traceStore,
      provisioner: fakeProvisioner()
    });

    const finalRun = await store.get(runId);
    expect(finalRun.executionTraces).toBeDefined();
    expect(finalRun.executionTraces?.map((event) => event.type)).toEqual([
      "agent_started",
      "run_completed"
    ]);
  }, 30000);
});
