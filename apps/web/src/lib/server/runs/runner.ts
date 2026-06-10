import { randomUUID } from "node:crypto";
import {
  isDecomposerLlmError,
  isDecomposerQuestionError,
  runMockPlanningFlow,
  type AgentTaskContract,
  type FeatureRequest,
  type MockPlanningFlowResult,
  type RepositoryIndex
} from "@manyhands/core";
import {
  DefaultAgentExecutorFactory,
  ExecutionConfigSchema,
  RunExecutor,
  SimpleGitRunner,
  type AgentExecutionResult,
  type PredictedConflictHint,
  type RunNodeExecutionResult,
  type RunExecutionResult,
  GroundingAgent
} from "@manyhands/execution-core";
import type { ResumeDecision } from "@manyhands/orchestrator-graph";
import type { TaskGraph } from "@manyhands/task-graph";
import { InMemoryTraceStore, type TraceStore } from "@manyhands/trace-store";
import { RepoNotConfiguredError, RunLifecycleError, RunValidationError } from "./errors";
import {
  buildExecutionHost,
  driveExecution,
  hasExecutionCheckpoint,
  persistExecutionPause,
  resumeCommand,
  type ExecutionDriveOutcome
} from "./execution-host";
import {
  INTEGRATION_SUCCESS,
  buildExecutionArtifact,
  computeInvalidatedTasks,
  executionResultsFromRun,
  integrationDurationMs,
  manualReadinessForTask,
  mergeNodeExecutionResult,
  provisionedFromRecord,
  resolveExecutionGraph
} from "./execution-state";
import { applyFinalPatch } from "./final-apply";
import { LiveExecutionTraceStore } from "./live-trace-store";

export { computeInvalidatedTasks } from "./execution-state";
export type { ExecutionResults } from "./execution-state";
import { runPreflight } from "./preflight";
import {
  createDefaultRepoProvisioner,
  type ProvisionedRepo,
  type RepoProvisioner
} from "./repo-provisioner";
import { publishRunEvent } from "./event-bus";
import {
  ensureRunModelEventLogForRun,
  publishRunModelEvent
} from "./run-model-event-log";
import { runModelEventsFromTrace } from "./run-model-trace-adapter";
import { generateRunTitle, type RunTitle } from "./run-titler";
import { assertTransition } from "./lifecycle";
import { markRunnerActive, markRunnerInactive } from "./runner-state";
import { abortRun, createRunAbort, disposeRunAbort } from "./run-abort-registry";
import { getRunRepository } from "./store";
import { getWorkspaceRepository } from "../workspaces";
import { pickDecomposer, type DecomposerSelection } from "@/lib/decomposer-policy";
import { runPlanCritic, runSeamCritic } from "@/lib/plan-critic";
import { detectWorkspaceCommands } from "../providers/command-detection";
import { buildRepositoryGrounding } from "./repo-index-cache";
import { projectRunRecordToSnapshot } from "@/lib/live-graph";
import { deriveConflictList } from "@/lib/conflict-view-model";
import type { RiskLevelKey, StreamEvent } from "./events";
import type {
  ExecutionConfigInput,
  NodeReview,
  PlanningLiveNode,
  RunDecompositionMetadata,
  RunRecord,
  RunStatus
} from "./schema";
import type { Workspace } from "@/lib/api-types";

const PLANNING_EVENT_INTERVAL_MS = 110;
const EXECUTION_EVENT_INTERVAL_MS = 220;
const PAUSE_POLL_MS = 80;
const HEARTBEAT_INTERVAL_MS = 4_000;

// Re-export for the SSE endpoint to detect orphaned runs.
export { isRunnerActive } from "./runner-state";

