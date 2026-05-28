import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  loadBenchmarkManifest,
  loadFeatureFixture,
  MetadataDrivenMockDecomposer,
  isDecomposerLlmError,
  runMockPlanningFlow,
  type Decomposer,
  type FeatureRequest,
  type MockPlanningFlowResult
} from "@manyhands/core";
import type { BenchmarkManifest } from "@manyhands/evaluator";
import {
  CodexCliExecutor,
  ExecutionConfigSchema,
  RunExecutor,
  SimpleGitRunner,
  type RunExecutionResult
} from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore } from "@manyhands/trace-store";
import { resolveRepoRoot } from "../repo-root";
import { publishRunEvent } from "./event-bus";
import { assertTransition } from "./lifecycle";
import { markRunnerActive, markRunnerInactive } from "./runner-state";
import { getRunRepository } from "./store";
import { getWorkspaceRepository } from "../workspaces";
import { pickDecomposer, type DecomposerSelection } from "@/lib/decomposer-policy";
import type { RunEvent, RiskLevelKey } from "./events";
import type { RunDecompositionMetadata, RunRecord, RunStatus } from "./schema";
import { findScenario, type DecompositionScenario } from "@/lib/scenarios";

const PLANNING_EVENT_INTERVAL_MS = 110;
const EXECUTION_EVENT_INTERVAL_MS = 220;
const PAUSE_POLL_MS = 80;
const HEARTBEAT_INTERVAL_MS = 4_000;

// Re-export for the SSE endpoint to detect orphaned runs.
export { isRunnerActive } from "./runner-state";

export interface PlanningRunnerOptions {
  intervalMs?: number;
}

/**
 * Execution seam (C17). The pipeline resolves the graph and maps results to
 * SSE; the engine owns the actual run. The default engine drives the real
 * RunExecutor against a git repo, but tests (and future provisioning layers)
 * can inject their own to stay deterministic without disk/network/Codex.
 */
export interface ExecutionEngineInput {
  graph: TaskGraph;
  model: string;
  runId: string;
}

export interface ExecutionEngine {
  run(input: ExecutionEngineInput): Promise<RunExecutionResult>;
}

export interface ExecutionRunnerOptions {
  intervalMs?: number;
  engine?: ExecutionEngine;
}

/**
 * Builds the real execution engine: a RunExecutor wired to simple-git and the
 * Codex CLI, rooted at the resolved repo. Requires an executable git repo whose
 * commits match the graph's baseCommit — until a repo-provisioning layer exists
 * (deferred), this path fails clearly for mock-graph runs.
 */
function createDefaultExecutionEngine(): ExecutionEngine {
  return {
    async run(input) {
      const executor = new RunExecutor({
        git: new SimpleGitRunner(),
        codex: new CodexCliExecutor(),
        traceStore: new InMemoryTraceStore(),
        repoRoot: resolveRepoRoot()
      });
      return executor.run({
        graph: input.graph,
        config: ExecutionConfigSchema.parse({}),
        model: input.model,
        runId: input.runId
      });
    }
  };
}

interface BenchmarkBundle {
  manifest: BenchmarkManifest;
  feature: FeatureRequest;
  featurePath: string;
}

async function loadScenarioBundle(scenario: DecompositionScenario): Promise<BenchmarkBundle> {
  const repoRoot = resolveRepoRoot();
  const manifestPath = path.resolve(repoRoot, "benchmarks", scenario.benchmarkId, "benchmark.json");
  const manifest = await loadBenchmarkManifest(manifestPath);
  const featureRef = manifest.features.find((entry) => entry.id === scenario.featureId);
  if (featureRef === undefined) {
    throw new Error(
      `Scenario ${scenario.id} points to feature ${scenario.featureId} not present in ${manifestPath}`
    );
  }
  const featurePath = path.resolve(path.dirname(manifestPath), featureRef.path);
  const feature = await loadFeatureFixture(featurePath);
  return { manifest, feature, featurePath };
}

/**
 * Build a FeatureRequest from the user's natural-language prompt, without
 * depending on a benchmark scenario fixture. Used in the prompt-only path
 * (no scenarioId).
 */
