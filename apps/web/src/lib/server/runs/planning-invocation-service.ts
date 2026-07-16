import type { ChildProcess, SpawnOptions } from "node:child_process";
import {
  isDecomposerLlmError,
  isDecomposerQuestionError,
  runMockPlanningFlow,
  type DecompositionMode,
  type FeatureRequest,
  type MockPlanningFlowOptions,
  type MockPlanningFlowResult,
  type RepositoryIndex
} from "@manyhands/core";
import type { Workspace } from "@/lib/api-types";
import {
  pickDecomposer,
  type DecomposerSelection,
  type PickDecomposerInput
} from "@/lib/decomposer-policy";
import {
  assertAvailableSelection,
  assertDeclaredStageSelection,
  inspectCapabilities
} from "../providers/capability-service";
import type { CapabilitiesResponse } from "@/lib/api-types";
import { planningSelection } from "./executor-selection";
import {
  ExecutorModelUnavailableError,
  PlanningExecutorUnavailableError
} from "./errors";
import { supervisedSpawnFn } from "./process-supervision";
import type { RunDecompositionMetadata, RunOperationLease, RunRecord } from "./schema";

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface PlanningInvocationLimits {
  maxParallelSteps?: number;
  maxPlanningDepth?: number;
  maxChildrenPerNode?: number;
  maxDecomposerCalls?: number;
  maxPromptBytes?: number;
}

export interface PlanningInvocationInput {
  run: RunRecord;
  feature: FeatureRequest;
  mode: DecompositionMode;
  runLabel: string;
  workspace?: Workspace;
  operationLease?: Pick<RunOperationLease, "operationId">;
  processLabel?: string;
  userPrompt?: string;
  groundingDigest?: string;
  repositoryIndex?: RepositoryIndex;
  questionAnswers?: Record<string, string>;
  stepCache?: Record<string, unknown>;
  limits?: PlanningInvocationLimits;
  onStepStarted?: PickDecomposerInput["onStepStarted"];
  onStepCompleted?: PickDecomposerInput["onStepCompleted"];
  onStepStatus?: PickDecomposerInput["onStepStatus"];
  onCliOutput?: PickDecomposerInput["onCliOutput"];
}

export interface PlanningInvocationResult {
  planning: MockPlanningFlowResult;
  decomposition: RunDecompositionMetadata;
}

export interface PlanningInvocationDependencies {
  pickDecomposer: (input: PickDecomposerInput) => DecomposerSelection;
  runPlanningFlow: (options: MockPlanningFlowOptions) => Promise<MockPlanningFlowResult>;
  createSupervisedSpawn: (input: {
    runId: string;
    label: string;
    operationId?: string;
  }) => SpawnFn;
  inspectCapabilities: (workspace: Workspace | null) => Promise<CapabilitiesResponse>;
}

const DEFAULT_DEPENDENCIES: PlanningInvocationDependencies = {
  pickDecomposer,
  runPlanningFlow: runMockPlanningFlow,
  createSupervisedSpawn: supervisedSpawnFn,
  inspectCapabilities
};

/**
 * The single productive seam for initial planning, subtree replan and manual
 * regeneration. It owns selection, effort, process supervision, fallback
 * policy and planning error semantics so every entry point behaves identically.
 */
