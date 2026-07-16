import type { GranularityVector } from "@manyhands/execution-core";
import type { EffortLevel } from "@manyhands/shared";
import type { PlanCriticResult, SeamCriticResult } from "@/lib/critic-types";

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

export type WorkspaceMigrationResolutionChoice = "canonical" | "duplicate";

export interface WorkspaceMigrationConflict {
  version: 1;
  repositoryKey: string;
  canonicalWorkspaceId: string;
  duplicateWorkspaceId: string;
  conflictingFields: string[];
  canonicalSnapshot: Workspace;
  duplicateSnapshot: Workspace;
  resolution?: {
    choice: WorkspaceMigrationResolutionChoice;
    resolvedAt: string;
  } | undefined;
}

export interface WorkspaceListResponse {
  workspaces: Workspace[];
  migrationConflicts: WorkspaceMigrationConflict[];
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
  | "completed_with_accepted"
  | "partial"
  | "unverified"
  | "needs_delivery"
  | "failed_artifact"
  | "failed_delivery"
  | "cancelling"
  | "failed"
  | "interrupted";

export type RunGranularityKey = "auto" | "coarse" | "balanced" | "fine";
// "gemini-cli" retained only so RunRecords persisted before the Claude Code swap
// (ADR-0031) still type-check; it is no longer a live/selectable executor.
export type ExecutorId = "gemini-cli" | "claude-code-cli" | "codex-cli" | "opencode-cli";

export interface ExecutorSelection {
  executorId: ExecutorId;
  model: string;
}

/** Canonical per-stage selection surfaced to the client (U2A-2). */
export interface StageSelection {
  executorId: ExecutorId;
  model: string;
  effort?: EffortLevel;
}

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
  coordinationRiskCount?: number | undefined;
  createdAt: string;
  updatedAt: string;
  durationLabel?: string | undefined;
  href: string;
}

export interface RunsListResponse {
  runs: RunPreview[];
  degradedRecords: Array<{ runId: string; reason: string; diagnosticsHref: string }>;
}

export interface RunCreateRequest {
  workspaceId: string;
  granularity: RunGranularityKey;
  model: string;
  planningExecutorId?: ExecutorId | undefined;
  planningModel?: string | undefined;
  defaultExecutionSelection?: ExecutorSelection | undefined;
  defaultRepairSelection?: ExecutorSelection | undefined;
  executionConfig?: { reasoningEffort?: EffortLevel } | undefined;
  userPrompt?: string;
  repoSpec?: { kind: "fixture"; fixtureId: string } | { kind: "localPath"; path: string };
}

export type ProviderReadinessStatus = "ready" | "warning" | "error";
export type ProviderReadinessCheckStatus = "pass" | "warning" | "fail";

export interface ProviderReadinessCheck {
  id: "cli" | "auth" | "repo_path" | "repo_clean" | "branch" | "commands" | "quota" | "enabled";
  status: ProviderReadinessCheckStatus;
  label: string;
  message: string;
}

export interface ProviderReadiness {
  executorId: ExecutorId;
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

export interface CapabilityModel {
  id: string;
  label: string;
  capabilities: Array<"planning" | "execution" | "repair">;
  usage: "reported" | "estimated" | "unavailable";
  efforts: EffortLevel[] | null;
  defaultEffort?: EffortLevel;
}

export interface ExecutorCapabilityView {
  executorId: Exclude<ExecutorId, "gemini-cli">;
  label: string;
  provider: string;
  enabled: boolean;
  readiness: ProviderReadiness;
  models: CapabilityModel[];
}

export interface CapabilitiesResponse {
  executors: ExecutorCapabilityView[];
}

export interface RunResponse {
  run: {
    runId: string;
    workspaceId: string;
    granularity: RunGranularityKey;
    model: string;
    planningExecutorId?: ExecutorId;
    planningModel?: string;
    defaultExecutionSelection?: ExecutorSelection;
    defaultRepairSelection?: ExecutorSelection;
    planningSelection?: StageSelection;
    executionSelection?: StageSelection;
    repairSelection?: StageSelection;
    userPrompt: string;
    summary?: string;
    title: string;
    status: RunStatusKey;
    validation?: {
      status: "passed" | "failed" | "unverified";
      command?: string | undefined;
      ranAt?: string | undefined;
    };
    /** Monotonic write counter; echo back as `expectedVersion` for optimistic mutations. */
    version: number;
    /** Suspended execution gate awaiting a decision; echo `gateId` back on resume. */
    pendingDecision?: {
      gate: "leaf_validation_failed" | "merge_conflict" | "budget_exceeded";
      gateId?: string | undefined;
      taskId: string;
      validationOutput?: string | undefined;
      conflictFiles?: string[] | undefined;
      integrationStatus?: string | undefined;
      spentTokens?: number | undefined;
      spentUsd?: number | undefined;
      pendingTasks?: string[] | undefined;
    };
    pausedDuring?: "generating" | "running";
    interruptedDuring?: "generating" | "running";
    errorMessage?: string;
    createdAt: string;
    updatedAt: string;
    approvedAt?: string;
    startedAt?: string;
    completedAt?: string;
    heartbeatAt?: string;
    finalApplicationStatus?: "applied" | "exported_patch" | "failed";
    finalBranchName?: string;
    finalCommitSha?: string;
    appliedToRepoPath?: string;
    appliedAt?: string;
    exportedPatchPath?: string;
    finalApplicationMessage?: string;
    baseCommit?: string;
    integrationCommitSha?: string;
    nodeReviews?: Record<
      string,
      { status: "approved" | "changes_requested"; feedback?: string | undefined; at: string }
    >;
    planningCritic?: PlanCriticResult;
    seamCritic?: SeamCriticResult;
    repositoryGrounding?: {
      repositoryId: string;
      fileCount: number;
      symbolCount: number;
      indexHash: string;
      indexedAt?: string | undefined;
    };
    decomposition?: {
      provider: "anthropic" | "claude-code" | "claude-code-cli" | "gemini" | "codex" | "codex-cli" | "deterministic";
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
