import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runExecutionPipeline,
  type ExecutionEngine,
  type ExecutionEngineInput
} from "@/lib/server/runs/runner";
import type { RepoProvisioner } from "@/lib/server/runs/repo-provisioner";
import { abortRun } from "@/lib/server/runs/run-abort-registry";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { JsonRunRecordStore } from "@/lib/server/runs/repository";
import type { RunRecord } from "@/lib/server/runs/schema";
import { resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { rmWithRetry } from "@/lib/server/runs/fs-retry";
import { AgentTaskContractSchema } from "@manyhands/contracts";
import {
  countLiveProcesses,
  superviseChildProcess,
  type GranularityVector,
  type RunExecutionResult
} from "@manyhands/execution-core";
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
        sourceRepoRoot: `/tmp/fake/${runId}/source`,
        sourceBranch: "main",
        sourceBaseCommit: BASE_COMMIT,
        baseBranch: "main",
        baseCommit: BASE_COMMIT,
        executionBaseCommit: BASE_COMMIT,
        cleanup: async () => undefined
      };
    }
  };
}

let tempDir: string;
let runsDir: string;

/**
 * Minimal planning artifact so `resolveExecutionGraph()` succeeds. Tests
 * inject a stub engine, so the contents are never exercised by a real
 * RunExecutor — only the shape matters.
 */
function stubPlanning(): unknown {
  const contract = validContract("leaf-a");
  return {
    decomposition: {
      contracts: [contract],
      graph: {
        id: "g1",
        planId: "p1",
        repo: "stub",
        baseBranch: "main",
        baseCommit: "0".repeat(40),
        featureRequest: "stub",
        nodes: {
          "leaf-a": {
            id: "leaf-a",
            kind: "leaf",
            parentId: null,
            title: "leaf-a",
            goal: "leaf-a",
            status: "planned",
            granularity: "auto",
            depth: 0,
            childrenIds: [],
            dependencies: [],
            metadata: { authoredBy: "ai" },
            contract
          }
        },
        dependencies: [],
        rootId: "leaf-a",
        createdAt: "2026-05-26T00:00:00.000Z"
      }
    }
  };
}

function validContract(taskId: string, changedFile = `src/${taskId}.ts`): unknown {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [changedFile] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [changedFile], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: [changedFile], testPaths: [], configPaths: [] }
  });
}

