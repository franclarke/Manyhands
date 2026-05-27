import {
  AnthropicDecomposer,
  MetadataDrivenMockDecomposer,
  type AnthropicDecomposerResult,
  type Decomposer,
  type WorkspaceHints
} from "@manyhands/core";
import type { Workspace } from "@/lib/api-types";

/**
 * Result of the policy decision. The runner uses these to wire the actual
 * `decompose()` call and to persist the right metadata in the RunRecord.
 */
export interface DecomposerSelection {
  decomposer: Decomposer;
  provider: "anthropic" | "deterministic";
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
  /** Skip the LLM regardless of env (used by Lab compare for reproducibility). */
  forceFallback?: boolean;
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
  if (apiKey === undefined || apiKey.length === 0) {
    return buildFallbackSelection(input, "no_api_key");
  }

  const model = pickAnthropicModel(input.model);
  const decomposer = new AnthropicDecomposer({
    apiKey,
    model,
    userPrompt: input.userPrompt,
    ...(toWorkspaceHints(input.workspace) !== undefined
      ? { workspaceHints: toWorkspaceHints(input.workspace)! }
      : {})
  });

  return {
    decomposer,
    provider: "anthropic",
    model,
    promptTemplateVersion: decomposer.promptTemplateVersion,
    getAnthropicTelemetry: () => decomposer.getLastResponse()
  };
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