function buildFeatureRequestFromPrompt(userPrompt: string, _workspaceId: string): FeatureRequest {
  const title = userPrompt.slice(0, 120) || "Untitled feature";
  return {
    id: `feature-${randomUUID().slice(0, 8)}`,
    title,
    description: userPrompt,
    targetStack: [],
    constraints: [],
    acceptanceCriteria: ["Feature meets the requirements described in the prompt"]
  };
}

/**
 * Resolve the run's granularity mode to a concrete DecompositionMode the
 * decomposer can use. "auto" maps to "balanced" (the recommended default).
 */
function resolveDecompositionMode(mode: RunRecord["granularity"]): "coarse" | "balanced" | "fine" {
  if (mode === "auto") return "balanced";
  return mode;
}

async function transitionTo(run: RunRecord, status: RunStatus, extra: Partial<RunRecord> = {}): Promise<RunRecord> {
  assertTransition(run.status, status);
  const next: RunRecord = { ...run, ...extra, status };
  const saved = await getRunRepository().save(next);
  publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: saved.updatedAt });
  return saved;
}

async function waitWhilePaused(runId: string, phase: "generating" | "running"): Promise<void> {
  while (true) {
    const current = await getRunRepository().get(runId);
    if (current.status !== "paused" || current.pausedDuring !== phase) {
      return;
    }
    await sleep(PAUSE_POLL_MS);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startHeartbeat(runId: string): () => void {
  let stopped = false;
  const tick = async (): Promise<void> => {
    while (!stopped) {
      try {
        const repo = getRunRepository();
        const current = await repo.get(runId);
        await repo.save({ ...current, heartbeatAt: new Date().toISOString() });
      } catch {
        // best-effort; sweeper will handle persistent failures
      }
      await sleep(HEARTBEAT_INTERVAL_MS);
    }
  };
  void tick();
  return () => {
    stopped = true;
  };
}

/**
 * Run the planning pipeline for a given run.
 *
 * Two paths:
 *
 * **Scenario path** (scenarioId present): loads the benchmark fixture, uses
 * the LLM decomposer when an API key is available and falls back
 * transparently to the deterministic MetadataDrivenMockDecomposer on any
 * failure.
 *
 * **Prompt-only path** (no scenarioId): builds a FeatureRequest from the
 * user's natural-language prompt and delegates exclusively to the LLM
 * decomposer. If the LLM is unavailable (no API key, network error, schema
 * validation failure) the run **fails with a clear, actionable error** — no
 * silent deterministic fallback (design decision D3).
 *
 * Transitions: created/interrupted → generating → needs_review (or failed).
 */
export async function runPlanningPipeline(runId: string, options: PlanningRunnerOptions = {}): Promise<void> {
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "created" || run.status === "interrupted") {
      run = await transitionTo(run, "generating", {
        startedAt: run.startedAt ?? new Date().toISOString()
      });
    }

    const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
    const selection = pickDecomposer({
      userPrompt: run.userPrompt,
      model: run.model,
      ...(workspace !== null ? { workspace } : {})
    });

    let planning: MockPlanningFlowResult;
    let decomposition: RunDecompositionMetadata;

    if (run.scenarioId !== undefined && run.scenarioId.length > 0) {
      // ── Scenario path: benchmark fixture + deterministic fallback ──
      const scenario = findScenario(run.scenarioId);
      if (scenario === undefined) {
        throw new Error(`Unknown scenario: ${run.scenarioId}`);
      }
      const bundle = await loadScenarioBundle(scenario);
      const result = await runPlanningWithFallback({ selection, bundle, run });
      planning = result.planning;
      decomposition = result.decomposition;
    } else {
      // ── Prompt-only path: LLM required, no silent fallback ──
      const feature = buildFeatureRequestFromPrompt(run.userPrompt, run.workspaceId);
      const result = await runPromptOnlyPlanning({ selection, feature, run });
      planning = result.planning;
      decomposition = result.decomposition;
    }

    // Persist planning + decomposition metadata before dispatching SSE events so
    // refreshes during `generating` already have a snapshot to project.
    run = await getRunRepository().save({
      ...run,
      planning,
      decomposition,
      heartbeatAt: new Date().toISOString()
    });

    const nodeIds = Object.values(planning.decomposition.graph.nodes)
      .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))
      .map((node) => node.id);
    const interval = options.intervalMs ?? PLANNING_EVENT_INTERVAL_MS;

    for (const taskId of nodeIds) {
      await waitWhilePaused(runId, "generating");
      publishEvent(runId, { kind: "node.added", taskId, at: new Date().toISOString() });
      await sleep(interval);
    }

    for (const dependency of planning.decomposition.graph.dependencies) {
      await waitWhilePaused(runId, "generating");
      const edgeId = `dependency:${dependency.fromTaskId}:${dependency.toTaskId}`;
      publishEvent(runId, { kind: "edge.added", edgeId, at: new Date().toISOString() });
      await sleep(interval / 2);
    }

    for (const prediction of planning.riskMatrix) {
      await waitWhilePaused(runId, "generating");
      publishEvent(runId, {
        kind: "risk.added",
        pairKey: `${prediction.taskAId}:${prediction.taskBId}`,
        level: prediction.level as RiskLevelKey,
        at: new Date().toISOString()
      });
      await sleep(interval / 2);
    }

    run = await getRunRepository().get(runId);
    await transitionTo(run, "needs_review");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const run = await getRunRepository().get(runId).catch(() => null);
    if (run !== null) {
      await getRunRepository().save({ ...run, status: "failed", errorMessage: message });
      publishRunEvent(runId, {
        kind: "status.changed",
        status: "failed",
        at: new Date().toISOString()
      });
    }
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-only planning (no scenario, no deterministic fallback — D3)
// ─────────────────────────────────────────────────────────────────────────────