async function saveApprovedRun(runId: string, extra: Record<string, unknown> = {}): Promise<JsonRunRecordStore> {
  const store = new JsonRunRecordStore({ directory: runsDir });
  await store.save({
    runId,
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-opus-4.7",
    userPrompt: "Add a feature",
    title: "test",
    version: 0,
    status: "approved",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    planning: stubPlanning(),
    patches: [],
    ...extra
  });
  return store;
}

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-provisioning-"));
  runsDir = path.join(tempDir, "runs");
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  delete process.env.MANYHANDS_RUNS_DIR;
  resetRunRepositoryForTests();
  await rmWithRetry(tempDir);
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
    let persistedConfigAtDispatch: RunRecord["executionConfig"] | undefined;
    const engine: ExecutionEngine = {
      run: async (input) => {
        persistedConfigAtDispatch = (await store.get(runId)).executionConfig;
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
    expect(received?.executionConfig?.maxParallel).toBe(6);
    expect(persistedConfigAtDispatch?.maxParallel).toBe(6);

    // The provisioned repo was persisted as a run artifact.
    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("failed_artifact");
    expect(finalRun.provisioned?.baseCommit).toBe(BASE_COMMIT);
    expect(finalRun.provisioned?.baseBranch).toBe("main");
    expect(finalRun.provisioned?.sourceRepoRoot).toBe(`/tmp/fake/${runId}/source`);
    expect(finalRun.provisioned?.sourceBaseCommit).toBe(BASE_COMMIT);
    expect(finalRun.provisioned?.executionBaseCommit).toBe(BASE_COMMIT);
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

  it("respects a cancellation that lands while the engine is running", async () => {
    const runId = "run-cancelled";
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "fixture", fixtureId: "task-manager-api" }
    });

    const engine: ExecutionEngine = {
      run: async () => {
        // The user hits Stop while the engine is mid-run.
        const current = await store.get(runId);
        await store.save({
          ...current,
          status: "interrupted",
          interruptedDuring: "running",
          errorMessage: "interrupted: cancelled by user"
        });
        return completedResult(runId);
      }
    };

    await runExecutionPipeline(runId, { intervalMs: 0, engine, provisioner: fakeProvisioner() });

    const finalRun = await store.get(runId);
    // The cancellation is respected — not overridden by completed, no final apply.
    expect(finalRun.status).toBe("interrupted");
    expect(finalRun.finalCommitSha).toBeUndefined();
    expect(finalRun.finalBranchName).toBeUndefined();
    // A result returned after cancellation belongs to the fenced-out operation
    // and must never be accepted as durable execution evidence.
    expect(finalRun.execution).toBeUndefined();
  }, 30000);

  it("registers cancellation before repo provisioning completes", async () => {
    const runId = "run-cancel-during-provisioning";
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "fixture", fixtureId: "task-manager-api" }
    });

    let abortDelivered = false;
    let engineCalled = false;
    const provisioner: RepoProvisioner = {
      async provision() {
        await store.update(runId, (current) => ({
          ...current,
          status: "interrupted",
          interruptedDuring: "running",
          errorMessage: "interrupted: cancelled during provisioning"
        }));
        abortDelivered = abortRun(runId);
        return {
          repoRoot: `/tmp/fake/${runId}/repo`,
          sourceRepoRoot: `/tmp/fake/${runId}/source`,
          sourceBranch: "main",
          sourceBaseCommit: BASE_COMMIT,
          baseBranch: "main",
          baseCommit: BASE_COMMIT,
          executionBaseCommit: BASE_COMMIT,
          cleanup: async () => undefined
        };
      }
    };
    const engine: ExecutionEngine = {
      run: async () => {
        engineCalled = true;
        return completedResult(runId);
      }
    };

    await runExecutionPipeline(runId, { intervalMs: 0, engine, provisioner });

    const finalRun = await store.get(runId);
    expect(abortDelivered).toBe(true);
    expect(engineCalled).toBe(false);
    expect(finalRun.status).toBe("interrupted");
    expect(finalRun.errorMessage).toContain("provisioning");
    expect(finalRun.provisioned?.baseCommit).toBe(BASE_COMMIT);
    expect(finalRun.execution).toBeUndefined();
  }, 30000);

  it("interrupts and aborts the engine when the wall-clock budget is exceeded", async () => {
    const runId = "run-budget";
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "fixture", fixtureId: "task-manager-api" },
      executionConfig: { maxWallClockMs: 1_000 }
    });

    let sawAbort = false;
    let supervisedKillCount = 0;
    let resolveEngineStarted: (() => void) | undefined;
    const engineStarted = new Promise<void>((resolve) => {
      resolveEngineStarted = resolve;
    });
    const engine: ExecutionEngine = {
      run: async (input) => {
        const dispose = superviseChildProcess(
          { runId, label: "test-engine" },
          { kill: () => { supervisedKillCount += 1; } },
          { signal: input.signal }
        );
        expect(countLiveProcesses(runId)).toBe(1);
        resolveEngineStarted?.();
        // Behave like a real engine: keep "working" until aborted, then unwind.
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted === true) {
            resolve();
            return;
          }
          input.signal?.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true }
          );
        });
        dispose();
        return completedResult(runId);
      }
    };

    const running = runExecutionPipeline(runId, { intervalMs: 0, engine, provisioner: fakeProvisioner() });
    await engineStarted;
    await running;

    const finalRun = await store.get(runId);
    expect(sawAbort).toBe(true);
    expect(supervisedKillCount).toBeGreaterThan(0);
    expect(countLiveProcesses(runId)).toBe(0);
    expect(finalRun.status).toBe("interrupted");
    expect(finalRun.errorMessage).toContain("budget");
    expect(finalRun.activeOperation).toBeUndefined();
    expect(finalRun.execution).toBeUndefined();
    expect(finalRun.finalArtifactManifest).toBeUndefined();
    expect(finalRun.finalApplicationStatus).toBeUndefined();
    const cancelled = (await readRunModelEvents(runId)).find((event) => event.type === "run.cancelled");
    expect(cancelled?.payload.allDead).toBe(true);
  }, 30000);

  it("materializes the final branch in the isolated run repo without touching the source checkout", async () => {
    const runId = "run-local-apply";
    const repoRoot = path.join(tempDir, "local-repo");
    await initRepo(repoRoot);
    const baseCommit = git(repoRoot, "rev-parse", "HEAD");
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "localPath", path: repoRoot },
      planning: { decomposition: { graph: minimalGraph(baseCommit, repoRoot) } }
    });

    const engine: ExecutionEngine = {
      run: async (input) => {
        const executionRoot = input.provisioned!.repoRoot;
        await mkdir(path.join(executionRoot, "src"), { recursive: true });
        await writeFile(path.join(executionRoot, "src", "feature.ts"), "export const feature = true;\n");
        git(executionRoot, "add", "-A");
        git(
          executionRoot,
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          "commit",
          "-m",
          "integrated"
        );
        const integrationCommit = git(executionRoot, "rev-parse", "HEAD");
        git(executionRoot, "reset", "--hard", input.provisioned!.baseCommit);
        return {
          runId,
          status: "completed",
          leafResults: [],
          integrationResults: [
            {
              compositeTaskId: "root",
              status: "success",
              childResults: [],
              integrationCommitSha: integrationCommit,
              repairAttempted: false,
        preMergeFindings: []
            }
          ],
          granularityVector: STUB_VECTOR,
          totalDurationMs: 1
        };
      }
    };

    await runExecutionPipeline(runId, { intervalMs: 0, engine });

    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("unverified");
    expect(finalRun.finalApplicationStatus).toBe("applied");
    expect(finalRun.finalArtifactManifest?.finalSha).toBe(finalRun.finalCommitSha);
    expect(finalRun.artifactOutcome).toBe("unverified");
    expect(finalRun.deliveryOutcome).toBe("needs_delivery");
    expect(finalRun.finalPatch).toContain("feature.ts");
    expect(finalRun.integrationCommitSha).toMatch(/^[0-9a-f]{40}$/);
    // The result lands on a fresh manyhands/run-* branch, not the user's branch.
    expect(finalRun.finalBranchName).toMatch(/^manyhands\/run-/);
    expect(git(finalRun.provisioned!.repoRoot, "rev-parse", finalRun.finalBranchName!)).toBe(
      finalRun.finalCommitSha
    );
    // The user's branch and working tree were never used as the execution repo.
    expect(git(repoRoot, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repoRoot, "rev-parse", "HEAD")).toBe(baseCommit);
    expect(git(repoRoot, "status", "--porcelain")).toBe("");
  }, 30000);
});