export interface PlanningRunnerOptions {
  intervalMs?: number;
  /** Injectable for tests; defaults to the real Gemini-backed titler. */
  titler?: (input: { userPrompt: string; model: string }) => Promise<RunTitle>;
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
  defaultExecutionSelection?: RunRecord["defaultExecutionSelection"];
  defaultRepairSelection?: RunRecord["defaultRepairSelection"];
  runId: string;
  /** Trace sink owned by the web runner; engines append here for live UI updates and persisted evidence. */
  traceStore?: TraceStore;
  /** Real repo provisioned for this run (C17). Required by the default engine. */
  provisioned?: ProvisionedRepo;
  /** Optional per-run config overrides; defaults applied by the engine. */
  executionConfig?: ExecutionConfigInput;
  /** Run-level cancellation: aborts in-flight executors and stops scheduling. */
  signal?: AbortSignal;
  /** Awaited at each batch boundary (pause hold); resolves to continue. */
  onBatchBoundary?: () => Promise<void>;
  /** Conflicts predicted at planning time; feed the conflict-aware composer (D8). */
  predictedConflicts?: PredictedConflictHint[];
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

async function runNodeWithDefaultEngine(input: {
  graph: TaskGraph;
  model: string;
  taskId: string;
  runId: string;
  provisioned: ProvisionedRepo;
  executionConfig?: ExecutionConfigInput;
  childResults?: AgentExecutionResult[];
  traceStore: TraceStore;
}): Promise<RunNodeExecutionResult> {
  const runExecutor = new RunExecutor({
    git: new SimpleGitRunner(),
    executorFactory: new DefaultAgentExecutorFactory(),
    traceStore: input.traceStore,
    repoRoot: input.provisioned.repoRoot
  });
  return runExecutor.runNode({
    graph: {
      ...input.graph,
      repo: input.provisioned.repoRoot,
      baseBranch: input.provisioned.baseBranch,
      baseCommit: input.provisioned.baseCommit
    },
    config: ExecutionConfigSchema.parse(input.executionConfig ?? {}),
    model: input.model,
    runId: input.runId,
    taskId: input.taskId,
    ...(input.childResults !== undefined ? { childResults: input.childResults } : {})
  });
}

/**
 * Build a FeatureRequest from the user's natural-language prompt.
 */
export function buildFeatureRequestFromPrompt(userPrompt: string, workspace: Workspace, title?: string): FeatureRequest {
  const representativeTitle = title || userPrompt.slice(0, 120) || "Untitled feature";
  return {
    id: `feature-${randomUUID().slice(0, 8)}`,
    title: representativeTitle,
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
  console.log(`[Runner] Run ${run.runId}: Transición de estado de "${run.status}" a "${status}"`);
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
      await sleep(HEARTBEAT_INTERVAL_MS);
      if (stopped) return;
      try {
        const repo = getRunRepository();
        const current = await repo.get(runId);
        await repo.save({ ...current, heartbeatAt: new Date().toISOString() });
      } catch {
        // best-effort; sweeper will handle persistent failures
      }
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
 * Builds a FeatureRequest from the user's natural-language prompt and
 * delegates to the Gemini decomposer (D4). If the LLM is unavailable (no
 * binary, network error, schema validation failure) the run **fails with a
 * clear, actionable error** — no silent deterministic fallback (D3).
 *
 * Transitions: created/interrupted → generating → needs_review (or failed).
 */
export async function runPlanningPipeline(runId: string, options: PlanningRunnerOptions = {}): Promise<void> {
  console.log(`[Runner] Iniciando pipeline de planificación para el run: ${runId}`);
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "created" || run.status === "interrupted") {
      run = await transitionTo(run, "generating", {
        startedAt: run.startedAt ?? new Date().toISOString()
      });
    }

    // Generate a clean title + summary before decomposition so the workspace
    // header reads well while the graph is still generating. Cosmetic: a titler
    // failure must NOT fail the run (this is presentation, not D3).
    if (run.summary === undefined) {
      const titleFn = options.titler ?? ((input) => generateRunTitle(input));
      const runTitle = await titleFn({ userPrompt: run.userPrompt, model: run.planningModel ?? run.model }).catch((error) => {
        console.warn(
          `[Runner] Titler skipped for run ${run.runId}: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      });
      if (runTitle !== null) {
        run = await getRunRepository().save({ ...run, title: runTitle.title, summary: runTitle.summary });
        publishRunEvent(run.runId, {
          kind: "title.updated",
          title: runTitle.title,
          summary: runTitle.summary,
          at: new Date().toISOString()
        });
      }
    }

    const livePlanningNodes = new Map<string, PlanningLiveNode>(
      (run.livePlanningNodes ?? []).map((node) => [node.id, node])
    );
    const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);

    // Repository grounding (Fase 2.1): index the target repo once, up front. The
    // digest grounds the decomposer prompt (symbol topology) and the index feeds
    // conflict-risk + the seam critic. Best-effort — planning proceeds without it.
    const grounding = await buildRepositoryGrounding(workspace?.repoPath);
    const groundingDigest = grounding !== undefined ? buildGroundingDigest(grounding.index) : undefined;

    const selection = pickDecomposer({
      userPrompt: run.userPrompt,
      ...(groundingDigest !== undefined ? { groundingDigest } : {}),
      model: run.planningModel ?? run.model,
      onStepStarted: async (event) => {
        livePlanningNodes.set(event.nodeId, {
          ...livePlanningNodes.get(event.nodeId),
          id: event.nodeId,
          parentId: event.parentId,
          title: event.title,
          goal: event.goal,
          depth: event.depth,
          state: "active"
        });
        publishEvent(run.runId, {
          kind: "planning.node.started",
          nodeId: event.nodeId,
          ...(event.parentId !== null ? { parentId: event.parentId } : {}),
          title: event.title,
          goal: event.goal,
          depth: event.depth,
          at: new Date().toISOString()
        });
        await persistLivePlanningNodes(run.runId, livePlanningNodes);
      },
      onStepCompleted: async (event) => {
        const existing = livePlanningNodes.get(event.nodeId);
        livePlanningNodes.set(event.nodeId, {
          ...(existing ?? {
            id: event.nodeId,
            parentId: event.parentId,
            title: event.title,
            goal: event.goal,
            depth: event.depth
          }),
          state: "complete",
          decision: event.decision,
          childCount: event.childIds.length,
          childIds: event.childIds
        });
        for (const child of event.children) {
          livePlanningNodes.set(child.nodeId, {
            ...livePlanningNodes.get(child.nodeId),
            id: child.nodeId,
            parentId: child.parentId,
            title: child.title,
            goal: child.goal,
            depth: child.depth,
            state: livePlanningNodes.get(child.nodeId)?.state ?? "pending"
          });
        }
        publishEvent(run.runId, {
          kind: "planning.node.completed",
          nodeId: event.nodeId,
          decision: event.decision,
          childIds: event.childIds,
          childNodes: event.children,
          at: new Date().toISOString()
        });
        await persistLivePlanningNodes(run.runId, livePlanningNodes);
      },
      onStepStatus: async (event) => {
        const existing = livePlanningNodes.get(event.nodeId);
        livePlanningNodes.set(event.nodeId, {
          ...(existing ?? {
            id: event.nodeId,
            parentId: event.parentId,
            title: event.title,
            goal: event.goal,
            depth: event.depth
          }),
          state: event.state,
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.error?.kind !== undefined ? { errorKind: event.error.kind } : {}),
          ...(event.error?.message !== undefined ? { errorMessage: event.error.message } : {})
        });
        publishEvent(run.runId, {
          kind: "planning.node.status",
          nodeId: event.nodeId,
          ...(event.parentId !== null ? { parentId: event.parentId } : {}),
          title: event.title,
          goal: event.goal,
          depth: event.depth,
          state: event.state,
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.error?.kind !== undefined ? { errorKind: event.error.kind } : {}),
          ...(event.error?.message !== undefined ? { errorMessage: event.error.message } : {}),
          at: new Date().toISOString()
        });
        await persistLivePlanningNodes(run.runId, livePlanningNodes);
      },
      onCliOutput: (event) => {
        publishEvent(run.runId, {
          kind: "planning.cli.output",
          nodeId: event.nodeId,
          chunk: event.chunk,
          stream: event.stream,
          at: new Date().toISOString()
        });
      },
      ...(workspace !== null ? { workspace } : {})
    });

    console.log(`[Runner] Decomposer seleccionado: provider="${selection.provider}", model="${selection.model}"`);

    // Prompt-only path: LLM required, no silent fallback (D3).
    const executableWorkspace = requireExecutableWorkspace(workspace, run.workspaceId);
    const feature = buildFeatureRequestFromPrompt(run.userPrompt, executableWorkspace, run.title);

    const { planning, decomposition } = await runPromptOnlyPlanning({
      selection,
      feature,
      run,
      ...(grounding?.index !== undefined ? { repositoryIndex: grounding.index } : {})
    });

    // Deterministic plan critics (Fase 2.2/2.3): no extra LLM. Surface scope,
    // seam and validation-command issues before approval.
    const detectedCommands =
      executableWorkspace.repoPath !== undefined
        ? await detectWorkspaceCommands(executableWorkspace.repoPath).catch(() => undefined)
        : undefined;
    const planningCritic = runPlanCritic({
      graph: planning.decomposition.graph,
      contracts: planning.decomposition.contracts as AgentTaskContract[],
      ...(detectedCommands !== undefined ? { detectedCommands } : {})
    });
    const seamCritic = runSeamCritic({
      graph: planning.decomposition.graph,
      contracts: planning.decomposition.contracts as AgentTaskContract[]
    });

    // Persist planning + decomposition metadata before dispatching SSE events so
    // refreshes during `generating` already have a snapshot to project.
    run = await getRunRepository().save({
      ...run,
      planning,
      decomposition,
      planningCritic,
      seamCritic,
      ...(grounding?.summary !== undefined ? { repositoryGrounding: grounding.summary } : {}),
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
    if (run.status === "interrupted") {
      console.log(`[Runner] Planificación cancelada para el run: ${runId}`);
      return;
    }
    console.log(`[Runner] Planificación completada con éxito para el run: ${runId}`);
    await transitionTo(run, "needs_review");
  } catch (error) {
    console.error(`[Runner] FALLÓ la generación del plan para el run "${runId}":`, error);
    if (isDecomposerQuestionError(error)) {
      console.log(`[Runner] Planificación pausada en el nodo "${error.nodeId}" para interactuar con el usuario.`);
      const run = await getRunRepository().get(runId).catch(() => null);
      if (run !== null) {
        await getRunRepository().save({
          ...run,
          status: "paused",
          pausedDuring: "generating",
          pendingQuestion: {
            nodeId: error.nodeId,
            question: error.question,
            options: error.options
          },
          planningStepCache: error.stepCache
        });
        publishRunEvent(runId, {
          kind: "status.changed",
          status: "paused",
          at: new Date().toISOString()
        });
        publishEvent(runId, {
          kind: "planning.question",
          nodeId: error.nodeId,
          question: error.question,
          options: error.options,
          at: new Date().toISOString()
        });
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      const run = await getRunRepository().get(runId).catch(() => null);
      if (run !== null) {
        await getRunRepository().save({
          ...run,
          status: "failed",
          failedDuring: "generating",
          errorMessage: message
        });
        publishRunEvent(runId, {
          kind: "status.changed",
          status: "failed",
          at: new Date().toISOString()
        });
      }
    }
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-only planning (D3: LLM required, no silent fallback)
// ─────────────────────────────────────────────────────────────────────────────

interface PromptOnlyPlanningInput {
  selection: DecomposerSelection;
  feature: FeatureRequest;
  run: RunRecord;
  repositoryIndex?: RepositoryIndex;
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
    runLabel: `${run.runId}:planning`,
    questionAnswers: run.questionAnswers,
    stepCache: run.planningStepCache
  };

  if (selection.provider === "deterministic") {
    // D3: no LLM available → fail with actionable message instead of silent fallback.
    const reason = selection.fallbackReason ?? "no_api_key";
    const messages: Record<string, string> = {
      no_api_key:
        "Graph generation requires Gemini CLI. Install it and ensure it is on PATH (or set MANYHANDS_GEMINI_BIN).",
      forced_by_env:
        "MANYHANDS_FORCE_FALLBACK is set, but runs require the Gemini decomposer. Unset MANYHANDS_FORCE_FALLBACK to continue.",
      forced_by_caller:
        "Deterministic mode was explicitly requested, but runs require the Gemini decomposer."
    };
    throw new Error(messages[reason] ?? `Gemini decomposer unavailable: ${reason}`);
  }

  try {
    const planning = await runMockPlanningFlow({
      ...baseOptions,
      decomposer: selection.decomposer,
      ...(input.repositoryIndex !== undefined ? { repositoryIndex: input.repositoryIndex } : {})
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
    const detail = describePlanningFailure(error);
    throw new Error(
      `Graph generation failed: ${detail}. ` +
        "Retry, switch to a different Gemini model, or verify that Gemini CLI is installed and authenticated."
    );
  }
}

/**
 * Compact, prompt-friendly digest of the repository's source topology: the top
 * source files and the symbols they export. Fed to the decomposer so seams are
 * designed against real module boundaries rather than guessed ones.
 */
function buildGroundingDigest(index: RepositoryIndex): string {
  const sourceFiles = index.files
    .filter((file) => file.kind === "source" && file.exportedSymbols.length > 0)
    .slice(0, 15);
  const lines = [
    `Repository structure (grounding for seam design): ${index.files.length} files, ${index.symbols.length} symbols.`
  ];
  for (const file of sourceFiles) {
    lines.push(`- ${file.path} -> ${file.exportedSymbols.slice(0, 8).join(", ")}`);
  }
  return lines.join("\n");
}

function describePlanningFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isDecomposerLlmError(error) || error.details === undefined) {
    return message;
  }
  const detail = error.details;
  const parts = [
    message,
    `kind=${detail.kind}`,
    `stage=${detail.stage}`,
    ...(detail.nodeId !== undefined ? [`node=${detail.nodeId}`] : []),
    ...(detail.attempt !== undefined && detail.maxAttempts !== undefined
      ? [`attempt=${detail.attempt}/${detail.maxAttempts}`]
      : [])
  ];
  return parts.join(" | ");
}

export async function runExecutionPipeline(runId: string, options: ExecutionRunnerOptions = {}): Promise<void> {
  console.log(`[Runner] Starting execution pipeline for run: ${runId}`);
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  let stopBudgetWatchdog: () => void = () => undefined;
  try {
    let run = await getRunRepository().get(runId);
    if (run.status === "approved") {
      run = await transitionTo(run, "running", { startedAt: run.startedAt ?? new Date().toISOString() });
    }

    const graph = await resolveExecutionGraph(run);
    console.log(
      `[Runner] Execution graph resolved for run ${runId}: root=${graph.rootId}, nodes=${Object.keys(graph.nodes).length}, dependencies=${graph.dependencies.length}`
    );
    const usingDefaultEngine = options.engine === undefined;

    await ensureRunModelEventLogForRun(run);

    let provisioned: ProvisionedRepo | undefined = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined && run.repoSpec !== undefined) {
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      console.log(`[Runner] Provisioning repo for run ${runId}: kind=${run.repoSpec.kind}`);
      provisioned = await provisioner.provision({ spec: run.repoSpec, runId: run.runId });
      console.log(
        `[Runner] Repo provisioned for run ${runId}: repoRoot=${provisioned.repoRoot}, baseBranch=${provisioned.baseBranch}, baseCommit=${provisioned.baseCommit}`
      );
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
      console.error(
        `[Runner] El run ${runId} no tiene repoSpec configurado y el engine real requiere un repo. ` +
          "Configurá un workspace con un repo git local."
      );
      throw new RepoNotConfiguredError(run.runId);
    }

    const abortController = createRunAbort(runId);
    stopBudgetWatchdog = startBudgetWatchdog(runId, run.executionConfig?.maxWallClockMs);

    if (options.engine !== undefined) {
      console.log(`[Runner] Running mock/custom engine for run ${runId}`);
      const traceStore = new LiveExecutionTraceStore(
        options.traceStore ?? new InMemoryTraceStore(),
        runId,
        run.model
      );

      const result = await options.engine.run({
        runId: run.runId,
        graph,
        provisioned: provisioned!,
        executionConfig: run.executionConfig ?? {},
        traceStore,
        signal: abortController.signal,
        model: run.model
      });

      // Cooperative cancellation check
      const afterEngine = await getRunRepository().get(runId);
      if (afterEngine.status === "interrupted") {
        console.log(`[Runner] Run ${runId} interrupted after engine returned; persisting partial execution.`);
        const cancelTraces = traceStore.list();
        await getRunRepository().save({
          ...afterEngine,
          execution: result,
          ...(cancelTraces.length > 0 ? { executionTraces: [...(afterEngine.executionTraces ?? []), ...cancelTraces] } : {})
        });
        return;
      }

      const finalApplication =
        result.status === "completed" && provisioned !== undefined
          ? await (async () => {
              console.log(`[Runner] Final apply start for run ${runId}`);
              const applied = await applyFinalPatch({ graph, result, provisioned: provisioned!, runId, slug: run.title });
              console.log(
                `[Runner] Final apply complete for run ${runId}: status=${applied?.finalApplicationStatus ?? "(none)"} branch=${applied?.finalBranchName ?? "(none)"} commit=${applied?.finalCommitSha ?? "(none)"}`
              );
              return applied;
            })()
          : undefined;

      // Publish stream events for mock results
      for (const leaf of result.leafResults) {
        if (!traceStore.hasPublishedStart(leaf.taskId)) {
          publishEvent(runId, {
            kind: "agent.run.started",
            taskId: leaf.taskId,
            at: new Date().toISOString()
          });
        }
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
      }

      for (const integration of result.integrationResults) {
        if (!traceStore.hasPublishedStart(integration.compositeTaskId)) {
          publishEvent(runId, {
            kind: "agent.run.started",
            taskId: integration.compositeTaskId,
            at: new Date().toISOString()
          });
        }
        const success = integration.status === "success" || integration.status === "executor_repair_success";
        publishEvent(runId, {
          kind: "agent.run.completed",
          taskId: integration.compositeTaskId,
          success,
          at: new Date().toISOString()
        });
      }

      const executionTraces = traceStore.list();
      publishRunModelEventsFromExecutionResult(run, graph, result, finalApplication);
      const currentRun = await getRunRepository().get(runId);
      if (result.status === "completed") {
        console.log(`[Runner] Persisting completed run ${runId}`);
        await transitionTo(currentRun, "completed", {
          execution: result,
          ...(executionTraces.length > 0 ? { executionTraces: [...(currentRun.executionTraces ?? []), ...executionTraces] } : {}),
          ...(finalApplication !== undefined ? finalApplication : {}),
          completedAt: new Date().toISOString()
        });
      } else {
        console.warn(`[Runner] Persisting failed run ${runId}`);
        await getRunRepository().save({
          ...currentRun,
          status: result.status === "failed" ? "failed" : "interrupted",
          failedDuring: "running",
          execution: result,
          ...(executionTraces.length > 0 ? { executionTraces: [...(currentRun.executionTraces ?? []), ...executionTraces] } : {}),
          errorMessage: result.status === "failed" ? "Execution failed" : "Budget exceeded"
        });
        publishRunEvent(runId, { kind: "status.changed", status: result.status === "failed" ? "failed" : "interrupted", at: new Date().toISOString() });
      }
      return;
    }

    if (usingDefaultEngine && provisioned !== undefined) {
      console.log(`[Runner] Preflight start for run ${runId}`);
      await runPreflight({
        repoRoot: provisioned.repoRoot,
        baseBranch: provisioned.baseBranch,
        legacyModel: run.model,
        graph,
        ...(run.defaultExecutionSelection !== undefined
          ? { defaultExecutionSelection: run.defaultExecutionSelection }
          : {}),
        ...(run.defaultRepairSelection !== undefined ? { defaultRepairSelection: run.defaultRepairSelection } : {})
      });
      console.log(`[Runner] Preflight ok for run ${runId}`);
    }

    // First start of this thread: freeze the seams, scaffold the walking
    // skeleton (GroundingAgent) and persist the skeleton commit as the base
    // every leaf branches from. A resumed/restarted thread skips grounding.
    const alreadyStarted = await hasExecutionCheckpoint(runId);
    if (!alreadyStarted) {
      publishRunModelEvent(run.runId, {
        actor: "system",
        at: new Date().toISOString(),
        type: "grounding.started",
        payload: {}
      });
      const nowStr = new Date().toISOString();
      for (const node of Object.values(graph.nodes)) {
        for (const iface of node.contract?.producedInterfaces ?? []) {
          publishRunModelEvent(run.runId, {
            actor: "system",
            at: nowStr,
            type: "seam.frozen",
            payload: {
              seamId: iface.id,
              revision: 1,
              frozenSignature: iface.signature,
              extractedFrom: `contract:${node.id}`
            }
          });
        }
      }

      const groundingAgent = new GroundingAgent();
      const skeletonCommit = await groundingAgent.run({
        repoRoot: provisioned!.repoRoot,
        graph,
        model: run.model,
        runId: run.runId
      });
      provisioned!.baseCommit = skeletonCommit;
      run = await getRunRepository().save({
        ...run,
        provisioned: {
          repoRoot: provisioned!.repoRoot,
          baseBranch: provisioned!.baseBranch,
          baseCommit: skeletonCommit,
          provisionedAt: run.provisioned?.provisionedAt ?? new Date().toISOString()
        }
      });

      publishRunModelEvent(run.runId, {
        actor: "system",
        at: new Date().toISOString(),
        type: "grounding.completed",
        payload: { skeletonCommit }
      });
    }

    const host = buildExecutionHost(run, provisioned!, {
      traceStoreFactory: () =>
        new LiveExecutionTraceStore(options.traceStore ?? new InMemoryTraceStore(), runId, run.model),
      predictedConflicts: derivePredictedConflicts(run)
    });

    // Seed surviving results (e.g. after a seam amendment filtered the
    // execution artifact and reset the thread) so the frontier only
    // re-dispatches invalidated tasks.
    const seed = executionResultsFromRun(run);
    const initialState = {
      runId,
      userPrompt: run.userPrompt,
      workspaceId: run.workspaceId,
      repoPath: provisioned!.repoRoot,
      taskGraph: host.taskGraph,
      planningQueue: [],
      planningStepCache: {},
      leafResults: seed.leafResults,
      integrationResults: seed.integrationResults,
      acceptedLeafFailures: [],
      acceptedIntegrationFailures: [],
      pendingQuestion: null,
      userAnswers: {},
      status: "running" as const,
      errorMessage: null
    };

    const outcome = await driveExecution(host, alreadyStarted ? null : initialState);
    await settleExecutionOutcome(runId, host, outcome, provisioned!, options);
  } catch (error) {
    console.error(`[Runner] FALLO la ejecucion del run "${runId}":`, error);
    const message = error instanceof Error ? error.message : String(error);
    const run = await getRunRepository().get(runId).catch(() => null);
    if (run !== null) {
      if (run.status === "interrupted") {
        console.log(`[Runner] Run ${runId} was interrupted; not saving status as failed.`);
        return;
      }
      await getRunRepository().save({ ...run, status: "failed", failedDuring: "running", errorMessage: message });
      publishRunEvent(runId, {
        kind: "status.changed",
        status: "failed",
        at: new Date().toISOString()
      });
    }
  } finally {
    stopBudgetWatchdog();
    disposeRunAbort(runId);
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

/**
 * Resume a paused execution natively: delivers the human gate decision to
 * the suspended LangGraph thread via Command({ resume }) - no checkpoint
 * surgery - and settles the run exactly like the initial start.
 */
export async function resumeExecutionPipeline(
  runId: string,
  decision: ResumeDecision,
  options: ExecutionRunnerOptions = {}
): Promise<void> {
  console.log(`[Runner] Resuming execution for run ${runId} with decision:`, decision);
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  let stopBudgetWatchdog: () => void = () => undefined;
  try {
    const run = await getRunRepository().get(runId);
    const provisioned = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined) {
      throw new RepoNotConfiguredError(runId);
    }

    createRunAbort(runId);
    stopBudgetWatchdog = startBudgetWatchdog(runId, run.executionConfig?.maxWallClockMs);

    const host = buildExecutionHost(run, provisioned, {
      traceStoreFactory: () =>
        new LiveExecutionTraceStore(options.traceStore ?? new InMemoryTraceStore(), runId, run.model),
      predictedConflicts: derivePredictedConflicts(run)
    });

    const outcome = await driveExecution(host, resumeCommand(decision));
    await settleExecutionOutcome(runId, host, outcome, provisioned, options);
  } catch (error) {
    console.error(`[Runner] FALLO el resume de ejecucion del run "${runId}":`, error);
    const message = error instanceof Error ? error.message : String(error);
    const run = await getRunRepository().get(runId).catch(() => null);
    if (run !== null && run.status !== "interrupted") {
      await getRunRepository().save({ ...run, status: "failed", failedDuring: "running", errorMessage: message });
      publishRunEvent(runId, { kind: "status.changed", status: "failed", at: new Date().toISOString() });
    }
  } finally {
    stopBudgetWatchdog();
    disposeRunAbort(runId);
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

/**
 * Shared epilogue for start/resume: persists the pause projection when the
 * graph suspended on a gate, otherwise finalizes the run (final apply,
 * run-model events, terminal status).
 */
async function settleExecutionOutcome(
  runId: string,
  host: ReturnType<typeof buildExecutionHost>,
  outcome: ExecutionDriveOutcome,
  provisioned: ProvisionedRepo,
  _options: ExecutionRunnerOptions
): Promise<void> {
  if (outcome.kind === "paused") {
    console.log(`[Runner] Execution paused at ${outcome.gate.gate} gate (task ${outcome.gate.taskId}).`);
    await persistExecutionPause(runId, outcome.gate);
    return;
  }

  const currentRun = await getRunRepository().get(runId);
  if (currentRun.status === "interrupted") {
    console.log(`[Runner] Run ${runId} interrupted; keeping partial execution.`);
    return;
  }

  const existing = executionResultsFromRun(currentRun);
  const artifact = buildExecutionArtifact(runId, host.taskGraph, existing.leafResults, existing.integrationResults);
  if (artifact === undefined) {
    await getRunRepository().save({
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      errorMessage: outcome.errorMessage ?? "Execution produced no results."
    });
    publishRunEvent(runId, { kind: "status.changed", status: "failed", at: new Date().toISOString() });
    return;
  }

  const persistedValidation = (currentRun.execution as Partial<RunExecutionResult> | undefined)?.validationResult;
  const result: RunExecutionResult = {
    ...artifact,
    status: outcome.status,
    ...(persistedValidation !== undefined ? { validationResult: persistedValidation } : {})
  };

  const finalApplication =
    outcome.status === "completed"
      ? await (async () => {
          console.log(`[Runner] Final apply start for run ${runId}`);
          const applied = await applyFinalPatch({
            graph: host.taskGraph,
            result,
            provisioned,
            runId,
            slug: currentRun.title
          });
          console.log(
            `[Runner] Final apply complete for run ${runId}: status=${applied?.finalApplicationStatus ?? "(none)"} branch=${applied?.finalBranchName ?? "(none)"} commit=${applied?.finalCommitSha ?? "(none)"}`
          );
          return applied;
        })()
      : undefined;

  publishRunModelEventsFromExecutionResult(currentRun, host.taskGraph, result, finalApplication);

  if (outcome.status === "completed") {
    console.log(`[Runner] Persisting completed run ${runId}`);
    await transitionTo(currentRun, "completed", {
      execution: result,
      ...(finalApplication !== undefined ? finalApplication : {}),
      completedAt: new Date().toISOString()
    });
  } else {
    console.warn(`[Runner] Persisting failed run ${runId}`);
    await getRunRepository().save({
      ...currentRun,
      status: "failed",
      failedDuring: "running",
      execution: result,
      errorMessage: outcome.errorMessage ?? describeExecutionFailure(result)
    });
    publishRunEvent(runId, { kind: "status.changed", status: "failed", at: new Date().toISOString() });
  }
}

function startBudgetWatchdog(runId: string, maxWallClockMs: number | undefined): () => void {
  if (maxWallClockMs === undefined) {
    return () => undefined;
  }
  const timer = setTimeout(() => {
    void (async () => {
      const repo = getRunRepository();
      const current = await repo.get(runId).catch(() => null);
      if (current !== null && current.status === "running") {
        await repo.save({
          ...current,
          status: "interrupted",
          interruptedDuring: "running",
          errorMessage: `interrupted: wall-clock budget of ${maxWallClockMs}ms exceeded`
        });
        abortRun(runId);
        publishRunEvent(runId, { kind: "status.changed", status: "interrupted", at: new Date().toISOString() });
      }
    })();
  }, maxWallClockMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }
  return () => clearTimeout(timer);
}

export async function runNodeExecutionPipeline(
  runId: string,
  taskId: string,
  options: ExecutionRunnerOptions = {}
): Promise<void> {
  console.log(`[Runner] Starting node execution pipeline for run=${runId} task=${taskId}`);
  markRunnerActive(runId);
  const stopHeartbeat = startHeartbeat(runId);
  try {
    const repo = getRunRepository();
    let run = await repo.get(runId);
    if (run.status !== "approved") {
      throw new RunLifecycleError(`Cannot execute individual nodes from status ${run.status}`);
    }

    const graph = await resolveExecutionGraph(run);
    const existing = executionResultsFromRun(run);
    const readiness = manualReadinessForTask(graph, taskId, existing);
    console.log(
      `[Runner] Node readiness run=${runId} task=${taskId} ready=${readiness.ready} existingLeaves=${existing.leafResults.length} existingIntegrations=${existing.integrationResults.length}`
    );
    if (!readiness.ready) {
      throw new RunLifecycleError(readiness.reason);
    }

    let provisioned = provisionedFromRecord(run.provisioned);
    if (provisioned === undefined) {
      if (run.repoSpec === undefined) {
        throw new RepoNotConfiguredError(run.runId);
      }
      const provisioner = options.provisioner ?? createDefaultRepoProvisioner();
      console.log(`[Runner] Provisioning repo for node run=${runId} task=${taskId}: kind=${run.repoSpec.kind}`);
      provisioned = await provisioner.provision({ spec: run.repoSpec, runId: run.runId });
      console.log(
        `[Runner] Repo provisioned for node run=${runId} task=${taskId}: repoRoot=${provisioned.repoRoot}, baseBranch=${provisioned.baseBranch}, baseCommit=${provisioned.baseCommit}`
      );
      run = await repo.save({
        ...run,
        provisioned: {
          repoRoot: provisioned.repoRoot,
          baseBranch: provisioned.baseBranch,
          baseCommit: provisioned.baseCommit,
          provisionedAt: new Date().toISOString()
        }
      });
    }

    console.log(`[Runner] Node preflight start run=${runId} task=${taskId}`);
    await runPreflight({ repoRoot: provisioned.repoRoot, baseBranch: provisioned.baseBranch });
    console.log(`[Runner] Node preflight ok run=${runId} task=${taskId}`);

    publishEvent(runId, { kind: "agent.run.started", taskId, at: new Date().toISOString() });

    const traceStore = options.traceStore ?? new InMemoryTraceStore();
    console.log(`[Runner] Node engine start run=${runId} task=${taskId}`);
    const nodeResult = await runNodeWithDefaultEngine({
      graph,
      model: run.model,
      taskId,
      runId: run.runId,
      provisioned,
      ...(run.executionConfig !== undefined ? { executionConfig: run.executionConfig } : {}),
      ...(readiness.childResults !== undefined ? { childResults: readiness.childResults } : {}),
      traceStore
    });
    console.log(
      `[Runner] Node engine complete run=${runId} task=${taskId} kind=${nodeResult.kind} status=${nodeResult.kind === "leaf" ? nodeResult.result.status : nodeResult.result.status}`
    );

    const merged = mergeNodeExecutionResult({
      runId: run.runId,
      graph: {
        ...graph,
        repo: provisioned.repoRoot,
        baseBranch: provisioned.baseBranch,
        baseCommit: provisioned.baseCommit
      },
      existing,
      nodeResult
    });
    const executionTraces = [...(run.executionTraces ?? []), ...traceStore.list()];
    run = await repo.get(runId);
    console.log(
      `[Runner] Persisting node result run=${runId} task=${taskId} mergedStatus=${merged.status} leaves=${merged.leafResults.length} integrations=${merged.integrationResults.length}`
    );
    await repo.save({
      ...run,
      execution: merged,
      executionTraces,
      heartbeatAt: new Date().toISOString()
    });

    const success =
      nodeResult.kind === "leaf"
        ? nodeResult.result.status === "success"
        : INTEGRATION_SUCCESS.has(nodeResult.result.status);
    publishEvent(runId, {
      kind: "agent.run.completed",
      taskId,
      success,
      at: new Date().toISOString()
    });
    publishEvent(runId, {
      kind: "validation.completed",
      taskId,
      passed: success,
      at: new Date().toISOString()
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[Runner] Node execution failed run="${runId}" task="${taskId}":`, error);
    const run = await getRunRepository().get(runId).catch(() => null);
    if (run !== null) {
      await getRunRepository().save({ ...run, errorMessage: message });
    }
    publishEvent(runId, {
      kind: "agent.run.completed",
      taskId,
      success: false,
      at: new Date().toISOString()
    });
  } finally {
    stopHeartbeat();
    markRunnerInactive(runId);
  }
}

export async function assertManualNodeExecutionReady(run: RunRecord, taskId: string): Promise<void> {
  if (run.status !== "approved") {
    throw new RunLifecycleError(`Cannot execute individual nodes from status ${run.status}`);
  }
  const graph = await resolveExecutionGraph(run);
  const readiness = manualReadinessForTask(graph, taskId, executionResultsFromRun(run));
  if (!readiness.ready) {
    throw new RunLifecycleError(readiness.reason);
  }
}

/**
 * Build the predicted-conflict hints that feed the conflict-aware composer (Pieza 2).
 * Reuses the exact computation the UI shows (deriveConflictList) so foresight at
 * planning time and repair at integration time stay consistent. Includes every
 * actionable pair — even acknowledged ones, since acknowledgement is precisely the
 * decision to let the composer reconcile them.
 */
function derivePredictedConflicts(run: RunRecord): PredictedConflictHint[] {
  // Best-effort foresight: a malformed/partial snapshot must never break the run.
  if (!hasProjectableConflictSnapshotInput(run)) {
    return [];
  }
  try {
    const snapshot = projectRunRecordToSnapshot(run);
    if (snapshot === null) {
      return [];
    }
    return deriveConflictList(snapshot, run.patches ?? [])
      .filter((conflict) => conflict.level === "medium" || conflict.level === "high" || conflict.level === "blocking")
      .map((conflict) => ({
        taskAId: conflict.taskAId,
        taskBId: conflict.taskBId,
        level: conflict.level,
        sharedFiles: conflict.sharedFiles,
        sharedSymbols: conflict.sharedSymbols,
        explanation: conflict.reason
      }));
  } catch (error) {
    console.warn(
      `[Runner] Predicted-conflict derivation skipped for run ${run.runId}: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function hasProjectableConflictSnapshotInput(run: RunRecord): boolean {
  const execution = run.execution;
  if (isPlainRecord(execution) && execution.snapshot !== undefined) return true;
  return hasProjectablePlanningShape(run.planning);
}

function hasProjectablePlanningShape(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const decomposition = asPlainRecord(value.decomposition);
  const feature = asPlainRecord(decomposition?.feature);
  const graph = asPlainRecord(decomposition?.graph);
  const summary = asPlainRecord(value.summary);
  const schedule = asPlainRecord(value.schedule);
  return (
    typeof feature?.id === "string" &&
    typeof graph?.rootId === "string" &&
    isPlainRecord(graph.nodes) &&
    Array.isArray(decomposition?.contracts) &&
    typeof summary?.mode === "string" &&
    Array.isArray(schedule?.batches)
  );
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function publishFoundationEvents(run: RunRecord, graph: TaskGraph): void {
  const now = new Date().toISOString();
  publishRunModelEvent(run.runId, { actor: "system", at: now, type: "grounding.started", payload: {} });

  for (const node of Object.values(graph.nodes)) {
    for (const iface of node.contract?.producedInterfaces ?? []) {
      publishRunModelEvent(run.runId, {
        actor: "system",
        at: now,
        type: "seam.frozen",
        payload: {
          seamId: iface.id,
          revision: 1,
          frozenSignature: iface.signature,
          extractedFrom: `contract:${node.id}`
        }
      });
    }
  }

  publishRunModelEvent(run.runId, {
    actor: "system",
    at: now,
    type: "grounding.completed",
    payload: { skeletonCommit: run.provisioned?.baseCommit ?? graph.baseCommit }
  });
}

function publishRunModelEventsFromExecutionResult(
  run: RunRecord,
  graph: TaskGraph,
  result: RunExecutionResult,
  finalApplication: Partial<RunRecord> | undefined
): void {
  const now = new Date().toISOString();

  for (const leaf of result.leafResults) {
    if (leaf.status === "success") {
      publishRunModelEvent(run.runId, {
        actor: "agent",
        at: now,
        type: "node.verify.passed",
        payload: {
          nodeId: leaf.taskId,
          commit: leaf.commitSha ?? leaf.currentHead,
          changedFiles: [...leaf.changedFiles],
          builtAgainst: consumedRevisionRefs(graph, leaf.taskId),
          ...(producedRevisionRef(graph, leaf.taskId) !== undefined
            ? { produces: producedRevisionRef(graph, leaf.taskId)! }
            : {})
        }
      });
    } else {
      publishRunModelEvent(run.runId, {
        actor: "agent",
        at: now,
        type: "node.execution.failed",
        payload: { nodeId: leaf.taskId, cause: leafFailureCause(leaf) }
      });
    }
  }

  for (const integration of result.integrationResults) {
    const childNodeIds = integration.childResults.map((child) => child.taskId);
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "integration.started",
      payload: { compositeNodeId: integration.compositeTaskId, childNodeIds }
    });

    if (integration.conflictDetails !== undefined) {
      const conflictId = `integration:${integration.compositeTaskId}:conflict`;
      const resolved = INTEGRATION_SUCCESS.has(integration.status);
      publishRunModelEvent(run.runId, {
        actor: "system",
        at: now,
        type: "conflict.detected",
        payload: {
          conflictId,
          dimension: "textual",
          status: resolved ? "resolved" : "detected",
          nodeIds: childNodeIds,
          files: [...integration.conflictDetails.files],
          autoResolvable: integration.repairAttempted,
          diagnosisRef: `diagnosis://runs/${run.runId}/integration/${integration.compositeTaskId}`
        }
      });
      if (resolved) {
        publishRunModelEvent(run.runId, {
          actor: "system",
          at: now,
          type: "conflict.resolved",
          payload: { conflictId, by: "system", resolutionId: integration.status }
        });
      } else {
        publishRunModelEvent(run.runId, {
          actor: "system",
          at: now,
          type: "decision.raised",
          payload: {
            decisionId: `resolve_conflict:${integration.compositeTaskId}`,
            kind: "resolve_conflict",
            blocking: true,
            context: { nodeIds: childNodeIds, conflictId }
          }
        });
      }
    }

    const validation = integration.parentValidation;
    const integrationPassed = INTEGRATION_SUCCESS.has(integration.status);
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "integration.validated",
      payload: {
        compositeNodeId: integration.compositeTaskId,
        testsPass: validation !== undefined ? (validation.passed ? 1 : 0) : 0,
        testsTotal: validation !== undefined ? 1 : 0,
        passed: validation !== undefined ? validation.passed : integrationPassed,
        builtAgainst: consumedRevisionRefs(graph, integration.compositeTaskId)
      }
    });
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "integration.completed",
      payload: {
        compositeNodeId: integration.compositeTaskId,
        commit: integration.integrationCommitSha ?? graph.baseCommit,
        status: integrationPassed ? "success" : integration.status
      }
    });
  }

  if (result.status === "completed") {
    const integrationCommit =
      finalApplication?.finalCommitSha ??
      finalApplication?.integrationCommitSha ??
      result.integrationResults.at(-1)?.integrationCommitSha ??
      result.leafResults.at(-1)?.commitSha ??
      graph.baseCommit;
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "run.evidence.ready",
      payload: {
        aggregateDiffRef: `diff://runs/${run.runId}/final`,
        tests: testsFor(result),
        narrativeRef: `narrative://runs/${run.runId}/receipt`,
        integrationCommit
      }
    });
    publishRunModelEvent(run.runId, {
      actor: "system",
      at: now,
      type: "decision.raised",
      payload: {
        decisionId: "approve_merge",
        kind: "approve_merge",
        blocking: true,
        context: { diffRef: `diff://runs/${run.runId}/final` }
      }
    });
  }

  publishRunModelEvent(run.runId, {
    actor: "system",
    at: now,
    type: "run.metrics.ready",
    payload: { metrics: metricsFromVector(result.granularityVector) }
  });
  publishRunModelEvent(run.runId, {
    actor: "system",
    at: now,
    type: "run.completed",
    payload: { status: result.status === "completed" ? "success" : "failed" }
  });
}

