import type { BenchmarkManifest, BenchmarkReport, EvaluationConfiguration } from "@manyhands/evaluator";

export interface BenchmarkSummary {
  id: string;
  name: string;
  description?: string;
  manifestPath: string;
  configurations: EvaluationConfiguration[];
  featureCount: number;
}

export interface BenchmarksListResponse {
  benchmarks: BenchmarkSummary[];
}

export interface BenchmarkDetailResponse {
  benchmark: BenchmarkSummary;
  manifest: BenchmarkManifest;
}

export interface BenchmarkRunRequest {
  config?: EvaluationConfiguration;
}

export interface BenchmarkRunResponse {
  benchmark: BenchmarkSummary;
  report: BenchmarkReport;
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

export type RunGranularityKey = "coarse" | "balanced" | "fine";

export interface RunPreview {
  id: string;
  workspaceId: string;
  workspaceName?: string | undefined;
  title: string;
  userPrompt: string;
  scenarioId: string;
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
  scenarioId: string;
  granularity: RunGranularityKey;
  model: string;
  userPrompt?: string;
}

export interface RunResponse {
  run: {
    runId: string;
    workspaceId: string;
    scenarioId: string;
    granularity: RunGranularityKey;
    model: string;
    userPrompt: string;
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
    decomposition?: {
      provider: "anthropic" | "deterministic";
      model: string;
      promptTemplateVersion?: string;
      fallbackUsed: boolean;
      fallbackReason?: "no_api_key" | "forced_by_env" | "forced_by_caller" | "llm_failed";
      validationErrors: string[];
      generatedAt: string;
      usage?: { inputTokens: number; outputTokens: number; costUsd?: number };
    };
  };
}
