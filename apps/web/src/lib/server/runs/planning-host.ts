/**
 * Planning host — the single place where the web app drives the LangGraph
 * planning StateGraph (mirrors execution-host.ts for the execution graph).
 *
 * Owns: dependency wiring (recursive decomposer with live UI event streaming,
 * deterministic plan/seam critics), graph compilation over the
 * JsonFileCheckpointSaver, the stream loop, and interrupt projection.
 *
 * The decomposer's clarifying questions and the plan approval are native
 * LangGraph interrupts resumed with Command({ resume }) — the legacy
 * exception-driven control flow (DecomposerQuestionError reaching the web
 * pipeline) ends at this seam: the dep converts it to data.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Command } from "@langchain/langgraph";
import {
  JsonFileCheckpointSaver,
  buildPlanningGraph,
  planningThreadId,
  type DecomposePlanInput,
  type DecomposePlanResult,
  type PlanApprovalInterrupt,
  type PlanCritique,
  type PlanCritiqueFinding,
  type PlanningGraphDeps,
  type PlanningQuestionInterrupt
} from "@manyhands/orchestrator-graph";
import {
  isDecomposerLlmError,
  isDecomposerQuestionError,
  runMockPlanningFlow,
  type AgentTaskContract,
  type FeatureRequest,
  type MockPlanningFlowResult,
  type RepositoryIndex
} from "@manyhands/core";
import type { Workspace } from "@/lib/api-types";
import { pickDecomposer, type DecomposerSelection } from "@/lib/decomposer-policy";
import { runPlanCritic, runSeamCritic } from "@/lib/plan-critic";
import { detectWorkspaceCommands } from "../providers/command-detection";
import { getWorkspaceRepository } from "../workspaces";
import { publishRunEvent } from "./event-bus";
import type { RiskLevelKey } from "./events";
import { buildRepositoryGrounding } from "./repo-index-cache";
import { resolveRunsDirectory } from "./repository";
import { publishRunModelEvent } from "./run-model-event-log";
import {
  planCompletionEvents,
  planNodeProposedEvent,
  planNodeStatusEvent
} from "./planning-run-model-adapter";
import type { PlanningLiveNode, RunDecompositionMetadata, RunRecord } from "./schema";
import { getRunRepository } from "./store";

const PLANNING_EVENT_INTERVAL_MS = 110;
const PAUSE_POLL_MS = 80;

export interface PlanningHostOptions {
  /** Delay between replayed node/edge SSE events; tests pass 0. */
  intervalMs?: number;
}

export interface PlanningHost {
  graph: ReturnType<typeof buildPlanningGraph>;
  threadConfig: { configurable: { thread_id: string }; recursionLimit: number };
}

export type PlanningDriveOutcome =
  | { kind: "question"; interrupt: PlanningQuestionInterrupt }
  | { kind: "awaiting_approval"; interrupt: PlanApprovalInterrupt }
  | { kind: "finished"; status: "approved" | "needs_review" };

function planningCheckpointer(): JsonFileCheckpointSaver {
  return new JsonFileCheckpointSaver(join(resolveRunsDirectory(), "checkpoints"));
}

/** True when the run already has a persisted planning thread to continue. */
export async function hasPlanningCheckpoint(runId: string): Promise<boolean> {
  const checkpointer = planningCheckpointer();
  return (
    (await checkpointer.getTuple({ configurable: { thread_id: planningThreadId(runId) } })) !== undefined
  );
}

/** Drop the planning thread so a restart re-plans from scratch. */
export async function resetPlanningThread(runId: string): Promise<void> {
  await planningCheckpointer().deleteThread(planningThreadId(runId));
}

export function buildPlanningHost(run: RunRecord, options: PlanningHostOptions = {}): PlanningHost {
  const deps: PlanningGraphDeps = {
    decomposePlan: (input) => decomposePlanForRun(input, options),
    runCritics: (input) => runCriticsForRun(input.runId, input.graph as Parameters<typeof runPlanCritic>[0]["graph"])
  };

  return {
    graph: buildPlanningGraph({ deps, checkpointer: planningCheckpointer() }),
    threadConfig: {
      configurable: { thread_id: planningThreadId(run.runId) },
      // decompose ⇄ questionGate loops once per clarifying question; 256 covers
      // any realistic interview plus critics/approval supersteps.
      recursionLimit: 256
    }
  };
}

