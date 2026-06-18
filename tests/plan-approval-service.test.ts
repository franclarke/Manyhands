import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import type { TaskGraph } from "@manyhands/task-graph";
import {
  appendRunModelEvent,
  ensureRunModelEventLogForRun,
  readRunModelEvents
} from "@/lib/server/runs/run-model-event-log";
import { getRunRepository, resetRunRepositoryForTests } from "@/lib/server/runs/store";
import { processPlanApproval } from "@/lib/server/runs/plan-approval-service";
import type { RunRecord } from "@/lib/server/runs/schema";

let tempDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-plan-approval-"));
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = path.join(tempDir, "runs");
  resetRunRepositoryForTests();
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  resetRunRepositoryForTests();
  await rm(tempDir, { recursive: true, force: true });
});

describe("processPlanApproval", () => {
  it("records the approve_plan decision resolution for manual and automatic approvals", async () => {
    const repo = getRunRepository();
    await repo.save(makeRun({ status: "needs_review" }));
    await appendRunModelEvent("run-approve", {
      actor: "system",
      at: "2026-06-16T00:00:01.000Z",
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["leaf-a"] }
      }
    });

    await processPlanApproval("run-approve", true);

    const events = await readRunModelEvents("run-approve");
    expect(events.at(-1)).toMatchObject({
      actor: "human",
      type: "decision.resolved",
      payload: {
        decisionId: "approve_plan",
        choice: { action: "approve" },
        actor: "human"
      }
    });
    await expect(repo.get("run-approve")).resolves.toMatchObject({ status: "approved" });
  });

  it("backfills a missing approve_plan resolution when an existing log predates the fix", async () => {
    const repo = getRunRepository();
    await repo.save(
      makeRun({
        status: "failed",
        failedDuring: "running",
        approvedAt: "2026-06-16T00:00:02.000Z"
      })
    );
    await appendRunModelEvent("run-approve", {
      actor: "system",
      at: "2026-06-16T00:00:01.000Z",
      type: "decision.raised",
      payload: {
        decisionId: "approve_plan",
        kind: "approve_plan",
        blocking: true,
        context: { nodeIds: ["leaf-a"] }
      }
    });

    const events = await ensureRunModelEventLogForRun(await repo.get("run-approve"));

    expect(events.at(-1)).toMatchObject({
      at: "2026-06-16T00:00:02.000Z",
      actor: "human",
      type: "decision.resolved",
      payload: { decisionId: "approve_plan", choice: { action: "approve" } }
    });
  });

  it("blocks approval of an executable graph with an invalid contract even when acknowledged", async () => {
    const repo = getRunRepository();
    const contract = {
      ...validContract("leaf-a"),
      allowed: { paths: ["../outside-repo/**"] }
    };
    await repo.save(
      makeRun({
        status: "needs_review",
        planning: {
          decomposition: {
            graph: validGraph(contract),
            contracts: [contract]
          }
        }
      })
    );

    await expect(processPlanApproval("run-approve", true)).rejects.toThrow(/Executable graph is invalid/i);
    await expect(repo.get("run-approve")).resolves.toMatchObject({ status: "needs_review" });
  });
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-approve",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-flash",
    userPrompt: "Build feature",
    title: "Build feature",
    version: 0,
    status: "created",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    planning: validPlanning(),
    patches: [],
    ...overrides
  };
}

function validPlanning() {
  const contract = validContract("leaf-a");
  return {
    decomposition: {
      graph: validGraph(contract),
      contracts: [contract]
    }
  };
}

function validGraph(contract: AgentTaskContract): TaskGraph {
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "BASE",
    featureRequest: "Build feature",
    rootId: "root",
    createdAt: "2026-06-16T00:00:00.000Z",
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "root",
        title: "Root",
        goal: "Build feature",
        status: "planned",
        granularity: "auto",
        depth: 0,
        childrenIds: ["leaf-a"],
        dependencies: []
      },
      "leaf-a": {
        id: "leaf-a",
        parentId: "root",
        kind: "leaf",
        title: "Leaf A",
        goal: "Implement feature",
        status: "planned",
        granularity: "auto",
        depth: 1,
        childrenIds: [],
        dependencies: [],
        acceptanceCriteria: ["works"],
        contract
      }
    }
  };
}

function validContract(taskId: string): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: "Implement feature",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/**"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "works" }],
    validationCommands: [],
    expectedOutput: { changedFiles: ["src/feature.ts"], producedSymbols: [], consumedSymbols: [], diffShapeHint: "diff" },
    limits: { maxDurationMs: 60_000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: ["src/**"], testPaths: [], configPaths: [] },
    forbiddenPaths: []
  });
}
