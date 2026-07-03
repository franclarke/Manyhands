/**
 * Execution nodes for the ManyHands LangGraph orchestrator.
 *
 * Topology contract (see graphs/execution-graph.ts):
 *
 *   START → prepare → waveJoin ─[routeFrontier]→ Send(executeLeaf)* | leafGate | integrationJoin
 *   executeLeaf → waveJoin
 *   leafGate ─Command→ Send(executeLeaf) | waveJoin | END
 *   integrationJoin ─[routeIntegration]→ integrateNextComposite | conflictGate | runValidation
 *   integrateNextComposite → integrationJoin
 *   conflictGate ─Command→ integrationJoin | END
 *   runValidation → END
 *
 * Design principles:
 *  - Sends are dispatched ONLY from conditional edges (the valid LangGraph
 *    pattern); nodes never return raw Send arrays.
 *  - The execution frontier is computed dynamically per superstep (wavefront):
 *    no precomputed batch list, no batch index to advance.
 *  - interrupt() lives ONLY in cheap, side-effect-free gate nodes, so resuming
 *    with Command({ resume }) never re-runs an agent executor or a cherry-pick.
 *  - integrateNextComposite integrates exactly ONE composite per superstep so
 *    every integration commit lands in its own checkpoint (granular time-travel).
 */
import { Command, END, interrupt, Send } from "@langchain/langgraph";
import type { RunState, RunStateUpdate } from "../state.js";
import { classifyIntegrationFailure } from "@manyhands/execution-core";
import type { AgentExecutionResult, IntegrationResult } from "@manyhands/execution-core";
import type { TaskGraph, TaskNode } from "@manyhands/task-graph";

const INTEGRATION_SUCCESS = new Set(["success", "executor_repair_success"]);

// ─── Resume decisions (shared contract with the web UI) ────────────────────

/** Decision payload accepted by the leaf validation gate. */
export type LeafGateDecision =
  | { action: "retry_repair"; taskId?: string }
  | { action: "accept_failing"; taskId?: string }
  | { action: "abort_run" };

/** Decision payload accepted by the integration conflict gate. */
export type ConflictGateDecision =
  | { action: "accept_conflict"; compositeTaskId?: string }
  | { action: "retry_integration"; compositeTaskId?: string }
  | { action: "abort_run" };

/** Decision payload accepted by the budget gate (U5). */
export type BudgetGateDecision =
  | { action: "extend_budget"; maxTokensTotal?: number; maxCostUsd?: number }
  | { action: "finish_partial" }
  | { action: "abort_run" };

export type ResumeDecision = LeafGateDecision | ConflictGateDecision | BudgetGateDecision;

/** Interrupt payload raised when a leaf keeps failing after auto-repair. */
export interface LeafValidationInterrupt {
  type: "leaf_validation_failed";
  runId: string;
  taskId: string;
  validationOutput: string;
  autoRepairAttempted: boolean;
}

/** Interrupt payload raised when integration fails beyond Composer repair. */
export interface MergeConflictInterrupt {
  type: "merge_conflict";
  compositeTaskId: string;
  status: string;
  /** Why it failed (merge_conflict | code_validation | infra | internal) — drives gate copy. */
  failureClass: string;
  /** Parent validation exit code when the failure came from validation. */
  validationExitCode?: number;
  conflictDetails?: { files: string[]; diff: string };
}

/** Interrupt payload raised when the run exceeded its token/cost budget (U5). */
export interface BudgetExceededInterrupt {
  type: "budget_exceeded";
  runId: string;
  spentTokens: number;
  spentUsd: number;
  maxTokensTotal?: number;
  maxCostUsd?: number;
  completedTasks: number;
  pendingTasks: string[];
}

function parseDecision(
  value: unknown,
  gate: "leafGate" | "conflictGate" | "budgetGate"
): { action: string } & Record<string, unknown> {
  if (typeof value === "object" && value !== null && typeof (value as { action?: unknown }).action === "string") {
    return value as { action: string };
  }
  throw new Error(
    `${gate}: invalid resume decision ${JSON.stringify(value)}. Expected { action: string, ... }.`
  );
}

// ─── Graph queries (pure helpers over RunState) ────────────────────────────

function requireGraph(state: RunState, node: string): TaskGraph {
  if (state.taskGraph === null) {
    throw new Error(`${node}: taskGraph is null`);
  }
  return state.taskGraph;
}

