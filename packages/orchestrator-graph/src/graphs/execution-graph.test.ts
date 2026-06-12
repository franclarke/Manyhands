/**
 * Tests for the dynamic-wavefront execution StateGraph.
 *
 * Covers the full topology with fake deps:
 *  - parallel dispatch of independent leaves + dependency ordering
 *  - adaptive wave selection constraint (selectWave)
 *  - auto-repair inside executeLeaf (no interrupt when repair succeeds)
 *  - leafGate HITL: retry_repair and accept_failing via Command({ resume })
 *  - conflictGate HITL: accept_conflict
 *  - identity reducers (retry replaces the failed result, no duplicates)
 *  - cross-process resume: a fresh graph instance + JsonFileCheckpointSaver
 *    continues from the interrupt without re-running executors
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "@langchain/langgraph";
import { buildExecutionGraph, executionRecursionLimit } from "./execution-graph.js";
import { JsonFileCheckpointSaver } from "../checkpointer.js";
import type { RunState } from "../state.js";
import type { LeafExecutionInput } from "../nodes/execution-nodes.js";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeNode(partial: Partial<TaskNode> & { id: string; kind: TaskNode["kind"] }): TaskNode {
  return {
    parentId: null,
    title: partial.id,
    goal: `goal of ${partial.id}`,
    status: "planned",
    granularity: "auto",
    depth: 0,
    childrenIds: [],
    dependencies: [],
    ...partial
  };
}

/**
 * root (composite)
 * ├── leaf-a (independent)
 * ├── leaf-b (independent)
 * └── leaf-c (depends on leaf-a)
 */
function makeGraph(): TaskGraph {
  return {
    id: "graph-1",
    planId: "plan-1",
    repo: "C:/tmp/repo",
    baseBranch: "main",
    baseCommit: "base-sha",
    featureRequest: "test feature",
    rootId: "root",
    createdAt: new Date().toISOString(),
    nodes: {
      root: makeNode({ id: "root", kind: "root", childrenIds: ["leaf-a", "leaf-b", "leaf-c"] }),
      "leaf-a": makeNode({ id: "leaf-a", kind: "leaf", parentId: "root", depth: 1 }),
      "leaf-b": makeNode({ id: "leaf-b", kind: "leaf", parentId: "root", depth: 1 }),
      "leaf-c": makeNode({ id: "leaf-c", kind: "leaf", parentId: "root", depth: 1 })
    },
    dependencies: [{ fromTaskId: "leaf-a", toTaskId: "leaf-c", type: "logical", inferred: false }]
  };
}

function leafResult(taskId: string, status: AgentExecutionResult["status"] = "success"): AgentExecutionResult {
  return {
    taskId,
    status,
    baseHead: "base-sha",
    currentHead: `head-${taskId}`,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [`src/${taskId}.ts`],
    ...(status === "success" ? { commitSha: `commit-${taskId}` } : {}),
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: status === "success" ? 0 : 1,
    executorDurationMs: 5,
    executorTimedOut: false,
    stderrTail: status === "success" ? "" : `validation broke in ${taskId}`,
    stdoutTail: ""
  };
}

function integrationResult(
  compositeTaskId: string,
  status: IntegrationResult["status"] = "success"
): IntegrationResult {
  return {
    compositeTaskId,
    status,
    childResults: [],
    repairAttempted: false,
    preMergeFindings: [],
    ...(status === "success" || status === "executor_repair_success"
      ? { integrationCommitSha: `merge-${compositeTaskId}` }
      : {
          conflictDetails: { files: [`src/${compositeTaskId}.ts`], cherryPickOutput: "CONFLICT" }
        })
  } as IntegrationResult;
}

