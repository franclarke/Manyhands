import type { Workspace } from "@/lib/api-types";
import {
  publishRunModelEvent
} from "./run-model-event-log";
import {
  planNodeProposedEvent,
  planNodeStatusEvent,
  planCompletionEvents
} from "./planning-run-model-adapter";
const publishEvent = publishRunEvent;
import { pickDecomposer, type DecomposerSelection } from "@/lib/decomposer-policy";
import { runPlanCritic, runSeamCritic } from "@/lib/plan-critic";
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
    type PredictedConflictHint,
    type RunExecutionResult
} from "@manyhands/execution-core";
import type { TaskGraph } from "@manyhands/task-graph";
import { type TraceStore } from "@manyhands/trace-store";
import { randomUUID } from "node:crypto";
import { detectWorkspaceCommands } from "../providers/command-detection";
import { getWorkspaceRepository } from "../workspaces";
import { publishRunEvent } from "./event-bus";
import type { RiskLevelKey } from "./events";
import { assertTransition } from "./lifecycle";
import { buildRepositoryGrounding } from "./repo-index-cache";
import {
    type ProvisionedRepo,
    type RepoProvisioner
} from "./repo-provisioner";
import { generateRunTitle, type RunTitle } from "./run-titler";
import { startHeartbeat } from "./runner-heartbeat";
import { markRunnerActive, markRunnerInactive } from "./runner-state";
import type {
    ExecutionConfigInput,
    PlanningLiveNode,
    RunDecompositionMetadata,
    RunRecord,
    RunStatus
} from "./schema";
import { getRunRepository } from "./store";

export { computeInvalidatedTasks } from "./execution-state";
export type { ExecutionResults } from "./execution-state";

const PLANNING_EVENT_INTERVAL_MS = 110;
const PAUSE_POLL_MS = 80;

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

export async function transitionTo(run: RunRecord, status: RunStatus, extra: Partial<RunRecord> = {}): Promise<RunRecord> {
  console.log(`[Runner] Run ${run.runId}: Transición de estado de "${run.status}" a "${status}"`);
  assertTransition(run.status, status);
  const next: RunRecord = { ...run, ...extra, status };
  const saved = await getRunRepository().save(next);
  publishRunEvent(saved.runId, { kind: "status.changed", status: saved.status, at: saved.updatedAt });
  return saved;
}

export async function waitWhilePaused(runId: string, phase: "generating" | "running"): Promise<void> {
  while (true) {
    const current = await getRunRepository().get(runId);
    if (current.status !== "paused" || current.pausedDuring !== phase) {
      return;
    }
    await sleep(PAUSE_POLL_MS);
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        publishRunModelEvent(run.runId, planNodeProposedEvent({
          nodeId: event.nodeId,
          parentId: event.parentId,
          title: event.title,
          goal: event.goal,
          depth: event.depth
        }, event.parentId === null ? "root" : "leaf"));
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
          state: event.state as any,
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
        publishRunModelEvent(run.runId, planNodeStatusEvent({
          nodeId: event.nodeId,
          parentId: event.parentId,
          title: event.title,
          goal: event.goal,
          depth: event.depth,
          state: event.state as any,
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.error?.kind !== undefined ? { errorKind: event.error.kind } : {}),
          ...(event.error?.message !== undefined ? { errorMessage: event.error.message } : {})
        }));
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

    const rootNodes = Object.values(planning.decomposition.graph.nodes).filter(n => n.depth === 0);
    const rootId = rootNodes.length > 0 ? rootNodes[0]!.id : "root";
    const executableNodeIds = Object.values(planning.decomposition.graph.nodes)
      .filter(n => n.kind === "leaf")
      .map(n => n.id);

    const seamDrafts: any[] = [];
    const contracts = planning.decomposition.contracts as AgentTaskContract[];
    const consumersBySeam = new Map<string, string[]>();
    for (const contract of contracts) {
      for (const consumed of contract.consumedInterfaces ?? []) {
        const arr = consumersBySeam.get(consumed.id) ?? [];
        arr.push(contract.taskId);
        consumersBySeam.set(consumed.id, arr);
      }
    }
    for (const contract of contracts) {
      for (const produced of contract.producedInterfaces ?? []) {
        seamDrafts.push({
          seamId: produced.id,
          name: produced.id,
          producerNodeId: contract.taskId,
          consumerNodeIds: consumersBySeam.get(produced.id) ?? [],
          draftSignature: produced.signature
        });
      }
    }

    const completionEvents = planCompletionEvents({
      rootId,
      nodeCount: Object.keys(planning.decomposition.graph.nodes).length,
      seams: seamDrafts,
      criticFindings: planningCritic.findings.map(f => f.message),
      executableNodeIds
    });
    for (const ev of completionEvents) {
      publishRunModelEvent(runId, ev);
    }

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

export async function persistLivePlanningNodes(
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