/** Initial graph state for a fresh planning thread (seeds legacy record fields). */
export function initialPlanningState(run: RunRecord, repoPath: string): Record<string, unknown> {
  return {
    runId: run.runId,
    userPrompt: run.userPrompt,
    workspaceId: run.workspaceId,
    repoPath,
    status: "planning",
    taskGraph: null,
    planningStepCache: run.planningStepCache ?? {},
    userAnswers: run.questionAnswers ?? {},
    pendingQuestion: null,
    errorMessage: null
  };
}

/**
 * Stream the planning graph until it finishes or suspends on a gate. Returns
 * the projected outcome; the pipeline maps it onto RunRecord status.
 */
export async function drivePlanning(
  host: PlanningHost,
  input: Record<string, unknown> | Command | null
): Promise<PlanningDriveOutcome> {
  const stream = await host.graph.stream(input as never, { ...host.threadConfig, streamMode: "updates" });
  for await (const _chunk of stream) {
    void _chunk;
  }

  const state = await host.graph.getState(host.threadConfig);
  const interrupt = state.tasks.flatMap((task) => task.interrupts)[0]?.value as
    | PlanningQuestionInterrupt
    | PlanApprovalInterrupt
    | undefined;

  if (interrupt !== undefined) {
    return interrupt.type === "planning_question"
      ? { kind: "question", interrupt }
      : { kind: "awaiting_approval", interrupt };
  }

  const status = (state.values as { status?: string } | undefined)?.status;
  return { kind: "finished", status: status === "approved" ? "approved" : "needs_review" };
}

// ─── decomposePlan dependency ──────────────────────────────────────────────

async function decomposePlanForRun(
  input: DecomposePlanInput,
  options: PlanningHostOptions
): Promise<DecomposePlanResult> {
  const repo = getRunRepository();
  const run = await repo.get(input.runId);

  const livePlanningNodes = new Map<string, PlanningLiveNode>(
    (run.livePlanningNodes ?? []).map((node) => [node.id, node])
  );
  const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);

  // Repository grounding: index the target repo once, up front. The digest
  // grounds the decomposer prompt (symbol topology) and the index feeds
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
      publishRunEvent(run.runId, {
        kind: "planning.node.started",
        nodeId: event.nodeId,
        ...(event.parentId !== null ? { parentId: event.parentId } : {}),
        title: event.title,
        goal: event.goal,
        depth: event.depth,
        at: new Date().toISOString()
      });
      publishRunModelEvent(
        run.runId,
        planNodeProposedEvent(
          {
            nodeId: event.nodeId,
            parentId: event.parentId,
            title: event.title,
            goal: event.goal,
            depth: event.depth
          },
          event.parentId === null ? "root" : "leaf"
        )
      );
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
      publishRunEvent(run.runId, {
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
        state: event.state as PlanningLiveNode["state"],
        ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
        ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
        ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
        ...(event.error?.kind !== undefined ? { errorKind: event.error.kind } : {}),
        ...(event.error?.message !== undefined ? { errorMessage: event.error.message } : {})
      });
      publishRunEvent(run.runId, {
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
      publishRunModelEvent(
        run.runId,
        planNodeStatusEvent({
          nodeId: event.nodeId,
          parentId: event.parentId,
          title: event.title,
          goal: event.goal,
          depth: event.depth,
          state: event.state as Parameters<typeof planNodeStatusEvent>[0]["state"],
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.maxAttempts !== undefined ? { maxAttempts: event.maxAttempts } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.error?.kind !== undefined ? { errorKind: event.error.kind } : {}),
          ...(event.error?.message !== undefined ? { errorMessage: event.error.message } : {})
        })
      );
      await persistLivePlanningNodes(run.runId, livePlanningNodes);
    },
    onCliOutput: (event) => {
      publishRunEvent(run.runId, {
        kind: "planning.cli.output",
        nodeId: event.nodeId,
        chunk: event.chunk,
        stream: event.stream,
        at: new Date().toISOString()
      });
    },
    ...(workspace !== null ? { workspace } : {})
  });

  console.log(`[Planner] Decomposer: provider="${selection.provider}", model="${selection.model}"`);

  const executableWorkspace = requireExecutableWorkspace(workspace, run.workspaceId);
  const feature = buildFeatureRequestFromPrompt(run.userPrompt, executableWorkspace, run.title);

  try {
    const { planning, decomposition } = await runPromptOnlyPlanning({
      selection,
      feature,
      run,
      questionAnswers: input.userAnswers,
      stepCache: input.stepCache,
      ...(grounding?.index !== undefined ? { repositoryIndex: grounding.index } : {})
    });

    // Persist planning + decomposition metadata before dispatching SSE events
    // so refreshes during `generating` already have a snapshot to project.
    const persisted = await repo.save({
      ...(await repo.get(run.runId)),
      planning,
      decomposition,
      ...(grounding?.summary !== undefined ? { repositoryGrounding: grounding.summary } : {}),
      heartbeatAt: new Date().toISOString()
    });

    await replayPlanEvents(persisted.runId, planning, options);

    return { kind: "complete", graph: planning.decomposition.graph };
  } catch (error) {
    // The seam where exception-driven HITL dies: a clarifying question is
    // converted to data here and surfaces as a native LangGraph interrupt.
    if (isDecomposerQuestionError(error)) {
      return {
        kind: "question",
        nodeId: error.nodeId,
        question: error.question,
        options: error.options,
        stepCache: error.stepCache
      };
    }
    throw error;
  }
}