function initialState(graph: TaskGraph) {
  return {
    runId: "run-1",
    userPrompt: "build it",
    workspaceId: "ws-1",
    repoPath: graph.repo,
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

interface HarnessOptions {
  failingLeaves?: Set<string>;
  /** Leaves repaired successfully by the auto-repair dep. */
  repairableLeaves?: Set<string>;
  failingComposites?: Set<string>;
  /**
   * Composites whose FIRST integration attempt fails with an infra-classed
   * validation failure (spawn 127); retries succeed — models "human fixed the
   * environment and chose retry_integration".
   */
  compositesFailingOnce?: Set<string>;
  selectWave?: (params: { graph: TaskGraph; candidates: string[] }) => string[];
  checkpointer?: JsonFileCheckpointSaver;
}

function makeHarness(options: HarnessOptions = {}) {
  const executions: string[] = [];
  const repairs: string[] = [];
  const integrations: string[] = [];
  const waves: string[][] = [];
  let inFlight = 0;
  let maxConcurrency = 0;
  const failing = options.failingLeaves ?? new Set<string>();
  const repairable = options.repairableLeaves ?? new Set<string>();
  const failingComposites = options.failingComposites ?? new Set<string>();
  const compositesFailingOnce = options.compositesFailingOnce ?? new Set<string>();

  const graph = buildExecutionGraph({
    leafDeps: {
      executeLeaf: async (params: LeafExecutionInput) => {
        executions.push(params.taskId);
        inFlight += 1;
        maxConcurrency = Math.max(maxConcurrency, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        const attempts = executions.filter((id) => id === params.taskId).length;
        // A failing leaf succeeds on its second full execution (gate retry path).
        const shouldFail = failing.has(params.taskId) && attempts === 1;
        return { result: leafResult(params.taskId, shouldFail ? "validation_failed" : "success") };
      },
      repairLeaf: async (params) => {
        repairs.push(params.taskId);
        if (repairable.has(params.taskId)) {
          return { result: leafResult(params.taskId, "success") };
        }
        return null;
      },
      maxRepairAttempts: 2
    },
    integrateDeps: {
      integrateComposite: async (params) => {
        integrations.push(params.compositeTaskId);
        const attempts = integrations.filter((id) => id === params.compositeTaskId).length;
        if (compositesFailingOnce.has(params.compositeTaskId) && attempts === 1) {
          return {
            ...integrationResult(params.compositeTaskId, "validation_failed"),
            conflictDetails: undefined,
            parentValidation: { passed: false, output: "spawn npm ENOENT", exitCode: 127 }
          } as IntegrationResult;
        }
        const status = failingComposites.has(params.compositeTaskId) ? "executor_repair_failed" : "success";
        return integrationResult(params.compositeTaskId, status);
      }
    },
    validationDeps: {
      validateRun: async () => ({ passed: true })
    },
    frontierDeps: {
      selectWave: (params) => {
        const selected = options.selectWave?.(params) ?? params.candidates;
        waves.push([...selected]);
        return selected;
      }
    },
    ...(options.checkpointer !== undefined ? { checkpointer: options.checkpointer } : {})
  });

  return { graph, executions, repairs, integrations, waves, maxConcurrency: () => maxConcurrency };
}

const threadConfig = (threadId: string, graph: TaskGraph) => ({
  configurable: { thread_id: threadId },
  recursionLimit: executionRecursionLimit({ taskGraph: graph })
});

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("execution graph — dynamic wavefront", () => {
  it("runs independent leaves in parallel and dependents in later waves", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness();

    const final = (await harness.graph.invoke(
      initialState(taskGraph),
      threadConfig("t-parallel", taskGraph)
    )) as RunState;

    expect(final.status).toBe("completed");
    expect(harness.maxConcurrency()).toBe(2); // leaf-a ∥ leaf-b
    expect(harness.waves[0]).toEqual(["leaf-a", "leaf-b"]);
    expect(harness.waves[1]).toEqual(["leaf-c"]);
    expect(harness.executions.indexOf("leaf-c")).toBeGreaterThan(harness.executions.indexOf("leaf-a"));
    expect(harness.integrations).toEqual(["root"]);
    expect(final.leafResults).toHaveLength(3);
    expect(final.integrationResults).toHaveLength(1);
  });

  it("honours the adaptive selectWave subset (serialized execution)", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({
      selectWave: ({ candidates }) => candidates.slice(0, 1)
    });

    const final = (await harness.graph.invoke(
      initialState(taskGraph),
      threadConfig("t-serial", taskGraph)
    )) as RunState;

    expect(final.status).toBe("completed");
    expect(harness.maxConcurrency()).toBe(1);
    expect(harness.executions).toEqual(["leaf-a", "leaf-b", "leaf-c"]);
  });

  it("auto-repairs a failing leaf without interrupting", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({
      failingLeaves: new Set(["leaf-b"]),
      repairableLeaves: new Set(["leaf-b"])
    });

    const final = (await harness.graph.invoke(
      initialState(taskGraph),
      threadConfig("t-autorepair", taskGraph)
    )) as RunState;

    expect(final.status).toBe("completed");
    expect(harness.repairs).toEqual(["leaf-b"]);
    expect(final.leafResults.filter((r) => r.taskId === "leaf-b")).toHaveLength(1);
    expect(final.leafResults.find((r) => r.taskId === "leaf-b")?.status).toBe("success");
  });

  it("interrupts at leafGate and resumes with retry_repair", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({ failingLeaves: new Set(["leaf-a"]) });
    const config = threadConfig("t-retry", taskGraph);

    await harness.graph.invoke(initialState(taskGraph), config);
    const paused = await harness.graph.getState(config);
    const interruptValue = paused.tasks[0]?.interrupts[0]?.value as { type: string; taskId: string };
    expect(interruptValue.type).toBe("leaf_validation_failed");
    expect(interruptValue.taskId).toBe("leaf-a");

    const executionsBeforeResume = harness.executions.length;
    const final = (await harness.graph.invoke(
      new Command({ resume: { action: "retry_repair" } }),
      config
    )) as RunState;

    expect(final.status).toBe("completed");
    // Retry re-ran ONLY leaf-a (plus the still-blocked leaf-c afterwards).
    expect(harness.executions.slice(executionsBeforeResume)).toEqual(["leaf-a", "leaf-c"]);
    // Identity reducer: the retried result replaced the failed one.
    expect(final.leafResults.filter((r) => r.taskId === "leaf-a")).toHaveLength(1);
    expect(final.leafResults.find((r) => r.taskId === "leaf-a")?.status).toBe("success");
  });

  it("accept_failing unblocks integration and finishes the run as failed", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({ failingLeaves: new Set(["leaf-b"]) });
    const config = threadConfig("t-accept", taskGraph);

    await harness.graph.invoke(initialState(taskGraph), config);
    const final = (await harness.graph.invoke(
      new Command({ resume: { action: "accept_failing" } }),
      config
    )) as RunState;

    // root integrates with a failed child → integration dep is reached; the
    // run finishes failed because a failure was accepted.
    expect(final.acceptedLeafFailures).toEqual(["leaf-b"]);
    expect(final.status).toBe("failed");
    expect(final.errorMessage).toMatch(/accepted failures/i);
    expect(harness.integrations).toEqual(["root"]);
  });

  it("interrupts at conflictGate and accept_conflict finishes the run as failed", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({ failingComposites: new Set(["root"]) });
    const config = threadConfig("t-conflict", taskGraph);

    await harness.graph.invoke(initialState(taskGraph), config);
    const paused = await harness.graph.getState(config);
    const interruptValue = paused.tasks[0]?.interrupts[0]?.value as {
      type: string;
      compositeTaskId: string;
      conflictDetails?: { files: string[] };
    };
    expect(interruptValue.type).toBe("merge_conflict");
    expect(interruptValue.compositeTaskId).toBe("root");
    expect(interruptValue.conflictDetails?.files).toEqual(["src/root.ts"]);

    const final = (await harness.graph.invoke(
      new Command({ resume: { action: "accept_conflict" } }),
      config
    )) as RunState;

    expect(final.acceptedIntegrationFailures).toEqual(["root"]);
    expect(final.status).toBe("failed");
  });

  it("classifies an infra validation failure and retry_integration re-runs the composite to completion", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({ compositesFailingOnce: new Set(["root"]) });
    const config = threadConfig("t-retry-integration", taskGraph);

    await harness.graph.invoke(initialState(taskGraph), config);
    const paused = await harness.graph.getState(config);
    const interruptValue = paused.tasks[0]?.interrupts[0]?.value as {
      type: string;
      failureClass: string;
      validationExitCode?: number;
    };
    // exit 127 (binary missing) must surface as infra, never as a merge conflict.
    expect(interruptValue.type).toBe("merge_conflict");
    expect(interruptValue.failureClass).toBe("infra");
    expect(interruptValue.validationExitCode).toBe(127);

    const final = (await harness.graph.invoke(
      new Command({ resume: { action: "retry_integration" } }),
      config
    )) as RunState;

    // The tombstone deleted the failed result and the composite re-integrated.
    expect(harness.integrations).toEqual(["root", "root"]);
    expect(final.status).toBe("completed");
    expect(final.integrationResults).toHaveLength(1);
    expect(final.integrationResults[0]?.status).toBe("success");
    expect(final.acceptedIntegrationFailures).toEqual([]);
  });

  it("a persistent failure re-gates after retry_integration (each retry is a human decision)", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({ failingComposites: new Set(["root"]) });
    const config = threadConfig("t-retry-persistent", taskGraph);

    await harness.graph.invoke(initialState(taskGraph), config);
    await harness.graph.invoke(new Command({ resume: { action: "retry_integration" } }), config);

    // Failed again → a fresh interrupt, not a silent loop.
    const paused = await harness.graph.getState(config);
    expect(paused.tasks[0]?.interrupts).toHaveLength(1);
    expect(harness.integrations).toEqual(["root", "root"]);

    const final = (await harness.graph.invoke(
      new Command({ resume: { action: "accept_conflict" } }),
      config
    )) as RunState;
    expect(final.acceptedIntegrationFailures).toEqual(["root"]);
    expect(final.status).toBe("failed");
  });

  it("abort_run at leafGate fails the run immediately", async () => {
    const taskGraph = makeGraph();
    const harness = makeHarness({ failingLeaves: new Set(["leaf-a"]) });
    const config = threadConfig("t-abort", taskGraph);

    await harness.graph.invoke(initialState(taskGraph), config);
    const final = (await harness.graph.invoke(
      new Command({ resume: { action: "abort_run" } }),
      config
    )) as RunState;

    expect(final.status).toBe("failed");
    expect(final.errorMessage).toMatch(/aborted by user/i);
    expect(harness.integrations).toEqual([]);
  });
});

