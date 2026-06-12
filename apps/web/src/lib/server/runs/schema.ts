import { EXECUTOR_IDS, ExecutionConfigSchema } from "@manyhands/execution-core";
import { TraceEventSchema } from "@manyhands/trace-store";
import { z } from "zod";

import { RepoSpecSchema } from "./repo-provisioner";

export const RUN_FILE_VERSION = 1;

/**
 * Partial execution-config overrides stored on a run. Defaults live in
 * execution-core's `ExecutionConfigSchema` and are applied at engine-build
 * time via `ExecutionConfigSchema.parse(input ?? {})`, so we never duplicate
 * them here.
 */
export const ExecutionConfigInputSchema = ExecutionConfigSchema.partial();

export type ExecutionConfigInput = z.infer<typeof ExecutionConfigInputSchema>;

export const ExecutorSelectionSchema = z.object({
  executorId: z.enum(EXECUTOR_IDS),
  model: z.string().min(1)
});

export type ExecutorSelectionInput = z.infer<typeof ExecutorSelectionSchema>;

/** Serializable record of the repo a run was provisioned against (artifact). */
export const ProvisionedRepoRecordSchema = z.object({
  repoRoot: z.string().min(1),
  baseBranch: z.string().min(1),
  baseCommit: z.string().min(1),
  provisionedAt: z.string().datetime()
});

export type ProvisionedRepoRecord = z.infer<typeof ProvisionedRepoRecordSchema>;

export const RUN_STATUS_VALUES = [
  "created",
  "generating",
  "paused",
  "needs_review",
  "approved",
  "running",
  "completed",
  "failed",
  "interrupted"
] as const;

export type RunStatus = (typeof RUN_STATUS_VALUES)[number];

export const RunStatusSchema = z.enum(RUN_STATUS_VALUES);

export const GranularityModeSchema = z.union([
  z.literal("auto"),
  z.literal("coarse"),
  z.literal("balanced"),
  z.literal("fine")
]);

export type GranularityMode = z.infer<typeof GranularityModeSchema>;

export const RunDecompositionMetadataSchema = z.object({
  provider: z.union([
    z.literal("anthropic"),
    z.literal("gemini"),
    // "codex" retained so RunRecords persisted before the Gemini swap still load.
    z.literal("codex"),
    z.literal("deterministic")
  ]),
  model: z.string().min(1),
  promptTemplateVersion: z.string().min(1).optional(),
  rawResponse: z.string().optional(),
  parsedOutput: z.unknown().optional(),
  validationErrors: z.array(z.string()).default([]),
  fallbackUsed: z.boolean(),
  fallbackReason: z
    .union([
      z.literal("no_api_key"),
      z.literal("forced_by_env"),
      z.literal("forced_by_caller"),
      z.literal("llm_failed")
    ])
    .optional(),
  generatedAt: z.string().datetime(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative().optional()
    })
    .optional()
});

export type RunDecompositionMetadata = z.infer<typeof RunDecompositionMetadataSchema>;

export const PlanningLiveNodeSchema = z.object({
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  title: z.string().min(1),
  goal: z.string().min(1).optional(),
  depth: z.number().int().nonnegative(),
  state: z.union([
    z.literal("pending"),
    z.literal("active"),
    z.literal("complete"),
    z.literal("generating"),
    z.literal("generated"),
    z.literal("failed"),
    z.literal("retrying"),
    z.literal("fallback")
  ]),
  decision: z.union([z.literal("atomic"), z.literal("decompose"), z.literal("question")]).optional(),
  childCount: z.number().int().nonnegative().optional(),
  childIds: z.array(z.string().min(1)).optional(),
  attempt: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  errorKind: z.string().min(1).optional(),
  errorMessage: z.string().min(1).optional()
});

export type PlanningLiveNode = z.infer<typeof PlanningLiveNodeSchema>;

/** Finding emitted by a deterministic plan critic (PlanCritic / SeamCritic). */
export const CriticFindingSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),
  taskId: z.string().optional(),
  message: z.string(),
  suggestion: z.string().optional()
});