// ─── critics dependency ────────────────────────────────────────────────────

async function runCriticsForRun(
  runId: string,
  graph: Parameters<typeof runPlanCritic>[0]["graph"]
): Promise<PlanCritique> {
  const repo = getRunRepository();
  const run = await repo.get(runId);
  const planning = run.planning as MockPlanningFlowResult | undefined;
  const contracts = (planning?.decomposition.contracts ?? []) as AgentTaskContract[];

  const workspace = await getWorkspaceRepository().get(run.workspaceId).catch(() => null);
  const detectedCommands =
    workspace?.repoPath !== undefined && workspace.repoPath.length > 0
      ? await detectWorkspaceCommands(workspace.repoPath).catch(() => undefined)
      : undefined;

  const planningCritic = runPlanCritic({
    graph,
    contracts,
    ...(detectedCommands !== undefined ? { detectedCommands } : {})
  });
  const seamCritic = runSeamCritic({ graph, contracts });

  await repo.save({ ...(await repo.get(runId)), planningCritic, seamCritic });

  if (planning !== undefined) {
    publishPlanCompletionEvents(runId, planning, planningCritic.findings.map((f) => f.message));
  }

  const findings: PlanCritiqueFinding[] = [
    ...planningCritic.findings.map((finding) => toCritiqueFinding(finding, "plan")),
    ...seamCritic.findings.map((finding) => toCritiqueFinding(finding, "seam"))
  ];
  return {
    findings,
    errorCount: findings.filter((finding) => finding.severity === "error").length
  };
}

function toCritiqueFinding(
  finding: { severity?: unknown; message?: unknown; code?: unknown },
  source: "plan" | "seam"
): PlanCritiqueFinding {
  return {
    severity: typeof finding.severity === "string" ? finding.severity : "info",
    message: typeof finding.message === "string" ? finding.message : "",
    source,
    ...(typeof finding.code === "string" ? { code: finding.code } : {})
  };
}

// ─── SSE replay of the finished plan ───────────────────────────────────────