function consumedRevisionRefs(graph: TaskGraph, taskId: string): Array<{ seamId: string; revision: number }> {
  const node = graph.nodes[taskId];
  return (node?.contract?.consumedInterfaces ?? []).map((iface) => ({ seamId: iface.id, revision: 1 }));
}

function producedRevisionRef(graph: TaskGraph, taskId: string): { seamId: string; revision: number } | undefined {
  const iface = graph.nodes[taskId]?.contract?.producedInterfaces?.[0];
  return iface !== undefined ? { seamId: iface.id, revision: 1 } : undefined;
}

function leafFailureCause(leaf: AgentExecutionResult): string {
  if (leaf.executorTimedOut) return `${leaf.status}: timed out`;
  const stderr = leaf.stderrTail?.trim();
  if (stderr !== undefined && stderr.length > 0) return `${leaf.status}: ${stderr}`;
  return `${leaf.status}: executor exit ${leaf.executorExitCode}`;
}

function testsFor(result: RunExecutionResult): { pass: number; total: number } {
  if (result.validationResult !== undefined) {
    return { pass: result.validationResult.passed ? 1 : 0, total: 1 };
  }
  const checks = result.leafResults
    .map((leaf) => leaf.validationResult)
    .filter((validation): validation is NonNullable<AgentExecutionResult["validationResult"]> => validation !== undefined);
  return { pass: checks.filter((validation) => validation.passed).length, total: checks.length };
}

