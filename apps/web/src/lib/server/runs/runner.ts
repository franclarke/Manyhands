import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
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
import { InMemoryTraceStore, type TraceStore } from "@manyhands/trace-store";
import { resolveRepoRoot } from "../repo-root";
import { RepoNotConfiguredError } from "./errors";
import {
  createDefaultRepoProvisioner,
  type ProvisionedRepo,
  type RepoProvisioner
} from "./repo-provisioner";
import { publishRunEvent } from "./event-bus";
import { assertTransition } from "./lifecycle";
import { markRunnerActive, markRunnerInactive } from "./runner-state";
import { getRunRepository } from "./store";
import { getWorkspaceRepository } from "../workspaces";
import { pickDecomposer, type DecomposerSelection } from "@/lib/decomposer-policy";
import type { RunEvent, RiskLevelKey } from "./events";
import type { ExecutionConfigInput, RunDecompositionMetadata, RunRecord, RunStatus } from "./schema";
import { findScenario, type DecompositionScenario } from "@/lib/scenarios";
import type { Workspace } from "@/lib/api-types";

const PLANNING_EVENT_INTERVAL_MS = 110;
const EXECUTION_EVENT_INTERVAL_MS = 220;
const PAUSE_POLL_MS = 80;
const HEARTBEAT_INTERVAL_MS = 4_000;
const execFileAsync = promisify(execFile);

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
  /** Real repo provisioned for this run (C17). Required by the default engine. */
  provisioned?: ProvisionedRepo;
  /** Optional per-run config overrides; defaults applied by the engine. */
  executionConfig?: ExecutionConfigInput;
}

export interface ExecutionEngine {
  run(input: ExecutionEngineInput): Promise<RunExecutionResult>;
}

export interface ExecutionRunnerOptions {
  intervalMs?: number;
  engine?: ExecutionEngine;
  /** Injectable for tests; default copies a benchmark fixture into a per-run dir. */
  provisioner?: RepoProvisioner;
  /** Injectable for tests; receives the engine's trace events to persist as evidence. */
  traceStore?: TraceStore;
}

/**
 * Builds the real execution engine: a RunExecutor wired to simple-git and the
 * Codex CLI, rooted at the provisioned repo. The pipeline provisions and passes
 * `input.provisioned`; the engine stays a pure executor. Without a provisioned
 * repo it fails clearly (D3) — the graph's mock baseCommit is never executable.
 */
