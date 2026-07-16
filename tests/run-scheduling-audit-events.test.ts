import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentTaskContractSchema, type AgentTaskContract } from "@manyhands/contracts";
import type { RepositoryIndex } from "@manyhands/repository-index";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";
import { readRunModelEvents } from "@/lib/server/runs/run-model-event-log";
import { effectiveExecutionConfig } from "@/lib/server/runs/effective-execution-config";
import { persistRetryDispatch, selectAndPersistSchedulingWave } from "@/lib/server/runs/scheduling-audit-events";

let tempDir: string;
let runsDir: string;
let previousRunsDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "mh-scheduling-audit-"));
  runsDir = path.join(tempDir, "runs");
  previousRunsDir = process.env.MANYHANDS_RUNS_DIR;
  process.env.MANYHANDS_RUNS_DIR = runsDir;
});

afterEach(async () => {
  if (previousRunsDir === undefined) delete process.env.MANYHANDS_RUNS_DIR;
  else process.env.MANYHANDS_RUNS_DIR = previousRunsDir;
  await rm(tempDir, { recursive: true, force: true });
});

describe("scheduling audit events", () => {
  it("persists a retry dispatch identity before returning it to the gate", async () => {
    const runId = "run-retry-dispatch";
    const result = await persistRetryDispatch({ runId, taskId: "task-a" });
    expect(result.waveId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await readRunModelEvents(runId)).toEqual([
      expect.objectContaining({
        type: "run.scheduling.retry_dispatched",
        payload: expect.objectContaining({
          waveId: result.waveId,
          taskId: "task-a",
          source: "human_gate",
          reason: "retry_repair"
        })
      })
    ]);
  });

  it("normalizes the complete effective execution config before scheduling", () => {
    expect(effectiveExecutionConfig(undefined).maxParallel).toBe(6);
    expect(effectiveExecutionConfig({ maxParallel: 2 }).maxParallel).toBe(2);
  });

  it("caps frontiers with the effective default and explicit override", async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `task-${index}`);
    const graph = graphWithScopes(Object.fromEntries(ids.map((id) => [id, [`src/${id}/**`]])));
    const defaultWave = await selectAndPersistSchedulingWave({
      runId: "run-scheduling-default-cap", graph, candidates: ids, source: "execution-host",
      effectiveConfig: effectiveExecutionConfig(undefined)
    });
    const overrideWave = await selectAndPersistSchedulingWave({
      runId: "run-scheduling-override-cap", graph, candidates: ids, source: "execution-host",
      effectiveConfig: effectiveExecutionConfig({ maxParallel: 2 })
    });

    expect(defaultWave.selectedTaskIds).toHaveLength(6);
    expect(defaultWave.payload.maxParallel).toBe(6);
    expect(overrideWave.selectedTaskIds).toHaveLength(2);
    expect(overrideWave.payload.maxParallel).toBe(2);
  });

  it("uses a durable unique wave identity across hosts and resumes", async () => {
    const input = {
      runId: "run-scheduling-resume-wave",
      graph: graphWithScopes({ taskA: ["src/a/**"] }),
      candidates: ["taskA"],
      source: "execution-host" as const,
      effectiveConfig: effectiveExecutionConfig(undefined)
    };
    const first = await selectAndPersistSchedulingWave(input);
    const second = await selectAndPersistSchedulingWave(input);

    expect(first.payload.waveId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.payload.waveId).not.toBe(first.payload.waveId);
    expect(second.payload.waveIndex).toBeGreaterThan(first.payload.waveIndex);
    expect(first.payload.waveOrdinal).toBe(1);
    expect(second.payload.waveOrdinal).toBe(2);
    expect(await readRunModelEvents(input.runId)).toHaveLength(2);
  });

  it("derives contiguous wave ordinals independently from the global event sequence", async () => {
    const runId = "run-scheduling-human-ordinal";
    const input = {
      runId,
      graph: graphWithScopes({ taskA: ["src/a/**"] }),
      candidates: ["taskA"],
      source: "execution-host" as const,
      effectiveConfig: effectiveExecutionConfig(undefined)
    };

    await persistRetryDispatch({ runId, taskId: "noise-before" });
    const first = await selectAndPersistSchedulingWave(input);
    await persistRetryDispatch({ runId, taskId: "noise-between-1" });
    await persistRetryDispatch({ runId, taskId: "noise-between-2" });
    const second = await selectAndPersistSchedulingWave(input);

    expect(first.payload).toMatchObject({ waveIndex: 0, waveOrdinal: 1 });
    expect(second.payload).toMatchObject({ waveIndex: 1, waveOrdinal: 2 });
    const waveEvents = (await readRunModelEvents(runId)).filter((event) => event.type === "run.scheduling.wave_selected");
    expect(waveEvents.map((event) => event.seq)).toEqual([2, 5]);
  });

  it("persists a required scheduling event before returning a selected wave", async () => {
    const runId = "run-scheduling-overlap";
    const result = await selectAndPersistSchedulingWave({
      runId,
      graph: graphWithScopes({ taskA: ["src/shared/**"], taskB: ["src/shared/file.ts"] }),
      candidates: ["taskA", "taskB"],
      waveIndex: 0,
      source: "execution-host"
    });

    expect(result.selectedTaskIds).toEqual(["taskA"]);

    const events = await readRunModelEvents(runId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "run.scheduling.wave_selected",
      actor: "system",
      payload: {
        version: 1,
        source: "execution-host",
        waveIndex: 0,
        waveOrdinal: 1,
        policy: "risk_aware",
        readyTaskIds: ["taskA", "taskB"],
        selectedTaskIds: ["taskA"],
        blockedTaskIds: ["taskB"],
        riskSummary: { high: 1 }
      }
    });
    expect(events[0]?.payload.blockedReasons).toEqual([
      expect.objectContaining({
        taskId: "taskB",
        relatedTaskIds: ["taskA"],
        riskLevel: "high"
      })
    ]);
  });

  it("does not return a wave when the required scheduling event append fails", async () => {
    const runId = "run-scheduling-append-fails";
    await mkdir(path.join(runsDir, `${runId}.events.jsonl`), { recursive: true });
    let dispatched = false;

    await expect(
      (async () => {
        await selectAndPersistSchedulingWave({
          runId,
          graph: graphWithScopes({ taskA: ["src/a/**"], taskB: ["src/b/**"] }),
          candidates: ["taskA", "taskB"],
          waveIndex: 0,
          source: "execution-host"
        });
        dispatched = true;
      })()
    ).rejects.toThrow();

    expect(dispatched).toBe(false);
  });

  it("explains serialization caused by high conflict risk", async () => {
    const runId = "run-scheduling-risk";
    await selectAndPersistSchedulingWave({
      runId,
      graph: graphWithScopes({ taskA: ["src/a/**"], taskB: ["src/b/**"] }),
      candidates: ["taskA", "taskB"],
      waveIndex: 0,
      source: "execution-host",
      riskMatrix: [
        {
          taskAId: "taskA",
          taskBId: "taskB",
          level: "high",
          score: 0.9,
          evidence: [{ signal: "file_overlap", detail: "both edit src/shared.ts", weight: 0.9 }],
          sharedFiles: ["src/shared.ts"],
          sharedSymbols: [],
          predictedConflictTypes: ["file_overlap"],
          recommendation: "serialize",
          explanation: "both edit src/shared.ts"
        }
      ]
    });

    const event = (await readRunModelEvents(runId))[0];
    expect(event?.payload).toMatchObject({
      selectedTaskIds: ["taskA"],
      blockedTaskIds: ["taskB"],
      blockedReasons: [
        {
          taskId: "taskB",
          reason: "both edit src/shared.ts",
          relatedTaskIds: ["taskA"],
          riskLevel: "high"
        }
      ]
    });
  });

  it("explains safe parallelism when scopes and risks are independent", async () => {
    const runId = "run-scheduling-parallel";
    await selectAndPersistSchedulingWave({
      runId,
      graph: graphWithScopes({ taskA: ["src/a/**"], taskB: ["src/b/**"] }),
      candidates: ["taskA", "taskB"],
      waveIndex: 0,
      source: "execution-host"
    });

    const event = (await readRunModelEvents(runId))[0];
    expect(event?.payload).toMatchObject({
      selectedTaskIds: ["taskA", "taskB"],
      blockedTaskIds: [],
      blockedReasons: [],
      riskSummary: { high: 0, blocking: 0 }
    });
  });

  it("persists compact repository-index reasons for enriched scheduling risk", async () => {
    const runId = "run-scheduling-repo-index";
    await selectAndPersistSchedulingWave({
      runId,
      graph: graphWithContracts({
        exporter: contractWithExpected("exporter", {
          paths: ["src/api.ts"],
          changedFiles: ["src/api.ts"],
          producedSymbols: ["ApiClient"]
        }),
        consumer: contractWithExpected("consumer", {
          paths: ["src/feature.ts"],
          changedFiles: ["src/feature.ts"],
          consumedSymbols: ["ApiClient"]
        })
      }),
      candidates: ["exporter", "consumer"],
      waveIndex: 0,
      source: "execution-host",
      repositoryIndex: repositoryIndex()
    });

    const event = (await readRunModelEvents(runId))[0];
    expect(event?.payload).toMatchObject({
      selectedTaskIds: ["exporter"],
      blockedTaskIds: ["consumer"],
      riskSummary: { high: 1 }
    });
    expect(event?.payload.blockedReasons).toEqual([
      expect.objectContaining({
        taskId: "consumer",
        reason: expect.stringContaining("imports src/api.ts"),
        relatedTaskIds: ["exporter"],
        riskLevel: "high"
      })
    ]);
    const payload = event?.payload as { warnings: Array<{ code: string }> } | undefined;
    expect(payload?.warnings.map((warning) => warning.code)).not.toContain("missing_repository_index");
  });
});

