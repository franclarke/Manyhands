import { describe, expect, it } from "vitest";
import type { AgentTaskContract } from "@manyhands/contracts";
import type { AgentExecutionResult, GranularityVector, IntegrationResult, RunExecutionResult } from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";
import { createInitialRunModel, reduceRunEvents } from "@/lib/run-model/reducer";
import { buildDecisionChannelView } from "@/lib/run-model/decision-channel-view";
import { selectEvidence, selectGranularityMetrics, selectRenderableNodeState } from "@/lib/run-model/selectors";
import {
  buildRunModelSeed,
  projectRunRecordToRunEvents
} from "@/lib/server/runs/run-model-projection";
import type { RunRecord } from "@/lib/server/runs/schema";

const AT = "2026-06-06T00:00:00.000Z";

const VECTOR: GranularityVector = {
  depth: 1,
  leafCount: 1,
  compositeCount: 1,
  avgLeafDepth: 1,
  maxLeafDepth: 1,
  dependencyCount: 0,
  avgAcceptanceCriteriaPerLeaf: 1,
  integrationSuccessRate: 1,
  leafSuccessRate: 1,
  conflictRate: 0,
  totalDurationMs: 1200,
  linesChanged: 3,
  unexpectedCommitCount: 0,
  scopeViolationCount: 0,
  testsPassedRate: 1
};

describe("run-model record projection", () => {
  it("projects a persisted plan into proposal nodes and an approval decision", () => {
    const run = makeRun({ status: "needs_review", planning: makePlanning() });
    const events = projectRunRecordToRunEvents(run);
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), events);

    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index + 1));
    expect([...model.nodes.keys()].sort()).toEqual(["leaf-a", "root"]);
    expect(model.nodes.get("leaf-a")?.scope.paths).toEqual(["src/leaf-a.ts"]);
    expect(buildDecisionChannelView(model).items.some((item) => item.kind === "approve_plan")).toBe(true);
  });

  it("projects a completed persisted run into done nodes, evidence, and metrics without SSE", () => {
    const run = makeRun({
      status: "completed",
      approvedAt: "2026-06-06T00:01:00.000Z",
      completedAt: "2026-06-06T00:02:00.000Z",
      planning: makePlanning(),
      execution: makeExecution(),
      finalCommitSha: "final123"
    });
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), projectRunRecordToRunEvents(run));

    expect(model.decisions.get("approve_plan")?.status).toBe("resolved");
    expect(selectRenderableNodeState(model, "leaf-a").display).toBe("done");
    expect(selectRenderableNodeState(model, "root").display).toBe("done");
    expect(selectGranularityMetrics(model)?.leafSuccessRate).toBe(1);
    expect(selectEvidence(model)?.integrationCommit).toBe("final123");
  });

  it("projects persisted live planning nodes when no final graph exists yet", () => {
    const run = makeRun({
      status: "generating",
      livePlanningNodes: [
        { id: "root", parentId: null, title: "Root", goal: "coord", depth: 0, state: "generating" },
        {
          id: "leaf-a",
          parentId: "root",
          title: "Leaf A",
          goal: "do a",
          depth: 1,
          state: "fallback",
          attempt: 3,
          maxAttempts: 3,
          errorKind: "missing_json"
        }
      ]
    });
    const model = reduceRunEvents(createInitialRunModel(buildRunModelSeed(run)), projectRunRecordToRunEvents(run));

    expect([...model.nodes.keys()].sort()).toEqual(["leaf-a", "root"]);
    expect(model.nodes.get("leaf-a")?.planning).toMatchObject({ state: "fallback", attempt: 3 });
  });
});

function makeRun(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    runId: "run-record",
    workspaceId: "ws-1",
    granularity: "balanced",
    model: "gemini-2.5-flash",
    userPrompt: "Feature",
    title: "Feature",
    status: "created",
    createdAt: AT,
    updatedAt: AT,
    patches: [],
    ...overrides
  };
}

function makePlanning(): {
  decomposition: {
    feature: { id: string; title: string; description: string; repositoryPath: string; targetStack: string[]; constraints: string[]; acceptanceCriteria: string[] };
    graph: TaskGraph;
    contracts: AgentTaskContract[];
  };
  riskMatrix: unknown[];
  staticConflictSignals: unknown[];
  schedule: { batches: unknown[] };
  traces: unknown[];
  summary: { mode: "balanced" };
} {
  const graph: TaskGraph = {
    id: "graph-1",
    planId: "plan-1",
    repo: "repo",
    baseBranch: "main",
    baseCommit: "base123",
    featureRequest: "Feature",
    rootId: "root",
    createdAt: AT,
    dependencies: [],
    nodes: {
      root: {
        id: "root",
        parentId: null,
        kind: "root",
        title: "Root",
        goal: "Coordinate",
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
        goal: "Do A",
        status: "planned",
        granularity: "auto",
        depth: 1,
        childrenIds: [],
        dependencies: []
      }
    }
  };
  return {
    decomposition: {
      feature: {
        id: "feature-1",
        title: "Feature",
        description: "Feature",
        repositoryPath: "repo",
        targetStack: [],
        constraints: [],
        acceptanceCriteria: ["works"]
      },
      graph,
      contracts: [contract("leaf-a")]
    },
    riskMatrix: [],
    staticConflictSignals: [],
    schedule: { batches: [] },
    traces: [],
    summary: { mode: "balanced" }
  };
}

function contract(taskId: string): AgentTaskContract {
  return {
    taskId,
    objective: "Do A",
    context: { typeSignatures: [], referenceSnippets: [], conventions: [], upstreamArtifacts: [] },
    allowed: { paths: ["src/leaf-a.ts"] },
    forbidden: { paths: [] },
    relevantSymbols: [],
    dependencies: [],
    acceptance: [{ kind: "custom", description: "works" }],
    validationCommands: [],
    expectedOutput: { changedFiles: ["src/leaf-a.ts"], producedSymbols: [], consumedSymbols: [] },
    limits: { maxDurationMs: 300000, maxCostUsd: 1 },
    knownRisks: [],
    definitionOfDone: "Done"
  };
}

function makeExecution(): RunExecutionResult {
  const leaf = successLeaf("leaf-a");
  const integration: IntegrationResult = {
    compositeTaskId: "root",
    status: "success",
    childResults: [leaf],
    integrationCommitSha: "root123",
    repairAttempted: false,
    preMergeFindings: []
  };
  return {
    runId: "run-record",
    status: "completed",
    leafResults: [leaf],
    integrationResults: [integration],
    granularityVector: VECTOR,
    validationResult: { passed: true, output: "", exitCode: 0 },
    totalDurationMs: 1200
  };
}

function successLeaf(taskId: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: "base123",
    currentHead: "leaf123",
    agentCommittedUnexpectedly: false,
    diff: "diff --git a/src/leaf-a.ts b/src/leaf-a.ts\n+export const a = 1;\n",
    changedFiles: ["src/leaf-a.ts"],
    commitSha: "leaf123",
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    validationResult: { passed: true, output: "", exitCode: 0 },
    executorExitCode: 0,
    executorDurationMs: 1000,
    executorTimedOut: false
  };
}