function executableNodes(graph: TaskGraph): TaskNode[] {
  return Object.values(graph.nodes).filter((node) => node.kind === "leaf" || node.kind === "integrator");
}

function leafResultFor(state: RunState, taskId: string): AgentExecutionResult | undefined {
  return state.leafResults.find((result) => result.taskId === taskId);
}

function leafSucceeded(state: RunState, taskId: string): boolean {
  return leafResultFor(state, taskId)?.status === "success";
}

function leafSettled(state: RunState, taskId: string): boolean {
  if (leafSucceeded(state, taskId)) return true;
  return leafResultFor(state, taskId) !== undefined && state.acceptedLeafFailures.includes(taskId);
}

/** Failed executable tasks the human has not yet ruled on. */
function unhandledLeafFailures(state: RunState): AgentExecutionResult[] {
  return state.leafResults.filter(
    (result) => result.status !== "success" && !state.acceptedLeafFailures.includes(result.taskId)
  );
}

/** Executable tasks with no result whose dependencies are all successful. */
function executionFrontier(state: RunState, graph: TaskGraph): string[] {
  return executableNodes(graph)
    .filter((node) => leafResultFor(state, node.id) === undefined)
    .filter((node) =>
      graph.dependencies
        .filter((dependency) => dependency.toTaskId === node.id)
        .every((dependency) => dependencySatisfied(state, graph, dependency.fromTaskId))
    )
    .map((node) => node.id)
    .sort();
}

/**
 * A dependency is satisfied when its producer has SETTLED in a way that unblocks
 * downstream — finished successfully, OR failed and had its failure accepted by
 * the human. This MUST mirror `childSettled` (the integration-side predicate):
 * if the two drift, an accepted-failing producer unblocks its composite parent
 * for integration but NOT its task dependents for execution, silently stranding
 * the whole dependent subtree (see repro-stranding.test.ts).
 */
function dependencySatisfied(state: RunState, graph: TaskGraph, fromTaskId: string): boolean {
  const producer = graph.nodes[fromTaskId];
  if (producer === undefined) return true;
  if (producer.kind === "leaf" || producer.kind === "integrator") {
    return leafSettled(state, fromTaskId);
  }
  const integration = state.integrationResults.find((result) => result.compositeTaskId === fromTaskId);
  return integration !== undefined && INTEGRATION_SUCCESS.has(integration.status);
}

function unhandledIntegrationFailures(state: RunState): IntegrationResult[] {
  return state.integrationResults.filter(
    (result) =>
      !INTEGRATION_SUCCESS.has(result.status) && !state.acceptedIntegrationFailures.includes(result.compositeTaskId)
  );
}

/**
 * Deepest composite whose children all have settled results and which has not
 * been integrated yet. Bottom-up order is guaranteed by the depth sort.
 */
function nextIntegrableComposite(state: RunState, graph: TaskGraph): TaskNode | undefined {
  return Object.values(graph.nodes)
    .filter((node) => (node.kind === "composite" || node.kind === "root") && node.childrenIds.length > 0)
    .filter((node) => !state.integrationResults.some((result) => result.compositeTaskId === node.id))
    .filter((node) => node.childrenIds.every((childId) => childSettled(state, graph, childId)))
    .sort((a, b) => b.depth - a.depth || a.id.localeCompare(b.id))[0];
}

function childSettled(state: RunState, graph: TaskGraph, childId: string): boolean {
  const child = graph.nodes[childId];
  if (child === undefined) return true;
  if (child.kind === "leaf" || child.kind === "integrator") {
    return leafSettled(state, childId);
  }
  const integration = state.integrationResults.find((result) => result.compositeTaskId === childId);
  if (integration === undefined) return false;
  if (INTEGRATION_SUCCESS.has(integration.status)) return true;
  // An accepted failure only unblocks the parent when a merged commit was
  // preserved for it to cherry-pick. Validation failures keep their commit
  // (see IntegrationAgent); an aborted cherry-pick conflict has none, so the
  // parent stays non-integrable rather than crashing on a missing child.
  return (
    state.acceptedIntegrationFailures.includes(childId) &&
    integration.integrationCommitSha !== undefined
  );
}

// ─── budget accounting (U5) ────────────────────────────────────────────────

export interface BudgetSpend {
  tokens: number;
  usd: number;
}

/**
 * Total reported spend across leaf results and integration repairs. Results
 * without usage (usageSource "unavailable") contribute zero — the wall-clock
 * watchdog remains the backstop for fully unreported executors.
 */