function graphWithScopes(scopes: Record<string, string[]>): TaskGraph {
  const leaves = Object.entries(scopes).map(([id, paths]) => leaf(id, paths));
  return graphFromLeaves(leaves);
}

function graphWithContracts(contracts: Record<string, AgentTaskContract>): TaskGraph {
  return graphFromLeaves(Object.entries(contracts).map(([id, item]) => leafWithContract(id, item)));
}

function graphFromLeaves(leaves: TaskNode[]): TaskGraph {
  const root: TaskNode = {
    id: "root",
    parentId: null,
    kind: "root",
    title: "root",
    goal: "root goal",
    status: "planned",
    granularity: "auto",
    depth: 0,
    childrenIds: leaves.map((node) => node.id),
    dependencies: []
  };
  return {
    id: "graph",
    planId: "plan",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "sha",
    featureRequest: "feature",
    rootId: "root",
    createdAt: "2026-06-18T00:00:00.000Z",
    nodes: Object.fromEntries([root, ...leaves].map((node) => [node.id, node])),
    dependencies: []
  };
}

function leaf(id: string, paths: string[]): TaskNode {
  return leafWithContract(id, contract(id, paths));
}

function leafWithContract(id: string, item: AgentTaskContract): TaskNode {
  return {
    id,
    parentId: "root",
    kind: "leaf",
    title: id,
    goal: `goal ${id}`,
    status: "planned",
    granularity: "auto",
    depth: 1,
    childrenIds: [],
    dependencies: [],
    contract: item
  };
}