export const CriticStatusSchema = z.enum(["clean", "warnings", "errors"]);

/** Deterministic graph/contract quality critic over the generated plan. */
export const PlanCriticResultSchema = z.object({
  status: CriticStatusSchema,
  findings: z.array(CriticFindingSchema),
  generatedAt: z.string()
});

/** Deterministic seam-consistency critic over consumed/produced interfaces. */
export const SeamCriticResultSchema = z.object({
  status: CriticStatusSchema,
  seamCount: z.number().int().nonnegative(),
  findings: z.array(CriticFindingSchema),
  generatedAt: z.string()
});

/** Compact summary of the repository index used to ground planning. */
export const RepositoryGroundingSummarySchema = z.object({
  repositoryId: z.string(),
  fileCount: z.number().int().nonnegative(),
  symbolCount: z.number().int().nonnegative(),
  indexHash: z.string(),
  indexedAt: z.string().optional()
});

export type CriticFinding = z.infer<typeof CriticFindingSchema>;
export type PlanCriticResult = z.infer<typeof PlanCriticResultSchema>;
export type SeamCriticResult = z.infer<typeof SeamCriticResultSchema>;
export type RepositoryGroundingSummary = z.infer<typeof RepositoryGroundingSummarySchema>;

/** Human review verdict on a single node's output during manual execution. */
export const NodeReviewSchema = z.object({
  status: z.enum(["approved", "changes_requested"]),
  feedback: z.string().max(4000).optional(),
  at: z.string().datetime()
});

export type NodeReview = z.infer<typeof NodeReviewSchema>;