export async function invokePlanning(
  input: PlanningInvocationInput,
  dependencies: PlanningInvocationDependencies = DEFAULT_DEPENDENCIES
): Promise<PlanningInvocationResult> {
  const stage = assertDeclaredStageSelection(
    "Planning",
    planningSelection(input.run),
    "planning"
  );
  const capabilities = await dependencies.inspectCapabilities(input.workspace ?? null);
  assertAvailableSelection(capabilities, stage, "Planning");
  const spawn = dependencies.createSupervisedSpawn({
    runId: input.run.runId,
    label: input.processLabel ?? "planning-decomposer",
    ...(input.operationLease !== undefined
      ? { operationId: input.operationLease.operationId }
      : {})
  });
  const limits = input.limits ?? {};
  const selection = dependencies.pickDecomposer({
    userPrompt: input.userPrompt ?? input.feature.description,
    model: stage.model,
    executorId: stage.executorId,
    spawn,
    ...(stage.effort !== undefined ? { reasoningEffort: stage.effort } : {}),
    ...(input.workspace !== undefined ? { workspace: input.workspace } : {}),
    ...(input.groundingDigest !== undefined ? { groundingDigest: input.groundingDigest } : {}),
    ...(limits.maxParallelSteps !== undefined ? { maxParallelSteps: limits.maxParallelSteps } : {}),
    ...(limits.maxPlanningDepth !== undefined ? { maxPlanningDepth: limits.maxPlanningDepth } : {}),
    ...(limits.maxChildrenPerNode !== undefined ? { maxChildrenPerNode: limits.maxChildrenPerNode } : {}),
    ...(limits.maxDecomposerCalls !== undefined ? { maxDecomposerCalls: limits.maxDecomposerCalls } : {}),
    ...(limits.maxPromptBytes !== undefined ? { maxPromptBytes: limits.maxPromptBytes } : {}),
    ...(input.onStepStarted !== undefined ? { onStepStarted: input.onStepStarted } : {}),
    ...(input.onStepCompleted !== undefined ? { onStepCompleted: input.onStepCompleted } : {}),
    ...(input.onStepStatus !== undefined ? { onStepStatus: input.onStepStatus } : {}),
    ...(input.onCliOutput !== undefined ? { onCliOutput: input.onCliOutput } : {})
  });

  if (selection.provider === "deterministic") {
    throw new PlanningExecutorUnavailableError(
      unavailableMessage(stage.executorId, selection.fallbackReason)
    );
  }

  try {
    const planning = await dependencies.runPlanningFlow({
      feature: input.feature,
      mode: input.mode,
      schedulerPolicy: "risk_aware",
      runLabel: input.runLabel,
      decomposer: selection.decomposer,
      ...(input.questionAnswers !== undefined ? { questionAnswers: input.questionAnswers } : {}),
      ...(input.stepCache !== undefined ? { stepCache: input.stepCache } : {}),
      ...(input.repositoryIndex !== undefined ? { repositoryIndex: input.repositoryIndex } : {})
    });
    return {
      planning,
      decomposition: decompositionMetadata(selection)
    };
  } catch (error) {
    if (isDecomposerQuestionError(error)) throw error;
    if (isUnknownModelFailure(error)) {
      throw new ExecutorModelUnavailableError(
        `Planning model "${stage.model}" is not available through ${stage.executorId}. ` +
          "Choose another declared model or authenticate an account that provides it."
      );
    }
    const wrapped = new Error(
      `Graph generation failed: ${describePlanningFailure(error)}. ` +
        "Retry, switch to another model for the selected executor, or verify that the selected CLI is installed and authenticated."
    );
    if (isDecomposerLlmError(error) && error.stepCache !== undefined) {
      (wrapped as Error & { stepCache?: Record<string, unknown> }).stepCache = error.stepCache;
    }
    throw wrapped;
  }
}

function isUnknownModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unknown model|model .*not (?:found|available|supported)|unsupported model|invalid model/i.test(message);
}

function unavailableMessage(
  executorId: string,
  reason: DecomposerSelection["fallbackReason"]
): string {
  if (reason === "forced_by_env") {
    return "MANYHANDS_FORCE_FALLBACK is set, but runs require the selected planning executor. Unset MANYHANDS_FORCE_FALLBACK to continue.";
  }
  if (reason === "forced_by_caller") {
    return "Deterministic mode was explicitly requested, but runs require the selected planning executor.";
  }
  return `Graph generation requires ${executorId}. Install and authenticate the selected CLI, then retry.`;
}

function decompositionMetadata(selection: DecomposerSelection): RunDecompositionMetadata {
  const telemetry = selection.getAnthropicTelemetry?.() ?? null;
  const metadata: RunDecompositionMetadata = {
    provider: selection.provider,
    model: selection.model,
    fallbackUsed: false,
    validationErrors: [],
    generatedAt: new Date().toISOString()
  };
  if (selection.promptTemplateVersion !== undefined) {
    metadata.promptTemplateVersion = selection.promptTemplateVersion;
  }
  if (telemetry?.usage !== undefined) metadata.usage = telemetry.usage;
  if (telemetry?.rawResponse !== undefined) metadata.rawResponse = telemetry.rawResponse;
  if (telemetry?.parsedOutput !== undefined) metadata.parsedOutput = telemetry.parsedOutput;
  return metadata;
}

function describePlanningFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!isDecomposerLlmError(error) || error.details === undefined) return message;
  const detail = error.details;
  return [
    message,
    `kind=${detail.kind}`,
    `stage=${detail.stage}`,
    ...(detail.nodeId !== undefined ? [`node=${detail.nodeId}`] : []),
    ...(detail.attempt !== undefined && detail.maxAttempts !== undefined
      ? [`attempt=${detail.attempt}/${detail.maxAttempts}`]
      : [])
  ].join(" | ");
}
