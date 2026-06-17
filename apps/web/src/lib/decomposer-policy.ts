import {
  AnthropicDecomposer,
  ClaudeCodeRecursiveDecomposer,
  CodexRecursiveDecomposer,
  MetadataDrivenMockDecomposer,
  RecursiveDecomposer,
  type AnthropicDecomposerResult,
  type Decomposer,
  type RecursiveStepCompletedEvent,
  type RecursiveStepListener,
  type RecursiveStepStartedEvent,
  type RecursiveStepStatusEvent,
  type WorkspaceHints
} from "@manyhands/core";
import type { Workspace } from "@/lib/api-types";

/**
 * Result of the policy decision. The runner uses these to wire the actual
 * `decompose()` call and to persist the right metadata in the RunRecord.
 */
export interface DecomposerSelection {
  decomposer: Decomposer;
  provider: "anthropic" | "claude-code" | "codex-cli" | "deterministic";
  model: string;
  promptTemplateVersion?: string;
  fallbackReason?: "no_api_key" | "forced_by_env" | "forced_by_caller";
  /** Only present when provider === "anthropic". Set by callers that need post-call telemetry. */
  getAnthropicTelemetry?: () => AnthropicDecomposerResult | null;
}

export interface PickDecomposerInput {
  workspace?: Workspace;
  userPrompt: string;
  model: string;
  executorId?: string | undefined;
  /** Repository symbol-topology digest appended to the prompt grounding (Fase 2.1). */
  groundingDigest?: string;
  /** Skip the LLM regardless of env (used by Lab compare for reproducibility). */
  forceFallback?: boolean;
  onStepStarted?: RecursiveStepListener<RecursiveStepStartedEvent>;
  onStepCompleted?: RecursiveStepListener<RecursiveStepCompletedEvent>;
  onStepStatus?: RecursiveStepListener<RecursiveStepStatusEvent>;
  onCliOutput?: (data: { nodeId: string; chunk: string; stream: "stdout" | "stderr" }) => void;
}

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-5";

export function pickDecomposer(input: PickDecomposerInput): DecomposerSelection {
  const forceFallbackEnv = process.env.MANYHANDS_FORCE_FALLBACK === "1";
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (input.forceFallback === true) {
    return buildFallbackSelection(input, "forced_by_caller");
  }
  if (forceFallbackEnv) {
    return buildFallbackSelection(input, "forced_by_env");
  }
  const hints = toWorkspaceHints(input.workspace);
  const workspaceHints = formatWorkspaceHintsWithGrounding(hints, input.groundingDigest);
  const maxParallelSteps = planningMaxParallelFromEnv();
  const maxStepAttempts = positiveIntegerFromEnv("MANYHANDS_PLANNING_MAX_STEP_ATTEMPTS");
  const stepTimeoutMs = positiveIntegerFromEnv("MANYHANDS_PLANNING_STEP_TIMEOUT_MS");

  // The recursive interface-aware decomposer is the product default. For
  // local-first product runs, the step model is the Claude Code CLI.
  // Anthropic single-pass/recursive modes are kept only as explicit baselines.
  if (process.env.MANYHANDS_DECOMPOSER === "single-pass") {
    if (apiKey === undefined || apiKey.length === 0) {
      return buildFallbackSelection(input, "no_api_key");
    }
    const model = pickAnthropicModel(input.model);
    const decomposer = new AnthropicDecomposer({
      apiKey,
      model,
      userPrompt: input.userPrompt,
      ...(hints !== undefined ? { workspaceHints: hints } : {})
    });
    return {
      decomposer,
      provider: "anthropic",
      model,
      promptTemplateVersion: decomposer.promptTemplateVersion,
      getAnthropicTelemetry: () => decomposer.getLastResponse()
    };
  }

  if (process.env.MANYHANDS_DECOMPOSER === "anthropic-recursive") {
    if (apiKey === undefined || apiKey.length === 0) {
      return buildFallbackSelection(input, "no_api_key");
    }
    const model = pickAnthropicModel(input.model);
    const recursive = new RecursiveDecomposer({
      apiKey,
      model,
      userPrompt: input.userPrompt,
      ...(maxParallelSteps !== undefined ? { maxParallelSteps } : {}),
      ...(maxStepAttempts !== undefined ? { maxStepAttempts } : {}),
      ...(input.onStepStarted !== undefined ? { onStepStarted: input.onStepStarted } : {}),
      ...(input.onStepCompleted !== undefined ? { onStepCompleted: input.onStepCompleted } : {}),
      ...(input.onStepStatus !== undefined ? { onStepStatus: input.onStepStatus } : {}),
      ...(workspaceHints !== undefined ? { workspaceHints } : {})
    });
    return {
      decomposer: recursive,
      provider: "anthropic",
      model,
      promptTemplateVersion: recursive.promptTemplateVersion
    };
  }

  const model = input.model;
  const isCodex = input.executorId === "codex-cli";

  if (isCodex) {
    const recursive = new CodexRecursiveDecomposer({
      cwd: input.workspace?.repoPath ?? process.cwd(),
      model,
      userPrompt: input.userPrompt,
      ...(stepTimeoutMs !== undefined ? { timeoutMs: stepTimeoutMs } : {}),
      ...(maxParallelSteps !== undefined ? { maxParallelSteps } : {}),
      ...(maxStepAttempts !== undefined ? { maxStepAttempts } : {}),
      ...(input.onStepStarted !== undefined ? { onStepStarted: input.onStepStarted } : {}),
      ...(input.onStepCompleted !== undefined ? { onStepCompleted: input.onStepCompleted } : {}),
      ...(input.onStepStatus !== undefined ? { onStepStatus: input.onStepStatus } : {}),
      ...(workspaceHints !== undefined ? { workspaceHints } : {}),
      ...(input.onCliOutput !== undefined ? { onCliOutput: input.onCliOutput } : {})
    });
    return {
      decomposer: recursive,
      provider: "codex-cli",
      model,
      promptTemplateVersion: recursive.promptTemplateVersion
    };
  }

  const recursive = new ClaudeCodeRecursiveDecomposer({
    cwd: input.workspace?.repoPath ?? process.cwd(),
    model,
    userPrompt: input.userPrompt,
    ...(stepTimeoutMs !== undefined ? { timeoutMs: stepTimeoutMs } : {}),
    ...(maxParallelSteps !== undefined ? { maxParallelSteps } : {}),
    ...(maxStepAttempts !== undefined ? { maxStepAttempts } : {}),
    ...(input.onStepStarted !== undefined ? { onStepStarted: input.onStepStarted } : {}),
    ...(input.onStepCompleted !== undefined ? { onStepCompleted: input.onStepCompleted } : {}),
    ...(input.onStepStatus !== undefined ? { onStepStatus: input.onStepStatus } : {}),
    ...(workspaceHints !== undefined ? { workspaceHints } : {}),
    ...(input.onCliOutput !== undefined ? { onCliOutput: input.onCliOutput } : {})
  });
  return {
    decomposer: recursive,
    provider: "claude-code",
    model,
    promptTemplateVersion: recursive.promptTemplateVersion
  };
}