describe("execution graph — cross-process resume (JsonFileCheckpointSaver)", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mh-exec-graph-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("a fresh graph instance resumes from the interrupt without re-running executors", async () => {
    const taskGraph = makeGraph();
    const config = threadConfig("t-process-restart", taskGraph);

    // Process 1: run until the leafGate interrupt.
    const first = makeHarness({
      failingLeaves: new Set(["leaf-a"]),
      checkpointer: new JsonFileCheckpointSaver(dir)
    });
    await first.graph.invoke(initialState(taskGraph), config);
    expect(first.executions.sort()).toEqual(["leaf-a", "leaf-b"]);

    // Process 2: brand-new graph + checkpointer over the same directory.
    const second = makeHarness({ checkpointer: new JsonFileCheckpointSaver(dir) });
    const restored = await second.graph.getState(config);
    expect(restored.tasks[0]?.interrupts[0]?.value).toMatchObject({
      type: "leaf_validation_failed",
      taskId: "leaf-a"
    });

    const final = (await second.graph.invoke(
      new Command({ resume: { action: "retry_repair" } }),
      config
    )) as RunState;

    expect(final.status).toBe("completed");
    // The fresh process re-ran only the retried leaf and its dependent —
    // leaf-b's success was restored from the checkpoint, not re-executed.
    expect(second.executions).toEqual(["leaf-a", "leaf-c"]);
    expect(final.leafResults).toHaveLength(3);
  });
});