export function computeBudgetSpend(state: RunState): BudgetSpend {
  let tokens = 0;
  let usd = 0;
  for (const result of state.leafResults) {
    tokens += (result.tokensIn ?? 0) + (result.tokensOut ?? 0);
    usd += result.costUsd ?? 0;
  }
  for (const integration of state.integrationResults) {
    const repair = integration.repairResult;
    if (repair !== undefined) {
      tokens += (repair.tokensIn ?? 0) + (repair.tokensOut ?? 0);
      usd += repair.costUsd ?? 0;
    }
  }
  return { tokens, usd };
}

function budgetExceeded(state: RunState): boolean {
  const limits = state.budgetLimits;
  if (limits === null) return false;
  const spend = computeBudgetSpend(state);
  if (limits.maxTokensTotal !== undefined && spend.tokens >= limits.maxTokensTotal) return true;
  if (limits.maxCostUsd !== undefined && spend.usd >= limits.maxCostUsd) return true;
  return false;
}

// ─── prepare ───────────────────────────────────────────────────────────────

/** Entry node: asserts the plan exists and flips the run into "running". */
export function prepareExecutionNode(state: RunState): RunStateUpdate {
  requireGraph(state, "prepareExecutionNode");
  return { status: "running", errorMessage: null };
}

// ─── waveJoin / integrationJoin (superstep barriers) ───────────────────────

/**
 * No-op barrier nodes. All parallel executeLeaf Sends converge here, so the
 * frontier router runs exactly once per superstep (LangGraph dedupes a node
 * activated by several parents within one step).
 */
export function waveJoinNode(): RunStateUpdate {
  return {};
}

export function integrationJoinNode(): RunStateUpdate {
  return {};
}

// ─── routeFrontier (conditional edge) ──────────────────────────────────────

export interface FrontierRouterDeps {
  /**
   * Adaptive wave selection: picks the subset of frontier candidates safe to
   * run concurrently (scope overlap / conflict risk aware). Returning an empty
   * array is treated as "no constraint" and the full frontier is dispatched.
   */
  selectWave?: (params: { graph: TaskGraph; candidates: string[] }) => string[] | Promise<string[]>;
}

/**
 * Frontier router: dispatches the next wave of executable tasks as parallel
 * Sends, detours to the leaf gate while failures await a human decision,
 * suspends on the budget gate when the spend limit is hit (always BETWEEN
 * waves — a running leaf is never killed by the budget), and hands over to
 * the integration loop once no executable work remains.
 */
export function makeRouteFrontier(deps: FrontierRouterDeps = {}) {
  return async function routeFrontier(
    state: RunState
  ): Promise<Send[] | "leafGate" | "budgetGate" | "integrationJoin"> {
    const graph = requireGraph(state, "routeFrontier");

    if (unhandledLeafFailures(state).length > 0) {
      return "leafGate";
    }

    const candidates = executionFrontier(state, graph);
    if (candidates.length === 0 || state.finishPartial) {
      return "integrationJoin";
    }

    if (budgetExceeded(state)) {
      return "budgetGate";
    }

    const selected = (await deps.selectWave?.({ graph, candidates })) ?? candidates;
    const wave = selected.length > 0 ? selected.filter((id) => candidates.includes(id)) : candidates;
    const effective = wave.length > 0 ? wave : candidates;

    return effective.map(
      (taskId) =>
        new Send("executeLeaf", {
          runId: state.runId,
          taskId,
          graph,
          repoPath: state.repoPath
        } satisfies LeafExecutionInput)
    );
  };
}

// ─── executeLeaf ───────────────────────────────────────────────────────────

export interface LeafExecutionInput {
  runId: string;
  taskId: string;
  graph: TaskGraph;
  repoPath: string;
}

export interface ExecuteLeafNodeDeps {
  /** Execute a single executable task in its isolated worktree (D6/D7). */
  executeLeaf: (params: LeafExecutionInput) => Promise<{ result: AgentExecutionResult }>;
  /**
   * Attempt an auto-repair pass after a failed validation. Returns null when
   * repair is unavailable; otherwise the repaired result.
   */
  repairLeaf?: (
    params: LeafExecutionInput & { validationOutput: string }
  ) => Promise<{ result: AgentExecutionResult } | null>;
  /** Auto-repair budget per execution attempt (default 2). */
  maxRepairAttempts?: number;
}

