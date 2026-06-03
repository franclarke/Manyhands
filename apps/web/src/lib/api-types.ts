import type { GranularityVector } from "@manyhands/execution-core";

/** Per-leaf receipt: auditable evidence of what one subagent did. */
export interface ExecutionLeafReceipt {
  taskId: string;
  status: string;
  changedFiles: number;
  commitSha?: string;
  scopePassed: boolean;
  durationMs: number;
  costUsd?: number;
}

export interface ExecutionSummary {
  status: "completed" | "failed";
  totalDurationMs: number;
  granularityVector: GranularityVector;
  leaves: ExecutionLeafReceipt[];
  integrations: Array<{ compositeTaskId: string; status: string }>;
}

export interface ApiErrorResponse {
  error: string;
}

export type PackageManagerKey = "pnpm" | "npm" | "yarn" | "bun";

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  description?: string | undefined;
  color?: string | undefined;
  /** Optional hints. Surfaced to the LLM decomposer, never executed yet. */
  repoPath?: string | undefined;
  packageManager?: PackageManagerKey | undefined;
  defaultBranch?: string | undefined;
  allowedPaths?: string[] | undefined;
  testCommand?: string | undefined;
  buildCommand?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceListResponse {
  workspaces: Workspace[];
}

export interface WorkspaceResponse {
  workspace: Workspace;
}

export interface WorkspaceCreateRequest {
  name: string;
  description?: string;
  color?: string;
  repoPath?: string;
  packageManager?: PackageManagerKey;
  defaultBranch?: string;
  allowedPaths?: string[];
  testCommand?: string;
  buildCommand?: string;
}

export interface WorkspaceUpdateRequest {
  name?: string;
  description?: string;
  color?: string;
  repoPath?: string;
  packageManager?: PackageManagerKey;
  defaultBranch?: string;
  allowedPaths?: string[];
  testCommand?: string;
  buildCommand?: string;
}

export type RunStatusKey =
  | "created"
  | "generating"
  | "paused"
  | "needs_review"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "interrupted";

export type RunGranularityKey = "auto" | "coarse" | "balanced" | "fine";

export interface RunPreview {
  id: string;
  workspaceId: string;
  workspaceName?: string | undefined;
  title: string;
  userPrompt: string;
  summary?: string | undefined;
  status: RunStatusKey;
  granularity: RunGranularityKey;
  model: string;
  nodeCount?: number | undefined;
  agentCount?: number | undefined;
  conflictCount?: number | undefined;
  createdAt: string;
  updatedAt: string;
  durationLabel?: string | undefined;
  href: string;
}

export interface RunsListResponse {
  runs: RunPreview[];
}

export interface RunCreateRequest {
  workspaceId: string;
  granularity: RunGranularityKey;
  model: string;
  userPrompt?: string;
  repoSpec?: { kind: "fixture"; fixtureId: string } | { kind: "localPath"; path: string };
}

export type ProviderReadinessStatus = "ready" | "warning" | "error";
export type ProviderReadinessCheckStatus = "pass" | "warning" | "fail";

export interface ProviderReadinessCheck {
  id: "cli" | "auth" | "repo_path" | "repo_clean" | "branch" | "quota";
  status: ProviderReadinessCheckStatus;
  label: string;
  message: string;
}

export interface ProviderReadiness {
  executorId: "gemini-cli";
  label: string;
  status: ProviderReadinessStatus;
  binaryPath: string;
  version?: string;
  quota: "unknown";
  checks: ProviderReadinessCheck[];
}

export interface ProviderReadinessResponse {
  providers: ProviderReadiness[];
}

export interface RunResponse {
  run: {
    runId: string;
    workspaceId: string;
    granularity: RunGranularityKey;
    model: string;
    userPrompt: string;
    summary?: string;
    title: string;
    status: RunStatusKey;
    pausedDuring?: "generating" | "running";
    interruptedDuring?: "generating" | "running";
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
    startedAt?: string;
    completedAt?: string;
    heartbeatAt?: string;
    finalCommitSha?: string;
    appliedToRepoPath?: string;
    appliedAt?: string;
    baseCommit?: string;
    integrationCommitSha?: string;
    decomposition?: {
      provider: "anthropic" | "gemini" | "codex" | "deterministic";
      model: string;
      promptTemplateVersion?: string;
      fallbackUsed: boolean;
      fallbackReason?: "no_api_key" | "forced_by_env" | "forced_by_caller" | "llm_failed";
      validationErrors: string[];
      generatedAt: string;
      usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
    };
    execution?: ExecutionSummary;
  };
}
