import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTaskContractSchema } from "@manyhands/contracts";
import { RunExecutor, type AgentExecutionResult } from "@manyhands/execution-core";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import { buildExecutionHost } from "@/lib/server/runs/execution-host";
import {
  abortRun,
  createRunAbort,
  disposeRunAbort
} from "@/lib/server/runs/run-abort-registry";
import type { ProvisionedRepo } from "@/lib/server/runs/repo-provisioner";
import type { RunOperationLease, RunRecord } from "@/lib/server/runs/schema";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { JsonTaskAttemptJournal } from "@/lib/server/runs/task-attempt-journal";

const BASE_SHA = "0".repeat(40);
const LEAF_SHA = "1".repeat(40);
const lease: RunOperationLease = {
  operationId: "00000000-0000-4000-8000-000000000001",
  kind: "execution",
  fencingToken: 1,
  acquiredAt: "2026-07-15T00:00:00.000Z",
  heartbeatAt: "2026-07-15T00:00:00.000Z"
};

let tempDir: string;
let runsDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-attempt-terminal-"));
  runsDir = path.join(tempDir, "runs");
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = runsDir;
  resetRunRepositoryForTests();
});

afterEach(async () => {
  vi.restoreAllMocks();
  disposeRunAbort("run-repair-throw");
  disposeRunAbort("run-integrate-cancelled");
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("execution-host attempt terminalization", () => {
  it("marks a repair attempt failed when RunExecutor.repairLeaf throws", async () => {
    const runId = "run-repair-throw";
    const graph = taskGraph();
    const run = runRecord(runId, graph);
    await getRunRepository().save(run);

    vi.spyOn(RunExecutor.prototype, "runNode").mockResolvedValue({
      kind: "leaf",
      result: leafResult("leaf", "validation_failed"),
      worktrees: []
    });
    vi.spyOn(RunExecutor.prototype, "repairLeaf").mockRejectedValue(new Error("repair executor crashed"));

    const host = buildExecutionHost(run, provisioned(), { operationLease: lease });
    await expect(host.graph.invoke(initialState(runId, graph), host.threadConfig)).rejects.toThrow(
      "repair executor crashed"
    );

    const attempts = await attemptJournal().list(runId);
    expect(attempts.find((attempt) => attempt.kind === "repair")).toMatchObject({
      nodeId: "leaf",
      state: "failed",
      error: { code: "execution_failed", message: "repair executor crashed" }
    });
  });

  it("marks an integration attempt cancelled when its executor throws after abort", async () => {
    const runId = "run-integrate-cancelled";
    const graph = taskGraph();
    const run = runRecord(runId, graph);
    await getRunRepository().save(run);
    createRunAbort(runId);

    vi.spyOn(RunExecutor.prototype, "runNode").mockImplementation(async (params) => {
      if (params.taskId === "leaf") {
        return { kind: "leaf", result: leafResult("leaf", "success"), worktrees: [] };
      }
      abortRun(runId);
      throw new Error("integration executor interrupted");
    });

    const host = buildExecutionHost(run, provisioned(), { operationLease: lease });
    await expect(host.graph.invoke(initialState(runId, graph), host.threadConfig)).rejects.toThrow(
      "integration executor interrupted"
    );

    const attempts = await attemptJournal().list(runId);
    expect(attempts.find((attempt) => attempt.kind === "integrator")).toMatchObject({
      nodeId: "root",
      state: "cancelled",
      error: { code: "cancelled", message: "integration executor interrupted" }
    });
  });
});

function attemptJournal(): JsonTaskAttemptJournal {
  return new JsonTaskAttemptJournal({ directory: path.join(runsDir, "attempts") });
}

function provisioned(): ProvisionedRepo {
  return {
    repoRoot: tempDir,
    sourceRepoRoot: tempDir,
    sourceBranch: "main",
    sourceBaseCommit: BASE_SHA,
    baseBranch: "main",
    baseCommit: BASE_SHA,
    executionBaseCommit: BASE_SHA,
    cleanup: async () => undefined
  };
}

function runRecord(runId: string, graph: TaskGraph): RunRecord {
  return {
    runId,
    workspaceId: "workspace-1",
    granularity: "balanced",
    model: "gpt-5.5",
    defaultExecutionSelection: { executorId: "codex-cli", model: "gpt-5.5" },
    defaultRepairSelection: { executorId: "codex-cli", model: "gpt-5.5" },
    userPrompt: "Implement the graph",
    title: "Attempt terminalization",
    version: 0,
    mutationFence: lease.fencingToken,
    activeOperation: lease,
    status: "running",
    createdAt: "2026-07-15T00:00:00.000Z",
    updatedAt: "2026-07-15T00:00:00.000Z",
    planning: { decomposition: { graph, contracts: Object.values(graph.nodes).map((node) => node.contract) } },
    patches: []
  };
}

function initialState(runId: string, graph: TaskGraph) {
  return {
    runId,
    userPrompt: "Implement the graph",
    workspaceId: "workspace-1",
    repoPath: tempDir,
    taskGraph: graph,
    planningQueue: [],
    planningStepCache: {},
    leafResults: [],
    integrationResults: [],
    acceptedLeafFailures: [],
    acceptedIntegrationFailures: [],
    pendingQuestion: null,
    userAnswers: {},
    status: "approved" as const,
    errorMessage: null
  };
}

function taskGraph(): TaskGraph {
  const root = taskNode("root", "root", null, ["leaf"]);
  const leaf = taskNode("leaf", "leaf", "root", []);
  return {
    id: "graph-attempt-terminalization",
    planId: "plan-attempt-terminalization",
    repo: tempDir,
    baseBranch: "main",
    baseCommit: BASE_SHA,
    featureRequest: "Implement one leaf",
    rootId: root.id,
    createdAt: "2026-07-15T00:00:00.000Z",
    nodes: { [root.id]: root, [leaf.id]: leaf },
    dependencies: []
  };
}

function taskNode(
  id: string,
  kind: TaskNode["kind"],
  parentId: string | null,
  childrenIds: string[]
): TaskNode {
  const contract = AgentTaskContractSchema.parse({
    taskId: id,
    objective: `Implement ${id}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [`src/${id}.ts`] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${id}.ts`], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: [`src/${id}.ts`], testPaths: [], configPaths: [] }
  });
  return {
    id,
    kind,
    parentId,
    title: id,
    goal: `Implement ${id}.`,
    status: "planned",
    granularity: "auto",
    depth: parentId === null ? 0 : 1,
    childrenIds,
    dependencies: [],
    metadata: { authoredBy: "ai" },
    contract
  };
}

function leafResult(taskId: string, status: AgentExecutionResult["status"]): AgentExecutionResult {
  return {
    taskId,
    status,
    baseHead: BASE_SHA,
    currentHead: status === "success" ? LEAF_SHA : BASE_SHA,
    agentCommittedUnexpectedly: false,
    diff: status === "success" ? "diff --git a/src/leaf.ts b/src/leaf.ts" : "",
    changedFiles: status === "success" ? ["src/leaf.ts"] : [],
    ...(status === "success" ? { commitSha: LEAF_SHA } : {}),
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: status === "success" ? 0 : 1,
    executorDurationMs: 1,
    executorTimedOut: false,
    stderrTail: status === "success" ? "" : "validation failed",
    stdoutTail: ""
  };
}
