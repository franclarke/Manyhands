import path from "node:path";
import {
  loadBenchmarkManifest,
  loadFeatureFixture,
  MetadataDrivenMockDecomposer,
  isDecomposerLlmError,
  runMockExecutionFlow,
  runMockPlanningFlow,
  type Decomposer,
  type FeatureRequest,
  type MockExecutionFlowResult,
  type MockPlanningFlowResult
} from "@manyhands/core";
import type { BenchmarkManifest } from "@manyhands/evaluator";
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

export interface ExecutionRunnerOptions {
  intervalMs?: number;
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
 * Run the planning pipeline for a given run. Uses the LLM decomposer when an
 * API key is present (via decomposer-policy); falls back transparently to the
 * deterministic MetadataDrivenMockDecomposer on any failure (network, schema,
 * validation, env). Persists `decomposition` metadata regardless of branch.
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

    const scenario = findScenario(run.scenarioId);
    if (scenario === undefined) {
      throw new Error(`Unknown scenario: ${run.scenarioId}`);
    }
    const bundle = await loadScenarioBundle(scenario);
    const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);

    const selection = pickDecomposer({
      userPrompt: run.userPrompt,
      model: run.model,
      ...(workspace !== null ? { workspace } : {})
    });

    const { planning, decomposition } = await runPlanningWithFallback({
      selection,
      bundle,
      run
    });

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

interface PlanningWithFallbackInput {
  selection: DecomposerSelection;
  bundle: BenchmarkBundle;
  run: RunRecord;
}

interface PlanningWithFallbackResult {
  planning: MockPlanningFlowResult;
  decomposition: RunDecompositionMetadata;
}

async function runPlanningWithFallback(input: PlanningWithFallbackInput): Promise<PlanningWithFallbackResult> {
  const { selection, bundle, run } = input;
  const baseOptions = {
    feature: bundle.feature,
    fixturePath: bundle.featurePath,
    mode: run.granularity,
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
  mode: RunRecord["granularity"];
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
 * Replay deterministic execution: kick runMockExecutionFlow, then dispatch per-task
 * agent.run.* events with simulated latency. Transitions: approved → running → completed/failed.
 */
export async function runExecutionPipeline(runId: string, options: ExecutionRunnerOptions = {}): Promise<void> {
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "approved") {
      run = await transitionTo(run, "running", { startedAt: run.startedAt ?? new Date().toISOString() });
    }

    const scenario = findScenario(run.scenarioId);
    if (scenario === undefined) throw new Error(`Unknown scenario: ${run.scenarioId}`);
    const bundle = await loadScenarioBundle(scenario);

    const execution: MockExecutionFlowResult = await runMockExecutionFlow({
      feature: bundle.feature,
      fixturePath: bundle.featurePath,
      mode: run.granularity,
      decomposer: new MetadataDrivenMockDecomposer(),
      schedulerPolicy: "risk_aware",
      runLabel: `${run.runId}:execution`
    });

    const interval = options.intervalMs ?? EXECUTION_EVENT_INTERVAL_MS;
    for (const result of execution.results) {
      await waitWhilePaused(runId, "running");
      publishEvent(runId, {
        kind: "agent.run.started",
        taskId: result.taskId,
        at: new Date().toISOString()
      });
      await sleep(interval / 2);
      publishEvent(runId, {
        kind: "agent.run.completed",
        taskId: result.taskId,
        success: result.success,
        at: new Date().toISOString()
      });
      publishEvent(runId, {
        kind: "validation.completed",
        taskId: result.taskId,
        passed: result.validation.passed,
        at: new Date().toISOString()
      });
      await sleep(interval / 2);
    }

    run = await getRunRepository().get(runId);
    await transitionTo(run, "completed", {
      execution,
      completedAt: new Date().toISOString()
    });
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

function publishEvent(runId: string, event: RunEvent): void {
  publishRunEvent(runId, event);
}