function metricsFromVector(vector: RunExecutionResult["granularityVector"]) {
  return {
    depth: vector.depth,
    leafCount: vector.leafCount,
    compositeCount: vector.compositeCount,
    avgLeafDepth: vector.avgLeafDepth,
    maxLeafDepth: vector.maxLeafDepth,
    dependencyCount: vector.dependencyCount,
    avgAcceptanceCriteriaPerLeaf: vector.avgAcceptanceCriteriaPerLeaf,
    ...(vector.estimatedTokensPerLeaf !== undefined ? { estimatedTokensPerLeaf: vector.estimatedTokensPerLeaf } : {}),
    integrationSuccessRate: vector.integrationSuccessRate,
    leafSuccessRate: vector.leafSuccessRate,
    conflictRate: vector.conflictRate,
    totalDurationMs: vector.totalDurationMs,
    linesChanged: vector.linesChanged,
    unexpectedCommitCount: vector.unexpectedCommitCount,
    scopeViolationCount: vector.scopeViolationCount,
    ...(vector.totalCostUsd !== undefined ? { totalCostUsd: vector.totalCostUsd } : {}),
    ...(vector.testsPassedRate !== undefined ? { testsPassedRate: vector.testsPassedRate } : {})
  };
}

export type NodeReviewAction = "approve" | "request_changes" | "rerun";