/** Combines the workspace hints block with the repository grounding digest (Fase 2.1). */
function formatWorkspaceHintsWithGrounding(
  hints: WorkspaceHints | undefined,
  groundingDigest: string | undefined
): string | undefined {
  const parts: string[] = [];
  if (hints !== undefined) parts.push(formatWorkspaceHints(hints));
  if (groundingDigest !== undefined && groundingDigest.trim().length > 0) parts.push(groundingDigest);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

/** Renders structured workspace hints into the plain-text block the recursive prompt expects. */
function formatWorkspaceHints(hints: WorkspaceHints): string {
  const lines = [`- name: ${hints.name}`];
  if (hints.repoPath !== undefined) lines.push(`- repoPath: ${hints.repoPath}`);
  if (hints.packageManager !== undefined) lines.push(`- packageManager: ${hints.packageManager}`);
  if (hints.defaultBranch !== undefined) lines.push(`- defaultBranch: ${hints.defaultBranch}`);
  if (hints.allowedPaths !== undefined && hints.allowedPaths.length > 0) {
    lines.push(`- allowedPaths: ${hints.allowedPaths.slice(0, 12).join(", ")}`);
  }
  if (hints.testCommand !== undefined) lines.push(`- testCommand: ${hints.testCommand}`);
  if (hints.buildCommand !== undefined) lines.push(`- buildCommand: ${hints.buildCommand}`);
  return lines.join("\n");
}

function buildFallbackSelection(
  input: PickDecomposerInput,
  reason: "no_api_key" | "forced_by_env" | "forced_by_caller"
): DecomposerSelection {
  return {
    decomposer: new MetadataDrivenMockDecomposer(),
    provider: "deterministic",
    model: input.model,
    fallbackReason: reason
  };
}

function pickAnthropicModel(requested: string): string {
  if (requested.startsWith("claude-")) {
    return requested;
  }
  return DEFAULT_ANTHROPIC_MODEL;
}

function planningMaxParallelFromEnv(): number | undefined {
  return positiveIntegerFromEnv("MANYHANDS_PLANNING_MAX_PARALLEL");
}

function positiveIntegerFromEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim().length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toWorkspaceHints(workspace: Workspace | undefined): WorkspaceHints | undefined {
  if (workspace === undefined) return undefined;
  const hints: WorkspaceHints = { name: workspace.name };
  if (workspace.repoPath !== undefined) hints.repoPath = workspace.repoPath;
  if (workspace.packageManager !== undefined) hints.packageManager = workspace.packageManager;
  if (workspace.defaultBranch !== undefined) hints.defaultBranch = workspace.defaultBranch;
  if (workspace.allowedPaths !== undefined && workspace.allowedPaths.length > 0) hints.allowedPaths = workspace.allowedPaths;
  if (workspace.testCommand !== undefined) hints.testCommand = workspace.testCommand;
  if (workspace.buildCommand !== undefined) hints.buildCommand = workspace.buildCommand;
  return hints;
}