function createDefaultExecutionEngine(deps: { traceStore?: TraceStore } = {}): ExecutionEngine {
  const traceStore = deps.traceStore ?? new InMemoryTraceStore();
  return {
    async run(input) {
      if (input.provisioned === undefined) {
        throw new RepoNotConfiguredError(input.runId);
      }
      const { repoRoot, baseBranch, baseCommit } = input.provisioned;
      const executor = new RunExecutor({
        git: new SimpleGitRunner(),
        codex: new CodexCliExecutor(),
        traceStore,
        repoRoot
      });
      return executor.run({
        // Execution resolves the real base over the graph's mock values.
        graph: { ...input.graph, repo: repoRoot, baseBranch, baseCommit },
        config: ExecutionConfigSchema.parse(input.executionConfig ?? {}),
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
function buildFeatureRequestFromPrompt(userPrompt: string, workspace: Workspace): FeatureRequest {
  const title = userPrompt.slice(0, 120) || "Untitled feature";
  return {
    id: `feature-${randomUUID().slice(0, 8)}`,
    title,
    description: userPrompt,
    repositoryPath: workspace.repoPath,
    targetStack: [],
    constraints: [
      `Implement inside the local git repository at ${workspace.repoPath}.`,
      ...(workspace.allowedPaths?.length ? [`Prefer these paths: ${workspace.allowedPaths.join(", ")}`] : []),
      ...(workspace.testCommand ? [`Use this test command when relevant: ${workspace.testCommand}`] : []),
      ...(workspace.buildCommand ? [`Use this build command when relevant: ${workspace.buildCommand}`] : [])
    ],
    acceptanceCriteria: ["Feature meets the requirements described in the prompt"]
  };
}

function requireExecutableWorkspace(workspace: Workspace | null, workspaceId: string): Workspace {
  if (workspace === null) {
    throw new Error(`Workspace ${workspaceId} was not found.`);
  }
  if (workspace.repoPath === undefined || workspace.repoPath.length === 0) {
    throw new Error(
      `Workspace "${workspace.name}" has no local repo path configured. ` +
        "Select a local git folder before generating a product run."
    );
  }
  return workspace;
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
      const executableWorkspace = requireExecutableWorkspace(workspace, run.workspaceId);
      const feature = buildFeatureRequestFromPrompt(run.userPrompt, executableWorkspace);
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

  if (selection.provider === "deterministic") {
    // D3: no API key → fail with actionable message instead of silent fallback.
    const reason = selection.fallbackReason ?? "no_api_key";
    const messages: Record<string, string> = {
      no_api_key:
        "Graph generation requires Codex CLI in product mode. Select a local git workspace or select a scenario for mock mode.",
      forced_by_env:
        "MANYHANDS_FORCE_FALLBACK is set, but prompt-only runs require Codex CLI. Unset MANYHANDS_FORCE_FALLBACK=1 or select a scenario for mock mode.",
      forced_by_caller:
        "Deterministic mode was explicitly requested, but prompt-only runs require Codex CLI. Select a scenario for mock mode."
    };
    throw new Error(messages[reason] ?? `Codex decomposer unavailable: ${reason}`);
  }

  try {
    const planning = await runMockPlanningFlow({
      ...baseOptions,
      decomposer: selection.decomposer
    });
    const telemetry = selection.getAnthropicTelemetry?.() ?? null;
    const decomposition: RunDecompositionMetadata = {
      provider: selection.provider,
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
        "Retry, switch to a different Codex model, or verify that Codex CLI is installed and authenticated."
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
        provider: selection.provider,
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
    const usingDefaultEngine = options.engine === undefined;
    // The pipeline owns the trace store so the engine's events can be persisted
    // as run evidence (they would otherwise die with the in-process engine).
    const traceStore = options.traceStore ?? (usingDefaultEngine ? new InMemoryTraceStore() : undefined);
    const engine =
      options.engine ?? createDefaultExecutionEngine(traceStore !== undefined ? { traceStore } : {});

    // Provision a real repo when one is configured; persist it as a run artifact.
    let provisioned: ProvisionedRepo | undefined;
    if (run.repoSpec !== undefined) {
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      provisioned = await provisioner.provision({ spec: run.repoSpec, runId: run.runId });
      run = await getRunRepository().save({
        ...run,
        provisioned: {
          repoRoot: provisioned.repoRoot,
          baseBranch: provisioned.baseBranch,
          baseCommit: provisioned.baseCommit,
          provisionedAt: new Date().toISOString()
        }
      });
    } else if (usingDefaultEngine) {
      // D3: no silent mock execution. The default engine needs a real repo.
      throw new RepoNotConfiguredError(run.runId);
    }

    const result = await engine.run({
      graph,
      model: run.model,
      runId: run.runId,
      ...(provisioned !== undefined ? { provisioned } : {}),
      ...(run.executionConfig !== undefined ? { executionConfig: run.executionConfig } : {})
    });
    const finalApplication =
      result.status === "completed" && provisioned !== undefined
        ? await applyFinalPatch({ graph, result, provisioned, runId: run.runId })
        : undefined;

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

    const executionTraces = traceStore?.list();
    run = await getRunRepository().get(runId);
    if (result.status === "completed") {
      await transitionTo(run, "completed", {
        execution: result,
        ...(executionTraces !== undefined ? { executionTraces } : {}),
        ...(finalApplication !== undefined ? finalApplication : {}),
        completedAt: new Date().toISOString()
      });
    } else {
      await getRunRepository().save({
        ...run,
        status: "failed",
        execution: result,
        ...(executionTraces !== undefined ? { executionTraces } : {}),
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

interface FinalApplicationRecord {
  finalPatch: string;
  finalCommitSha: string;
  appliedToRepoPath: string;
  appliedAt: string;
  baseCommit: string;
  integrationCommitSha: string;
}

async function applyFinalPatch(input: {
  graph: TaskGraph;
  result: RunExecutionResult;
  provisioned: ProvisionedRepo;
  runId: string;
}): Promise<FinalApplicationRecord | undefined> {
  const integrationCommitSha = resolveFinalCommit(input.graph, input.result);
  if (integrationCommitSha === undefined) {
    return undefined;
  }

  const repoRoot = input.provisioned.repoRoot;
  const currentHead = await git(repoRoot, ["rev-parse", "HEAD"]);
  if (currentHead !== input.provisioned.baseCommit) {
    throw new Error(
      `Cannot apply final patch because the target repo moved from ${input.provisioned.baseCommit} to ${currentHead}.`
    );
  }
  const status = await git(repoRoot, ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error("Cannot apply final patch because the target repo has uncommitted changes.");
  }

  const finalPatch = await gitRaw(repoRoot, ["diff", `${input.provisioned.baseCommit}..${integrationCommitSha}`]);
  if (finalPatch.trim().length === 0) {
    throw new Error("Execution completed but the final integrated patch is empty.");
  }

  await gitWithStdin(repoRoot, ["apply", "--index", "-"], finalPatch);
  const finalCommitSha = await git(repoRoot, [
    "-c",
    "user.name=ManyHands",
    "-c",
    "user.email=manyhands@local",
    "commit",
    "-m",
    `mh: apply run ${input.runId}`
  ]).then(() => git(repoRoot, ["rev-parse", "HEAD"]));

  return {
    finalPatch,
    finalCommitSha,
    appliedToRepoPath: repoRoot,
    appliedAt: new Date().toISOString(),
    baseCommit: input.provisioned.baseCommit,
    integrationCommitSha
  };
}

function resolveFinalCommit(graph: TaskGraph, result: RunExecutionResult): string | undefined {
  const rootIntegration = result.integrationResults.find(
    (entry) => entry.compositeTaskId === graph.rootId
  );
  if (rootIntegration?.integrationCommitSha !== undefined) {
    return rootIntegration.integrationCommitSha;
  }
  if (result.integrationResults.length > 0) {
    return result.integrationResults.at(-1)?.integrationCommitSha;
  }
  if (result.leafResults.length === 1) {
    return result.leafResults[0]?.commitSha;
  }
  return undefined;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await gitRaw(cwd, args)).trim();
}

async function gitRaw(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

function gitWithStdin(cwd: string, args: string[], stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin?.end(stdin);
  });
}

function publishEvent(runId: string, event: RunEvent): void {
  publishRunEvent(runId, event);
}