interface PromptOnlyPlanningInput {
  selection: DecomposerSelection;
  feature: FeatureRequest;
  run: RunRecord;
}

interface PlanningResult {
  planning: MockPlanningFlowResult;
  decomposition: RunDecompositionMetadata;
}

/**
 * Plan from a raw user prompt using the LLM decomposer. If the LLM is not
 * available or fails, the run fails — **no silent deterministic fallback**
 * (design decision D3). The error message is actionable: it tells the user
 * exactly what to fix.
 */
async function runPromptOnlyPlanning(input: PromptOnlyPlanningInput): Promise<PlanningResult> {
  const { selection, feature, run } = input;
  const mode = resolveDecompositionMode(run.granularity);
  const baseOptions = {
    feature,
    mode,
    schedulerPolicy: "risk_aware" as const,
    runLabel: `${run.runId}:planning`
  };

  if (selection.provider !== "anthropic") {
    // D3: no API key → fail with actionable message instead of silent fallback.
    const reason = selection.fallbackReason ?? "no_api_key";
    const messages: Record<string, string> = {
      no_api_key:
        "Graph generation requires an API key. Configure ANTHROPIC_API_KEY in your environment or select a scenario for mock mode.",
      forced_by_env:
        "MANYHANDS_FORCE_FALLBACK is set, but prompt-only runs require a live LLM. Unset MANYHANDS_FORCE_FALLBACK=1 or select a scenario for mock mode.",
      forced_by_caller:
        "Deterministic mode was explicitly requested, but prompt-only runs require a live LLM. Select a scenario for mock mode."
    };
    throw new Error(messages[reason] ?? `LLM decomposer unavailable: ${reason}`);
  }

  try {
    const planning = await runMockPlanningFlow({
      ...baseOptions,
      decomposer: selection.decomposer
    });
    const telemetry = selection.getAnthropicTelemetry?.() ?? null;
    const decomposition: RunDecompositionMetadata = {
      provider: "anthropic",
      model: selection.model,
      fallbackUsed: false,
      validationErrors: [],
      generatedAt: new Date().toISOString()
    };
    if (selection.promptTemplateVersion !== undefined) {
      decomposition.promptTemplateVersion = selection.promptTemplateVersion;
    }
    if (telemetry?.usage !== undefined) decomposition.usage = telemetry.usage;
    if (telemetry?.rawResponse !== undefined) decomposition.rawResponse = telemetry.rawResponse;
    if (telemetry?.parsedOutput !== undefined) decomposition.parsedOutput = telemetry.parsedOutput;
    return { planning, decomposition };
  } catch (error) {
    // D3: LLM failed → propagate with actionable message. No fallback.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Graph generation failed: ${detail}. ` +
        "Retry, switch to a different model, or verify your ANTHROPIC_API_KEY."
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scenario-based planning (benchmark fixture + deterministic fallback)
// ─────────────────────────────────────────────────────────────────────────────

interface ScenarioPlanningInput {
  selection: DecomposerSelection;
  bundle: BenchmarkBundle;
  run: RunRecord;
}

/**
 * Plan from a benchmark scenario fixture. Falls back transparently to the
 * deterministic MetadataDrivenMockDecomposer when the LLM is unavailable or
 * errors — this is intentional for Lab Mode / benchmark flows where
 * reproducibility matters.
 */
async function runPlanningWithFallback(input: ScenarioPlanningInput): Promise<PlanningResult> {
  const { selection, bundle, run } = input;
  const mode = resolveDecompositionMode(run.granularity);
  const baseOptions = {
    feature: bundle.feature,
    fixturePath: bundle.featurePath,
    mode,
    schedulerPolicy: "risk_aware" as const,
    runLabel: `${run.runId}:planning`
  };

  if (selection.provider === "anthropic") {
    try {
      const planning = await runMockPlanningFlow({
        ...baseOptions,
        decomposer: selection.decomposer
      });
      const telemetry = selection.getAnthropicTelemetry?.() ?? null;
      const decomposition: RunDecompositionMetadata = {
        provider: "anthropic",
        model: selection.model,
        fallbackUsed: false,
        validationErrors: [],
        generatedAt: new Date().toISOString()
      };
      if (selection.promptTemplateVersion !== undefined) {
        decomposition.promptTemplateVersion = selection.promptTemplateVersion;
      }
      if (telemetry?.usage !== undefined) decomposition.usage = telemetry.usage;
      if (telemetry?.rawResponse !== undefined) decomposition.rawResponse = telemetry.rawResponse;
      if (telemetry?.parsedOutput !== undefined) decomposition.parsedOutput = telemetry.parsedOutput;
      return { planning, decomposition };
    } catch (error) {
      // Transparent fallback. Capture the LLM cause for later inspection.
      const validationErrors: string[] = [];
      if (isDecomposerLlmError(error)) {
        const stage = (error as { stage?: string }).stage ?? "unknown";
        const message = error instanceof Error ? error.message : String(error);
        validationErrors.push(`${stage}: ${message}`);
      } else if (error instanceof Error) {
        validationErrors.push(error.message);
      } else {
        validationErrors.push(String(error));
      }
      const fallback = await runDeterministicPlanning(baseOptions);
      const decomposition: RunDecompositionMetadata = {
        provider: "deterministic",
        model: selection.model,
        fallbackUsed: true,
        fallbackReason: "llm_failed",
        validationErrors,
        generatedAt: new Date().toISOString()
      };
      return { planning: fallback, decomposition };
    }
  }

  const planning = await runDeterministicPlanning(baseOptions);
  const decomposition: RunDecompositionMetadata = {
    provider: "deterministic",
    model: selection.model,
    fallbackUsed: true,
    ...(selection.fallbackReason !== undefined ? { fallbackReason: selection.fallbackReason } : {}),
    validationErrors: [],
    generatedAt: new Date().toISOString()
  };
  return { planning, decomposition };
}

async function runDeterministicPlanning(baseOptions: {
  feature: FeatureRequest;
  fixturePath: string;
  mode: "coarse" | "balanced" | "fine";
  schedulerPolicy: "risk_aware";
  runLabel: string;
}): Promise<MockPlanningFlowResult> {
  const decomposer: Decomposer = new MetadataDrivenMockDecomposer();
  return runMockPlanningFlow({
    ...baseOptions,
    decomposer
  });
}

/**
 * Execute an approved run through the real execution pipeline (C17).
 *
 * Resolves the TaskGraph (from persisted planning, or by deterministically
 * decomposing the scenario fixture), hands it to the injected ExecutionEngine
 * (default: real RunExecutor over git + Codex), then maps the per-leaf results
 * to agent.run / validation SSE events and persists the RunExecutionResult.
 *
 * Transitions: approved → running → completed/failed.
 */
export async function runExecutionPipeline(runId: string, options: ExecutionRunnerOptions = {}): Promise<void> {
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "approved") {
      run = await transitionTo(run, "running", { startedAt: run.startedAt ?? new Date().toISOString() });
    }

    const graph = await resolveExecutionGraph(run);
    const engine = options.engine ?? createDefaultExecutionEngine();
    const result = await engine.run({ graph, model: run.model, runId: run.runId });

    const interval = options.intervalMs ?? EXECUTION_EVENT_INTERVAL_MS;
    for (const leaf of result.leafResults) {
      await waitWhilePaused(runId, "running");
      publishEvent(runId, {
        kind: "agent.run.started",
        taskId: leaf.taskId,
        at: new Date().toISOString()
      });
      await sleep(interval / 2);
      publishEvent(runId, {
        kind: "agent.run.completed",
        taskId: leaf.taskId,
        success: leaf.status === "success",
        at: new Date().toISOString()
      });
      publishEvent(runId, {
        kind: "validation.completed",
        taskId: leaf.taskId,
        passed: leaf.status === "success",
        at: new Date().toISOString()
      });
      await sleep(interval / 2);
    }

    run = await getRunRepository().get(runId);
    if (result.status === "completed") {
      await transitionTo(run, "completed", {
        execution: result,
        completedAt: new Date().toISOString()
      });
    } else {
      await getRunRepository().save({
        ...run,
        status: "failed",
        execution: result,
        errorMessage: describeExecutionFailure(result)
      });
      publishRunEvent(runId, { kind: "status.changed", status: "failed", at: new Date().toISOString() });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const run = await getRunRepository().get(runId).catch(() => null);
    if (run !== null) {
      await getRunRepository().save({ ...run, status: "failed", errorMessage: message });
      publishRunEvent(runId, {
        kind: "status.changed",
        status: "failed",
        at: new Date().toISOString()
      });
    }
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

/**
 * Resolve the TaskGraph to execute. Prefers the graph persisted during
 * planning; for scenario runs without persisted planning (e.g. Lab Mode),
 * deterministically decomposes the benchmark fixture to obtain one.
 */
async function resolveExecutionGraph(run: RunRecord): Promise<TaskGraph> {
  if (run.planning !== undefined && run.planning !== null) {
    return (run.planning as MockPlanningFlowResult).decomposition.graph;
  }
  if (run.scenarioId !== undefined && run.scenarioId.length > 0) {
    const scenario = findScenario(run.scenarioId);
    if (scenario === undefined) throw new Error(`Unknown scenario: ${run.scenarioId}`);
    const bundle = await loadScenarioBundle(scenario);
    const planning = await runDeterministicPlanning({
      feature: bundle.feature,
      fixturePath: bundle.featurePath,
      mode: resolveDecompositionMode(run.granularity),
      schedulerPolicy: "risk_aware",
      runLabel: `${run.runId}:execution`
    });
    return planning.decomposition.graph;
  }
  throw new Error("Cannot execute a run without a generated plan. Run planning first.");
}

function describeExecutionFailure(result: RunExecutionResult): string {
  const failedLeaves = result.leafResults.filter((leaf) => leaf.status !== "success");
  if (failedLeaves.length > 0) {
    const detail = failedLeaves.map((leaf) => `${leaf.taskId} (${leaf.status})`).join(", ");
    return `Execution failed: ${failedLeaves.length} leaf task(s) did not succeed: ${detail}.`;
  }
  return "Execution failed during integration or run-level validation.";
}

function publishEvent(runId: string, event: RunEvent): void {
  publishRunEvent(runId, event);
}
