import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TaskGraph } from "@manyhands/task-graph";
import { JsonFileCheckpointSaver } from "../checkpointer.js";
import {
  buildPlanningGraph,
  planningThreadId,
  type DecomposePlanInput,
  type DecomposePlanResult,
  type PlanCritique,
  type PlanningGraphDeps
} from "./planning-graph.js";

const TINY_GRAPH = {
  id: "graph-1",
  rootId: "root",
  nodes: {},
  dependencies: []
} as unknown as TaskGraph;

const CLEAN_CRITIQUE: PlanCritique = { findings: [], errorCount: 0 };

function initialState(runId: string) {
  return {
    runId,
    userPrompt: "build a habit tracker",
    workspaceId: "ws-1",
    repoPath: "/repo",
    status: "planning" as const,
    taskGraph: null,
    planningStepCache: {},
    userAnswers: {},
    pendingQuestion: null,
    errorMessage: null
  };
}

function threadConfig(runId: string) {
  return { configurable: { thread_id: planningThreadId(runId) } };
}

type PlanningGraph = ReturnType<typeof buildPlanningGraph>;

async function drive(graph: PlanningGraph, input: unknown, config: ReturnType<typeof threadConfig>) {
  const stream = await graph.stream(input as never, { ...config, streamMode: "updates" });
  for await (const _chunk of stream) {
    void _chunk;
  }
  return graph.getState(config);
}

function firstInterrupt(state: Awaited<ReturnType<PlanningGraph["getState"]>>): unknown {
  return state.tasks.flatMap((task) => task.interrupts)[0]?.value;
}

function depsFor(overrides: Partial<PlanningGraphDeps> = {}): PlanningGraphDeps {
  return {
    decomposePlan: async () => ({ kind: "complete", graph: TINY_GRAPH }),
    runCritics: async () => CLEAN_CRITIQUE,
    ...overrides
  };
}

describe("planning graph v2 (native HITL)", () => {
  it("decomposes, runs critics, and suspends on the plan approval gate", async () => {
    const critique: PlanCritique = {
      findings: [{ severity: "warning", message: "leaf without tests", source: "plan" }],
      errorCount: 0
    };
    const graph = buildPlanningGraph({
      deps: depsFor({ runCritics: async () => critique })
    });
    const config = threadConfig("run-a");

    const state = await drive(graph, initialState("run-a"), config);

    const interrupt = firstInterrupt(state) as { type: string; critique: PlanCritique };
    expect(interrupt.type).toBe("plan_approval");
    expect(interrupt.critique).toEqual(critique);
    expect((state.values as { taskGraph: TaskGraph | null }).taskGraph).toEqual(TINY_GRAPH);

    const resumed = await drive(graph, new Command({ resume: { action: "approve" } }), config);
    expect((resumed.values as { status: string }).status).toBe("approved");
    expect(resumed.next).toEqual([]);
  });

  it("suspends on a planning question and threads the answer + step cache back into the decomposer", async () => {
    const calls: DecomposePlanInput[] = [];
    const decomposePlan = async (input: DecomposePlanInput): Promise<DecomposePlanResult> => {
      calls.push(input);
      if (calls.length === 1) {
        return {
          kind: "question",
          nodeId: "root",
          question: "Which persistence layer?",
          options: ["sqlite", "localStorage"],
          stepCache: { resumeFrom: "root" }
        };
      }
      return { kind: "complete", graph: TINY_GRAPH };
    };
    const graph = buildPlanningGraph({ deps: depsFor({ decomposePlan }) });
    const config = threadConfig("run-b");

    const paused = await drive(graph, initialState("run-b"), config);
    const interrupt = firstInterrupt(paused) as { type: string; nodeId: string; options: string[] };
    expect(interrupt.type).toBe("planning_question");
    expect(interrupt.nodeId).toBe("root");
    expect(interrupt.options).toEqual(["sqlite", "localStorage"]);

    const afterAnswer = await drive(graph, new Command({ resume: { answer: "sqlite" } }), config);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.userAnswers).toMatchObject({ root: "sqlite" });
    expect(calls[1]?.stepCache).toEqual({ resumeFrom: "root" });

    const approval = firstInterrupt(afterAnswer) as { type: string };
    expect(approval.type).toBe("plan_approval");
  });

  it("ends in needs_review when the human rejects the plan", async () => {
    const graph = buildPlanningGraph({ deps: depsFor() });
    const config = threadConfig("run-c");

    await drive(graph, initialState("run-c"), config);
    const rejected = await drive(graph, new Command({ resume: { action: "reject" } }), config);

    expect((rejected.values as { status: string }).status).toBe("needs_review");
    expect(rejected.next).toEqual([]);
  });

  describe("cross-process resume via JsonFileCheckpointSaver", () => {
    let dir: string;

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "mh-plan-graph-"));
    });

    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("a fresh graph instance resumes a suspended question from disk", async () => {
      const calls: DecomposePlanInput[] = [];
      const decomposePlan = async (input: DecomposePlanInput): Promise<DecomposePlanResult> => {
        calls.push(input);
        if (calls.length === 1) {
          return {
            kind: "question",
            nodeId: "root",
            question: "Monorepo or single package?",
            options: ["monorepo", "single"],
            stepCache: { cursor: 7 }
          };
        }
        return { kind: "complete", graph: TINY_GRAPH };
      };
      const config = threadConfig("run-d");

      const first = buildPlanningGraph({
        deps: depsFor({ decomposePlan }),
        checkpointer: new JsonFileCheckpointSaver(dir)
      });
      const paused = await drive(first, initialState("run-d"), config);
      expect((firstInterrupt(paused) as { type: string }).type).toBe("planning_question");

      // Simulate a process restart: brand-new graph over the same directory.
      const second = buildPlanningGraph({
        deps: depsFor({ decomposePlan }),
        checkpointer: new JsonFileCheckpointSaver(dir)
      });
      const resumed = await drive(second, new Command({ resume: { answer: "monorepo" } }), config);

      expect(calls[1]?.stepCache).toEqual({ cursor: 7 });
      expect((firstInterrupt(resumed) as { type: string }).type).toBe("plan_approval");
    });
  });
});