/**
 * Applies a per-node review action during the manual execution workflow.
 * - `approve`: marks the node's output reviewed (non-blocking annotation).
 * - `request_changes`: stores human feedback and resets the node + downstream
 *   results so the next run picks up the change.
 * - `rerun`: resets the node + downstream results and re-executes the node.
 *
 * `request_changes`/`rerun` reset execution state, so they only apply while the
 * run awaits manual execution (`approved`); `approve` is allowed in any state.
 */
export async function reviewNode(
  runId: string,
  taskId: string,
  action: NodeReviewAction,
  feedback?: string
): Promise<RunRecord> {
  const repo = getRunRepository();
  let run = await repo.get(runId);
  const graph = resolveExecutionGraph(run);
  if (graph.nodes[taskId] === undefined) {
    throw new RunValidationError(`Task "${taskId}" is not in the graph.`);
  }
  const now = new Date().toISOString();

  if (action === "approve") {
    const reviews: Record<string, NodeReview> = { ...(run.nodeReviews ?? {}) };
    reviews[taskId] = { status: "approved", at: now };
    return repo.save({ ...run, nodeReviews: reviews, updatedAt: now });
  }

  // Re-open a finished run so Rerun / Request changes work in the autonomous
  // flow too (not only during the manual `approved` workflow).
  if (run.status === "completed" || run.status === "failed") {
    assertTransition(run.status, "approved");
    run = await repo.save({ ...run, status: "approved", updatedAt: now });
    publishRunEvent(run.runId, { kind: "status.changed", status: "approved", at: now });
  }

  if (run.status !== "approved") {
    throw new RunLifecycleError(
      `"${action}" is only available once the plan is approved or the run has finished, not "${run.status}".`
    );
  }

  // request_changes + rerun both invalidate the node and its downstream closure.
  const invalid = computeInvalidatedTasks(graph, taskId);
  const existing = executionResultsFromRun(run);
  const leafResults = existing.leafResults.filter((result) => !invalid.has(result.taskId));
  const integrationResults = existing.integrationResults.filter(
    (result) => !invalid.has(result.compositeTaskId)
  );
  const execution = buildExecutionArtifact(run.runId, graph, leafResults, integrationResults);

  const reviews: Record<string, NodeReview> = { ...(run.nodeReviews ?? {}) };
  for (const id of invalid) {
    delete reviews[id];
  }
  if (action === "request_changes") {
    reviews[taskId] = {
      status: "changes_requested",
      ...(feedback !== undefined && feedback.trim().length > 0 ? { feedback: feedback.trim() } : {}),
      at: now
    };
  }

  run = await repo.save({
    ...run,
    execution,
    nodeReviews: reviews,
    updatedAt: now,
    heartbeatAt: now
  });

  if (action === "rerun") {
    await assertManualNodeExecutionReady(run, taskId);
    void runNodeExecutionPipeline(run.runId, taskId).catch(() => undefined);
    run = await repo.get(runId);
  }

  return run;
}

function describeExecutionFailure(result: RunExecutionResult): string {
  const failedLeaves = result.leafResults.filter((leaf) => leaf.status !== "success");
  if (failedLeaves.length > 0) {
    const detail = failedLeaves.map((leaf) => `${leaf.taskId} (${leaf.status})`).join(", ");
    return `Execution failed: ${failedLeaves.length} leaf task(s) did not succeed: ${detail}.`;
  }
  return "Execution failed during integration or run-level validation.";
}

function publishEvent(runId: string, event: StreamEvent): void {
  publishRunEvent(runId, event);
}

async function persistLivePlanningNodes(
  runId: string,
  nodes: ReadonlyMap<string, PlanningLiveNode>
): Promise<void> {
  const current = await getRunRepository().get(runId).catch(() => null);
  if (current === null) {
    return;
  }
  await getRunRepository().save({
    ...current,
    livePlanningNodes: Array.from(nodes.values()).sort(
      (left, right) => left.depth - right.depth || left.id.localeCompare(right.id)
    )
  });
}
