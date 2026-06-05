import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

/**
 * Minimal planning artifact so `resolveExecutionGraph()` succeeds. Tests
 * inject a stub engine, so the contents are never exercised by a real
 * RunExecutor — only the shape matters.
 */
function stubPlanning(): unknown {
  return {
    decomposition: {
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
            metadata: { authoredBy: "ai" }
          }
        },
        dependencies: [],
        rootId: "leaf-a",
        createdAt: "2026-05-26T00:00:00.000Z"
      }
    }
  };
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
    // The partial execution result is still persisted for diagnostics.
    expect(finalRun.execution).toBeDefined();
  }, 30000);

  it("interrupts and aborts the engine when the wall-clock budget is exceeded", async () => {
    const runId = "run-budget";
    const store = await saveApprovedRun(runId, {
      repoSpec: { kind: "fixture", fixtureId: "task-manager-api" },
      executionConfig: { maxWallClockMs: 50 }
    });

    let sawAbort = false;
    const engine: ExecutionEngine = {
      run: async (input) => {
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
        return completedResult(runId);
      }
    };

    await runExecutionPipeline(runId, { intervalMs: 0, engine, provisioner: fakeProvisioner() });

    const finalRun = await store.get(runId);
    expect(sawAbort).toBe(true);
    expect(finalRun.status).toBe("interrupted");
    expect(finalRun.errorMessage).toContain("budget");
  }, 30000);

  it("applies the final integrated patch back to a local repo", async () => {
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
        await writeFile(path.join(repoRoot, "src", "feature.ts"), "export const feature = true;\n");
        git(repoRoot, "add", "-A");
        git(repoRoot, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "integrated");
        const integrationCommit = git(repoRoot, "rev-parse", "HEAD");
        git(repoRoot, "reset", "--hard", input.provisioned!.baseCommit);
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
              repairAttempted: false
            }
          ],
          granularityVector: STUB_VECTOR,
          totalDurationMs: 1
        };
      }
    };

    await runExecutionPipeline(runId, { intervalMs: 0, engine });

    const finalRun = await store.get(runId);
    expect(finalRun.status).toBe("completed");
    expect(finalRun.finalApplicationStatus).toBe("applied");
    expect(finalRun.finalPatch).toContain("feature.ts");
    expect(finalRun.integrationCommitSha).toMatch(/^[0-9a-f]{40}$/);
    // The result lands on a fresh manyhands/run-* branch, not the user's branch.
    expect(finalRun.finalBranchName).toMatch(/^manyhands\/run-/);
    expect(git(repoRoot, "rev-parse", finalRun.finalBranchName!)).toBe(finalRun.finalCommitSha);
    // The user's branch and working tree are left exactly as the engine left them.
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
        childrenIds: [],
        dependencies: []
      }
    }
  };
}