async function replayPlanEvents(
  runId: string,
  planning: MockPlanningFlowResult,
  options: PlanningHostOptions
): Promise<void> {
  const interval = options.intervalMs ?? PLANNING_EVENT_INTERVAL_MS;
  const nodeIds = Object.values(planning.decomposition.graph.nodes)
    .sort((left, right) => left.depth - right.depth || left.id.localeCompare(right.id))
    .map((node) => node.id);

  for (const taskId of nodeIds) {
    await waitWhileGeneratingPaused(runId);
    publishRunEvent(runId, { kind: "node.added", taskId, at: new Date().toISOString() });
    await sleep(interval);
  }

  for (const dependency of planning.decomposition.graph.dependencies) {
    await waitWhileGeneratingPaused(runId);
    const edgeId = `dependency:${dependency.fromTaskId}:${dependency.toTaskId}`;
    publishRunEvent(runId, { kind: "edge.added", edgeId, at: new Date().toISOString() });
    await sleep(interval / 2);
  }

  for (const prediction of planning.riskMatrix) {
    await waitWhileGeneratingPaused(runId);
    publishRunEvent(runId, {
      kind: "risk.added",
      pairKey: `${prediction.taskAId}:${prediction.taskBId}`,
      level: prediction.level as RiskLevelKey,
      at: new Date().toISOString()
    });
    await sleep(interval / 2);
  }
}

function publishPlanCompletionEvents(
  runId: string,
  planning: MockPlanningFlowResult,
  criticFindings: string[]
): void {
  const nodes = Object.values(planning.decomposition.graph.nodes);
  const rootNodes = nodes.filter((node) => node.depth === 0);
  const rootId = rootNodes.length > 0 ? rootNodes[0]!.id : "root";
  const executableNodeIds = nodes.filter((node) => node.kind === "leaf").map((node) => node.id);

  const contracts = planning.decomposition.contracts as AgentTaskContract[];
  const consumersBySeam = new Map<string, string[]>();
  for (const contract of contracts) {
    for (const consumed of contract.consumedInterfaces ?? []) {
      const arr = consumersBySeam.get(consumed.id) ?? [];
      arr.push(contract.taskId);
      consumersBySeam.set(consumed.id, arr);
    }
  }
  const seamDrafts = contracts.flatMap((contract) =>
    (contract.producedInterfaces ?? []).map((produced) => ({
      seamId: produced.id,
      name: produced.id,
      producerNodeId: contract.taskId,
      consumerNodeIds: consumersBySeam.get(produced.id) ?? [],
      draftSignature: produced.signature
    }))
  );

  for (const event of planCompletionEvents({
    rootId,
    nodeCount: nodes.length,
    seams: seamDrafts,
    criticFindings,
    executableNodeIds
  })) {
    publishRunModelEvent(runId, event);
  }
}

// ─── prompt-only planning (D3: LLM required, no silent fallback) ───────────

interface PromptOnlyPlanningInput {
  selection: DecomposerSelection;
  feature: FeatureRequest;
  run: RunRecord;
  questionAnswers: Record<string, string>;
  stepCache: Record<string, unknown>;
  repositoryIndex?: RepositoryIndex;
}

interface PlanningResult {
  planning: MockPlanningFlowResult;
  decomposition: RunDecompositionMetadata;
}

async function runPromptOnlyPlanning(input: PromptOnlyPlanningInput): Promise<PlanningResult> {
  const { selection, feature, run } = input;
  const mode = resolveDecompositionMode(run.granularity);
  const baseOptions = {
    feature,
    mode,
    schedulerPolicy: "risk_aware" as const,
    runLabel: `${run.runId}:planning`,
    questionAnswers: input.questionAnswers,
    stepCache: input.stepCache
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
    // A clarifying question must bubble untouched to the graph seam above.
    if (isDecomposerQuestionError(error)) {
      throw error;
    }
    // D3: LLM failed → propagate with actionable message. No fallback.
    const detail = describePlanningFailure(error);
    throw new Error(
      `Graph generation failed: ${detail}. ` +
        "Retry, switch to a different Gemini model, or verify that Gemini CLI is installed and authenticated."
    );
  }
}

// ─── shared planning helpers ───────────────────────────────────────────────

/** Build a FeatureRequest from the user's natural-language prompt. */
export function buildFeatureRequestFromPrompt(
  userPrompt: string,
  workspace: Workspace,
  title?: string
): FeatureRequest {
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

async function waitWhileGeneratingPaused(runId: string): Promise<void> {
  while (true) {
    const current = await getRunRepository().get(runId);
    if (current.status !== "paused" || current.pausedDuring !== "generating") {
      return;
    }
    await sleep(PAUSE_POLL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
