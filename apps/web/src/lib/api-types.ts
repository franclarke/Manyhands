import type { GranularityVector } from "@manyhands/execution-core";
import type { EffortLevel } from "@manyhands/shared";

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
  | "planning"
  | "needs_approval"
  | "running"
  | "waiting_for_input"
  | "paused"
  | "cancelling"
  | "interrupted"
  | "result_ready"
  | "delivering"
  | "completed"
  | "failed";
// "gemini-cli" is retained only for legacy RunRecords created before the
// current Claude Code/Codex executor set; it is not live or selectable.
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
  status: RunStatusKey;
  coordinationRiskCount?: number | undefined;
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
  userPrompt: string;
  planningSelection?: StageSelection;
  executionSelection?: StageSelection;
  repairSelection?: StageSelection;
  executionConfig?: {
    maxParallel?: number;
    reasoningEffort?: EffortLevel;
  };
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
    userPrompt: string;
    title: string;
    lifecycle: RunStatusKey;
    eventSequence: number;
    planningSelection: StageSelection;
    executionSelection: StageSelection;
    repairSelection: StageSelection;
    version: number;
    createdAt: string;
    updatedAt: string;
    graphId?: string;
    graphRevision?: number;
    approvedGraphRevision?: number;
    finalManifestId?: string;
    finalCommit?: string;
    failureReason?: string;
  };
}