async function initRepo(repoRoot: string): Promise<void> {
  await mkdir(path.join(repoRoot, "src"), { recursive: true });
  await writeFile(path.join(repoRoot, "src", "index.ts"), "export const base = true;\n");
  git(repoRoot, "init", "-b", "main");
  git(repoRoot, "config", "user.name", "Test");
  git(repoRoot, "config", "user.email", "test@example.com");
  git(repoRoot, "config", "commit.gpgsign", "false");
  git(repoRoot, "add", "-A");
  git(repoRoot, "commit", "-m", "base");
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function minimalGraph(baseCommit: string, repoRoot: string): unknown {
  const contract = validContract("leaf-a", "src/feature.ts");
  return {
    id: "graph",
    planId: "plan",
    repo: repoRoot,
    baseBranch: "main",
    baseCommit,
    featureRequest: "local",
    rootId: "root",
    createdAt: "2026-05-26T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "root",
        title: "Root",
        goal: "Apply local feature",
        status: "planned",
        granularity: "medium",
        depth: 0,
        childrenIds: ["leaf-a"],
        dependencies: []
      },
      "leaf-a": {
        id: "leaf-a",
        parentId: "root",
        kind: "leaf",
        title: "Implement feature",
        goal: "Implement local feature",
        status: "planned",
        granularity: "fine",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        contract
      }
    }
  };
}
