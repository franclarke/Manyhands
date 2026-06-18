/**
 * Runtime start safety: duplicate /run starts must not launch duplicate
 * execution pipelines for the same run.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_RUN } from "@/app/api/runs/[id]/run/route";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { drainRunBackgroundTasks } from "@/lib/server/runs/runner-state";
import { AgentTaskContractSchema } from "@manyhands/contracts";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;
let activeRunId: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-run-start-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (activeRunId !== undefined) {
    await drainRunBackgroundTasks(activeRunId);
    activeRunId = undefined;
  }
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-start",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "claude-sonnet",
    userPrompt: "Add login",
    title: "Add login",
    version: 0,
    status: "approved",
    createdAt: "2026-06-11T00:00:00.000Z",
    updatedAt: "2026-06-11T00:00:00.000Z",
    planning: planningArtifact("leaf-a"),
    patches: [],
    ...overrides
  };
}

function planningArtifact(taskId: string) {
  const contract = validContract(taskId);
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
        rootId: taskId,
        createdAt: "2026-06-11T00:00:00.000Z",
        dependencies: [],
        nodes: {
          [taskId]: {
            id: taskId,
            kind: "leaf",
            parentId: null,
            title: taskId,
            goal: taskId,
            status: "planned",
            granularity: "auto",
            depth: 0,
            childrenIds: [],
            dependencies: [],
            metadata: { authoredBy: "ai" },
            contract
          }
        }
      }
    }
  };
}

function validContract(taskId: string): unknown {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `Implement ${taskId}.`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: [`src/${taskId}.ts`] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: { changedFiles: [`src/${taskId}.ts`], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: [`src/${taskId}.ts`], testPaths: [], configPaths: [] }
  });
}

function postRun(runId: string): Promise<Response> {
  return POST_RUN(new Request(`http://manyhands.test/api/runs/${runId}/run`, { method: "POST" }), {
    params: Promise.resolve({ id: runId })
  });
}

describe("run start CAS", () => {
  it("allows exactly one concurrent start for an approved run", async () => {
    const runId = "run-start-concurrent";
    activeRunId = runId;
    await getRunRepository().save(makeRun({ runId }));

    const [first, second] = await Promise.all([postRun(runId), postRun(runId)]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const winner = first.status === 200 ? first : second;
    const loser = first.status === 409 ? first : second;

    const winnerBody = (await winner.json()) as { run: { status: string; startedAt?: string } };
    const loserBody = (await loser.json()) as { error: string; conflict?: { currentStatus: string } };

    expect(winnerBody.run.status).toBe("running");
    expect(winnerBody.run.startedAt).toBeDefined();
    expect(loserBody.error).toContain("mutation rejected");
  });
});