// ─── Budget gate (U5) ───────────────────────────────────────────────────────

describe("execution graph — budget gate", () => {
  function usageLeafResult(taskId: string, tokens: number): AgentExecutionResult {
    return { ...leafResult(taskId, "success"), tokensIn: tokens / 2, tokensOut: tokens / 2, costUsd: tokens / 1000, usageSource: "reported" };
  }

  function makeBudgetHarness(tokensPerLeaf: number) {
    const executions: string[] = [];
    const graph = buildExecutionGraph({
      leafDeps: {
        executeLeaf: async (params: LeafExecutionInput) => {
          executions.push(params.taskId);
          return { result: usageLeafResult(params.taskId, tokensPerLeaf) };
        },
        maxRepairAttempts: 0
      },
      integrateDeps: {
        integrateComposite: async (params) => integrationResult(params.compositeTaskId, "success")
      },
      validationDeps: { validateRun: async () => ({ passed: true }) },
      // Serialize waves so the budget check fires BETWEEN leaves.
      frontierDeps: { selectWave: ({ candidates }) => candidates.slice(0, 1) }
    });
    return { graph, executions };
  }

  function budgetState(taskGraph: TaskGraph, maxTokensTotal: number) {
    return { ...initialState(taskGraph), budgetLimits: { maxTokensTotal }, finishPartial: false };
  }

  async function drive(graph: ReturnType<typeof buildExecutionGraph>, input: unknown, config: ReturnType<typeof threadConfig>) {
    const stream = await graph.stream(input as never, { ...config, streamMode: "updates" as const });
    for await (const _chunk of stream) void _chunk;
    return graph.getState(config);
  }

  function firstInterrupt(state: Awaited<ReturnType<ReturnType<typeof buildExecutionGraph>["getState"]>>): unknown {
    return state.tasks.flatMap((task) => task.interrupts)[0]?.value;
  }

  it("suspends BETWEEN waves when the token budget is exceeded; extend_budget finishes the run", async () => {
    const taskGraph = makeGraph();
    const harness = makeBudgetHarness(80); // 2 leaves = 160 ≥ 100
    const config = threadConfig("t-budget-extend", taskGraph);

    const paused = await drive(harness.graph, budgetState(taskGraph, 100), config);
    const interrupt = firstInterrupt(paused) as {
      type: string;
      spentTokens: number;
      pendingTasks: string[];
    };
    expect(interrupt.type).toBe("budget_exceeded");
    expect(interrupt.spentTokens).toBe(160);
    expect(interrupt.pendingTasks).toEqual(["leaf-c"]);
    // No leaf was cut mid-flight: exactly the two completed waves ran.
    expect(harness.executions).toEqual(["leaf-a", "leaf-b"]);

    const final = await drive(harness.graph, new Command({ resume: { action: "extend_budget" } }), config);
    expect((final.values as RunState).status).toBe("completed");
    expect(harness.executions).toEqual(["leaf-a", "leaf-b", "leaf-c"]);
  });

  it("finish_partial integrates only what is complete and closes the run explicitly", async () => {
    const taskGraph = makeGraph();
    const harness = makeBudgetHarness(80);
    const config = threadConfig("t-budget-partial", taskGraph);

    await drive(harness.graph, budgetState(taskGraph, 100), config);
    const final = await drive(harness.graph, new Command({ resume: { action: "finish_partial" } }), config);

    const values = final.values as RunState;
    expect(harness.executions).toEqual(["leaf-a", "leaf-b"]); // leaf-c never dispatched
    expect(values.status).toBe("failed"); // sanctioned: explicit human decision
    expect(values.errorMessage).toContain("partially");
    // root is not integrable without leaf-c → no integrations were attempted.
    expect(values.integrationResults).toHaveLength(0);
  });

  it("abort_run at the budget gate ends the run with the spend in the message", async () => {
    const taskGraph = makeGraph();
    const harness = makeBudgetHarness(120); // first leaf already exceeds
    const config = threadConfig("t-budget-abort", taskGraph);

    await drive(harness.graph, budgetState(taskGraph, 100), config);
    const final = await drive(harness.graph, new Command({ resume: { action: "abort_run" } }), config);

    const values = final.values as RunState;
    expect(values.status).toBe("failed");
    expect(values.errorMessage).toContain("budget gate");
  });

  it("without limits the budget gate never fires", async () => {
    const taskGraph = makeGraph();
    const harness = makeBudgetHarness(10_000);
    const config = threadConfig("t-budget-off", taskGraph);

    const final = await drive(harness.graph, { ...initialState(taskGraph), budgetLimits: null, finishPartial: false }, config);
    expect((final.values as RunState).status).toBe("completed");
    expect(harness.executions).toHaveLength(3);
  });
});