function contract(taskId: string, paths: string[]): AgentTaskContract {
  return contractWithExpected(taskId, { paths, changedFiles: [] });
}

function contractWithExpected(
  taskId: string,
  input: {
    paths: string[];
    changedFiles: string[];
    producedSymbols?: string[];
    consumedSymbols?: string[];
  }
): AgentTaskContract {
  return AgentTaskContractSchema.parse({
    taskId,
    objective: `objective ${taskId}`,
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: input.paths },
    forbidden: { paths: [] },
    relevantSymbols: [...(input.producedSymbols ?? []), ...(input.consumedSymbols ?? [])],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "done" }],
    validationCommands: [],
    expectedOutput: {
      changedFiles: input.changedFiles,
      producedSymbols: input.producedSymbols ?? [],
      consumedSymbols: input.consumedSymbols ?? [],
      diffShapeHint: "diff"
    },
    limits: { maxDurationMs: 1000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "done",
    executionScope: { implementationPaths: input.paths, testPaths: [], configPaths: [] }
  });
}

function repositoryIndex(): RepositoryIndex {
  return {
    repositoryId: "repo",
    rootPath: "/repo",
    indexedAt: "2026-06-18T00:00:00.000Z",
    files: [
      {
        path: "src/api.ts",
        kind: "source",
        declaredSymbols: ["ApiClient"],
        exportedSymbols: ["ApiClient"],
        importedSymbols: []
      },
      {
        path: "src/feature.ts",
        kind: "source",
        declaredSymbols: ["Feature"],
        exportedSymbols: ["Feature"],
        importedSymbols: ["ApiClient"]
      }
    ],
    symbols: [
      { name: "ApiClient", kind: "type", filePath: "src/api.ts", exported: true, line: 1 },
      { name: "Feature", kind: "function", filePath: "src/feature.ts", exported: true, line: 3 }
    ],
    imports: [{ filePath: "src/feature.ts", moduleSpecifier: "./api", importedSymbols: ["ApiClient"] }],
    exports: [
      { filePath: "src/api.ts", exportedSymbols: ["ApiClient"] },
      { filePath: "src/feature.ts", exportedSymbols: ["Feature"] }
    ],
    diagnostics: [],
    metadata: {
      indexer: "test",
      deterministic: true,
      fileCount: 2,
      symbolCount: 2,
      importCount: 1,
      exportCount: 2
    }
  };
}