export function validationOutputOf(result: AgentExecutionResult): string {
  // Pick the first candidate that actually carries diagnostic text. `??` only
  // falls through on null/undefined, so an empty-string `validationResult.output`
  // (e.g. the error went to stderr, or the run timed out) used to shadow the
  // real reason and leave the gate/repair blank (O-10).
  const candidates = [result.validationResult?.output, result.stderrTail, result.stdoutTail];
  const firstNonEmpty = candidates.find(
    (candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0
  );
  if (firstNonEmpty !== undefined) return firstNonEmpty;
  // No captured output at all (timeout, killed executor, …): synthesize a
  // non-empty, actionable reason so the leaf gate shows *something* and the
  // repair agent never repairs blind.
  return `Leaf "${result.taskId}" failed (status: ${result.status}) with no captured validation output.`;
}

/**
 * Runs one executable task; on validation failure, spends the auto-repair
 * budget. Never interrupts — failed results flow into state and the cheap
 * leafGate raises the human decision.
 */
export function makeExecuteLeafNode(deps: ExecuteLeafNodeDeps) {
  const maxRepairAttempts = Math.max(0, deps.maxRepairAttempts ?? 2);

  return async function executeLeafNode(input: LeafExecutionInput): Promise<RunStateUpdate> {
    const execution = await deps.executeLeaf(input);
    let lastResult = execution.result;

    let attempts = 0;
    while (lastResult.status !== "success" && attempts < maxRepairAttempts && deps.repairLeaf !== undefined) {
      attempts += 1;
      const repaired = await deps.repairLeaf({ ...input, validationOutput: validationOutputOf(lastResult) });
      if (repaired === null) break;
      lastResult = repaired.result;
    }

    return { leafResults: [lastResult] };
  };
}

// ─── leafGate ──────────────────────────────────────────────────────────────

/**
 * Pure HITL gate for failed executable tasks. interrupt() is the first
 * statement, so resuming re-runs only this function — no executor work.
 * Handles one failure per visit; the frontier router brings it back while
 * unhandled failures remain.
 */
export function leafGateNode(state: RunState): Command<unknown, RunStateUpdate> {
  const failure = unhandledLeafFailures(state)[0];
  if (failure === undefined) {
    return new Command<unknown, RunStateUpdate>({ goto: "waveJoin" });
  }

  const decision = parseDecision(
    interrupt({
      type: "leaf_validation_failed",
      runId: state.runId,
      taskId: failure.taskId,
      validationOutput: validationOutputOf(failure),
      autoRepairAttempted: true
    } satisfies LeafValidationInterrupt),
    "leafGate"
  );

  switch (decision.action) {
    case "retry_repair": {
      const graph = requireGraph(state, "leafGate");
      return new Command<unknown, RunStateUpdate>({
        goto: [
          new Send("executeLeaf", {
            runId: state.runId,
            taskId: failure.taskId,
            graph,
            repoPath: state.repoPath
          } satisfies LeafExecutionInput)
        ]
      });
    }
    case "accept_failing":
      return new Command<unknown, RunStateUpdate>({
        update: { acceptedLeafFailures: [failure.taskId] },
        goto: "waveJoin"
      });
    case "abort_run":
      return new Command<unknown, RunStateUpdate>({
        update: {
          status: "failed",
          errorMessage: `Run aborted by user at leaf gate (task ${failure.taskId}).`
        },
        goto: END
      });
    default:
      throw new Error(`leafGate: unsupported action "${decision.action}".`);
  }
}

// ─── budgetGate ────────────────────────────────────────────────────────────

/**
 * Pure HITL gate for budget exhaustion (U5). interrupt() is the first
 * statement — resuming is free. The human extends the budget (the frontier
 * dispatches again), finishes partial (integrate only what is complete), or
 * aborts. Always reached BETWEEN waves: no in-flight leaf is ever cut.
 */
export function budgetGateNode(state: RunState): Command<unknown, RunStateUpdate> {
  const graph = requireGraph(state, "budgetGate");
  const spend = computeBudgetSpend(state);
  const pending = executionFrontier(state, graph);

  const decision = parseDecision(
    interrupt({
      type: "budget_exceeded",
      runId: state.runId,
      spentTokens: spend.tokens,
      spentUsd: spend.usd,
      ...(state.budgetLimits?.maxTokensTotal !== undefined
        ? { maxTokensTotal: state.budgetLimits.maxTokensTotal }
        : {}),
      ...(state.budgetLimits?.maxCostUsd !== undefined ? { maxCostUsd: state.budgetLimits.maxCostUsd } : {}),
      completedTasks: state.leafResults.length,
      pendingTasks: pending
    } satisfies BudgetExceededInterrupt),
    "budgetGate"
  );

  switch (decision.action) {
    case "extend_budget": {
      const next = {
        ...(typeof decision["maxTokensTotal"] === "number" ? { maxTokensTotal: decision["maxTokensTotal"] } : {}),
        ...(typeof decision["maxCostUsd"] === "number" ? { maxCostUsd: decision["maxCostUsd"] } : {})
      };
      return new Command<unknown, RunStateUpdate>({
        // An extend without explicit new limits lifts them entirely.
        update: { budgetLimits: Object.keys(next).length > 0 ? next : null },
        goto: "waveJoin"
      });
    }
    case "finish_partial":
      return new Command<unknown, RunStateUpdate>({
        update: { finishPartial: true },
        goto: "waveJoin"
      });
    case "abort_run":
      return new Command<unknown, RunStateUpdate>({
        update: {
          status: "failed",
          errorMessage: `Run aborted by user at budget gate (${spend.tokens} tokens / $${spend.usd.toFixed(2)} spent).`
        },
        goto: END
      });
    default:
      throw new Error(`budgetGate: unsupported action "${decision.action}".`);
  }
}

// ─── routeIntegration (conditional edge) ───────────────────────────────────

/**
 * Integration loop router: surfaces unresolved integration failures to the
 * conflict gate, feeds the next ready composite to the integrator, and exits
 * into run-level validation when nothing integrable remains.
 */
export function routeIntegration(
  state: RunState
): "conflictGate" | "integrateNextComposite" | "runValidation" {
  const graph = requireGraph(state, "routeIntegration");

  if (unhandledIntegrationFailures(state).length > 0) {
    return "conflictGate";
  }
  if (nextIntegrableComposite(state, graph) !== undefined) {
    return "integrateNextComposite";
  }
  return "runValidation";
}

// ─── integrateNextComposite ────────────────────────────────────────────────

export interface IntegrateCompositeNodeDeps {
  /**
   * Integrate one composite bottom-up via git cherry-pick + Composer repair
   * (D8). Child results are passed in dependency order.
   */
  integrateComposite: (params: {
    compositeTaskId: string;
    runId: string;
    graph: TaskGraph;
    repoPath: string;
    childResults: AgentExecutionResult[];
  }) => Promise<IntegrationResult>;
}

/**
 * Integrates exactly one composite per superstep so each integration commit
 * is checkpointed individually (granular resume + time-travel forking).
 */
export function makeIntegrateNextCompositeNode(deps: IntegrateCompositeNodeDeps) {
  return async function integrateNextCompositeNode(state: RunState): Promise<RunStateUpdate> {
    const graph = requireGraph(state, "integrateNextComposite");
    const composite = nextIntegrableComposite(state, graph);
    if (composite === undefined) {
      return {};
    }

    const childResults = composite.childrenIds
      .map((childId) => settledResultFor(state, graph, childId))
      .filter((result): result is AgentExecutionResult => result !== undefined);

    const result = await deps.integrateComposite({
      compositeTaskId: composite.id,
      runId: state.runId,
      graph,
      repoPath: state.repoPath,
      childResults
    });

    return { integrationResults: [result] };
  };
}

/**
 * Result a parent composite consumes for a settled child: the child's own
 * execution result, or a synthetic success carrying the integration commit
 * when the child is itself an integrated composite.
 */
function settledResultFor(
  state: RunState,
  graph: TaskGraph,
  childId: string
): AgentExecutionResult | undefined {
  const child = graph.nodes[childId];
  if (child === undefined) return undefined;

  if (child.kind === "leaf" || child.kind === "integrator") {
    return leafResultFor(state, childId);
  }

  const integration = state.integrationResults.find((result) => result.compositeTaskId === childId);
  if (integration?.integrationCommitSha === undefined) return undefined;
  // Mirror childSettled: a clean integration, or one whose failure the operator
  // accepted, carries its merged commit forward to the parent. A non-accepted
  // failure is never consumed (routeIntegration would surface it at the gate).
  const usable =
    INTEGRATION_SUCCESS.has(integration.status) ||
    state.acceptedIntegrationFailures.includes(childId);
  if (!usable) return undefined;
  return syntheticCompositeResult(childId, integration.integrationCommitSha);
}

function syntheticCompositeResult(taskId: string, commitSha: string): AgentExecutionResult {
  return {
    taskId,
    status: "success",
    baseHead: commitSha,
    currentHead: commitSha,
    agentCommittedUnexpectedly: false,
    diff: "",
    changedFiles: [],
    commitSha,
    scopeCheck: { passed: true, violations: [], outOfScope: [] },
    executorExitCode: 0,
    executorDurationMs: 0,
    executorTimedOut: false,
    stderrTail: "",
    stdoutTail: ""
  } satisfies AgentExecutionResult;
}

// ─── conflictGate ──────────────────────────────────────────────────────────

/**
 * Pure HITL gate for integration failures the Composer could not repair.
 * Mirrors leafGate: interrupt-first, one failure per visit.
 */
export function conflictGateNode(state: RunState): Command<unknown, RunStateUpdate> {
  const failure = unhandledIntegrationFailures(state)[0];
  if (failure === undefined) {
    return new Command<unknown, RunStateUpdate>({ goto: "integrationJoin" });
  }

  const decision = parseDecision(
    interrupt({
      type: "merge_conflict",
      compositeTaskId: failure.compositeTaskId,
      status: failure.status,
      failureClass: classifyIntegrationFailure(failure),
      ...(failure.parentValidation !== undefined
        ? { validationExitCode: failure.parentValidation.exitCode }
        : {}),
      ...(failure.conflictDetails !== undefined
        ? {
            conflictDetails: {
              files: [...failure.conflictDetails.files],
              diff: failure.conflictDetails.cherryPickOutput
            }
          }
        : {})
    } satisfies MergeConflictInterrupt),
    "conflictGate"
  );

  switch (decision.action) {
    case "accept_conflict":
      return new Command<unknown, RunStateUpdate>({
        update: { acceptedIntegrationFailures: [failure.compositeTaskId] },
        goto: "integrationJoin"
      });
    case "retry_integration":
      // The reducer consumes this tombstone by DELETING the failed result, so
      // routeIntegration sees the composite as integrable again and re-runs it
      // (e.g. after the human fixed a broken environment at an infra failure).
      return new Command<unknown, RunStateUpdate>({
        update: { integrationResults: [{ ...failure, status: "retry_pending" }] },
        goto: "integrationJoin"
      });
    case "abort_run":
      return new Command<unknown, RunStateUpdate>({
        update: {
          status: "failed",
          errorMessage: `Run aborted by user at conflict gate (composite ${failure.compositeTaskId}).`
        },
        goto: END
      });
    default:
      throw new Error(`conflictGate: unsupported action "${decision.action}".`);
  }
}

// ─── runValidation ─────────────────────────────────────────────────────────

export interface RunValidationNodeDeps {
  validateRun: (params: {
    runId: string;
    graph: TaskGraph;
    repoPath: string;
    leafResults: AgentExecutionResult[];
    integrationResults: IntegrationResult[];
    /** Leaf failures the human accepted — treated as resolved by run validation. */
    acceptedLeafFailures: string[];
    /** Integration failures the human accepted — treated as resolved by run validation. */
    acceptedIntegrationFailures: string[];
  }) => Promise<{ passed: boolean; output?: string }>;
}

/** Final run-level validation once execution + integration settle. */
export function makeRunValidationNode(deps: RunValidationNodeDeps) {
  return async function runValidationNode(state: RunState): Promise<RunStateUpdate> {
    const graph = requireGraph(state, "runValidationNode");

    const validation = await deps.validateRun({
      runId: state.runId,
      graph,
      repoPath: state.repoPath,
      leafResults: state.leafResults,
      integrationResults: state.integrationResults,
      acceptedLeafFailures: state.acceptedLeafFailures,
      acceptedIntegrationFailures: state.acceptedIntegrationFailures
    });

    // A human-accepted failure is NOT a run failure: the operator's acceptance
    // IS the resolution (P2b). As long as the budget wasn't force-closed and the
    // final validation passes, the run completes. The pipeline distinguishes a
    // run with accepted resolutions as `completed_with_accepted` for honest UX;
    // the graph itself stays binary completed/failed.
    const passed = validation.passed && !state.finishPartial;
    return {
      status: passed ? "completed" : "failed",
      ...(passed
        ? {}
        : {
            errorMessage: state.finishPartial
              ? "Run closed partially at the budget gate; pending tasks were not executed."
              : validation.output ?? "Run validation failed"
          })
    };
  };
}