export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  granularity: GranularityModeSchema,
  model: z.string().min(1),
  planningModel: z.string().min(1).optional(),
  defaultExecutionSelection: ExecutorSelectionSchema.optional(),
  defaultRepairSelection: ExecutorSelectionSchema.optional(),
  userPrompt: z.string().max(4000),
  title: z.string().min(1).max(160),
  /** LLM-generated one-paragraph description. Falls back to userPrompt in the UI. */
  summary: z.string().max(400).optional(),
  /**
   * Monotonic write counter, bumped by the repository on every persisted write.
   * Optimistic-concurrency token for HITL mutations: clients echo it back and
   * `claimRunMutation` rejects stale claims with 409. Defaults to 0 so records
   * persisted before this field load unchanged.
   */
  version: z.number().int().nonnegative().default(0),
  status: RunStatusSchema,
  pausedDuring: z.union([z.literal("generating"), z.literal("running")]).optional(),
  /** Phase from which the run was interrupted (server restart, stale heartbeat). */
  interruptedDuring: z.union([z.literal("generating"), z.literal("running")]).optional(),
  /** Phase in which the run failed. Lets restart resume the right pipeline and
   *  the phase bar mark the real step instead of always blaming "Review outputs". */
  failedDuring: z.union([z.literal("generating"), z.literal("running")]).optional(),
  errorMessage: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  approvedAt: z.string().datetime().optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  /** Updated by the runner every few seconds while planning or executing. */
  heartbeatAt: z.string().datetime().optional(),
  // Opaque payloads produced by the planning and execution pipelines. The full
  // nested shape is not re-validated here to keep apps/web decoupled from the
  // internal schemas of @manyhands/decomposer and @manyhands/execution-core.
  planning: z.unknown().optional(),
  execution: z.unknown().optional(),
  decomposition: RunDecompositionMetadataSchema.optional(),
  /** Target repo for real execution. */
  repoSpec: RepoSpecSchema.optional(),
  /** Filled by the runner once the repo is provisioned, before execution. */
  provisioned: ProvisionedRepoRecordSchema.optional(),
  /** Final integrated patch applied back to the selected repo after successful execution. */
  finalPatch: z.string().optional(),
  /** Outcome of writing the result back: applied to a branch, exported, or failed. */
  finalApplicationStatus: z.enum(["applied", "exported_patch", "failed"]).optional(),
  /** Branch created from baseCommit holding the applied result (e.g. manyhands/run-...). */
  finalBranchName: z.string().min(1).optional(),
  finalCommitSha: z.string().min(1).optional(),
  appliedToRepoPath: z.string().min(1).optional(),
  appliedAt: z.string().datetime().optional(),
  /** Path on disk where the patch was written when it could not be applied to a branch. */
  exportedPatchPath: z.string().min(1).optional(),
  /** Human-readable detail when application was exported or failed. */
  finalApplicationMessage: z.string().optional(),
  baseCommit: z.string().min(1).optional(),
  integrationCommitSha: z.string().min(1).optional(),
  /** Optional per-run overrides; defaults applied from execution-core at runtime. */
  executionConfig: ExecutionConfigInputSchema.optional(),
  /** Trace events emitted by the execution engine, persisted as run evidence. */
  executionTraces: z.array(TraceEventSchema).optional(),
  /** Append-only edit log. Sprint 2 of Fase C consumes this; reserved here for compatibility. */
  patches: z.array(z.unknown()).default([]),
  pendingQuestion: z
    .object({
      nodeId: z.string().min(1),
      question: z.string().min(1),
      options: z.array(z.string().min(1)).min(2).max(10)
    })
    .optional(),
  /**
   * Typed execution-gate interrupt awaiting a human decision (LangGraph HITL).
   * Set alongside pendingQuestion (the human-readable projection) while the
   * execution graph is suspended; cleared on resume.
   */
  pendingDecision: z
    .object({
      gate: z.union([z.literal("leaf_validation_failed"), z.literal("merge_conflict")]),
      /**
       * Unique id for THIS suspension, minted when the pause is persisted.
       * Resumes that carry a gateId only match this exact interruption, so a
       * stale tab can never resolve a newer gate. Optional: legacy pauses
       * persisted before the field resume by state expectations alone.
       */
      gateId: z.string().min(1).optional(),
      taskId: z.string().min(1),
      validationOutput: z.string().optional(),
      conflictFiles: z.array(z.string().min(1)).optional(),
      integrationStatus: z.string().optional()
    })
    .optional(),
  /**
   * Suspended replan awaiting a clarifying answer (U2). Set alongside
   * pendingQuestion while a selective re-decomposition is gated on the human;
   * carries the decomposer's resumable step cache + accumulated answers so the
   * replan continues where it stopped instead of aborting.
   */
  pendingReplan: z
    .object({
      taskId: z.string().min(1),
      reason: z.string(),
      stepCache: z.record(z.any()),
      questionAnswers: z.record(z.string())
    })
    .optional(),
  /** Progressive recursive-planning nodes persisted while the final graph is still being generated. */
  livePlanningNodes: z.array(PlanningLiveNodeSchema).optional(),
  questionAnswers: z.record(z.string()).optional(),
  planningStepCache: z.record(z.any()).optional(),
  /** Per-node human review verdicts (Approve output / Request changes), keyed by taskId. */
  nodeReviews: z.record(NodeReviewSchema).optional(),
  /** Deterministic plan-quality critic, computed after planning (Fase 2). */
  planningCritic: PlanCriticResultSchema.optional(),
  /** Deterministic seam-consistency critic, computed after planning (Fase 2). */
  seamCritic: SeamCriticResultSchema.optional(),
  /** Repository index summary used to ground the planner (Fase 2). */
  repositoryGrounding: RepositoryGroundingSummarySchema.optional()
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export const RunFileSchema = z.object({
  version: z.literal(RUN_FILE_VERSION),
  run: RunRecordSchema
});

export type RunFile = z.infer<typeof RunFileSchema>;

export const RunCreateRequestSchema = z.object({
  workspaceId: z.string().min(1),
  granularity: GranularityModeSchema,
  model: z.string().min(1),
  planningModel: z.string().min(1).optional(),
  defaultExecutionSelection: ExecutorSelectionSchema.optional(),
  defaultRepairSelection: ExecutorSelectionSchema.optional(),
  userPrompt: z.string().trim().max(4000).default(""),
  /** Target repo for real execution. */
  repoSpec: RepoSpecSchema.optional()
});

export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;
