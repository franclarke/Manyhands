import { EXECUTOR_IDS, ExecutionConfigSchema, ReasoningEffortSchema } from "@manyhands/execution-core";
import { TraceEventSchema } from "@manyhands/trace-store";
import { z } from "zod";

import { RUN_USER_PROMPT_MAX_LENGTH } from "@/lib/run-limits";
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
const RunCreateExecutionConfigInputSchema = ExecutionConfigInputSchema.omit({ routing: true }).strict();

/** B-029: persisted, versioned limits for planning and read-only repository grounding. */
export const PlanningBudgetInputSchema = z.object({
  version: z.literal(1).optional(),
  maxPlanningDurationMs: z.number().int().positive().optional(),
  maxIndexDurationMs: z.number().int().positive().optional(),
  maxIndexedFiles: z.number().int().positive().optional(),
  maxIndexBytes: z.number().int().positive().optional(),
  maxIndexedFileBytes: z.number().int().positive().optional(),
  maxIndexedSymbols: z.number().int().positive().optional(),
  maxIndexedImports: z.number().int().positive().optional(),
  maxIndexedExports: z.number().int().positive().optional(),
  maxDecomposerCalls: z.number().int().positive().optional(),
  maxCriticCalls: z.number().int().positive().optional(),
  maxPlanningNodes: z.number().int().positive().optional(),
  maxPlanningDepth: z.number().int().positive().optional(),
  maxChildrenPerNode: z.number().int().positive().optional(),
  maxPromptBytes: z.number().int().positive().optional(),
  maxPlanningConcurrency: z.number().int().positive().optional(),
  maxOutputBytes: z.number().int().positive().optional()
}).strict();

export type PlanningBudgetInput = z.infer<typeof PlanningBudgetInputSchema>;

export const ExecutorSelectionSchema = z.object({
  executorId: z.enum(EXECUTOR_IDS),
  model: z.string().min(1)
});

export type ExecutorSelectionInput = z.infer<typeof ExecutorSelectionSchema>;

/**
 * Canonical per-stage selection (U2A-2): executor + model + the reasoning effort
 * that stage runs at. Superset of ExecutorSelectionSchema; `effort` is optional
 * and only meaningful for models that declare effort support.
 */
export const StageSelectionSchema = z.object({
  executorId: z.enum(EXECUTOR_IDS),
  model: z.string().min(1),
  effort: ReasoningEffortSchema.optional()
});

export type StageSelectionInput = z.infer<typeof StageSelectionSchema>;

/** Serializable record of the repo a run was provisioned against (artifact). */
export const ProvisionedRepoRecordSchema = z.object({
  repoRoot: z.string().min(1),
  // Optional only for loading runs persisted before isolated source metadata
  // existed. `provisionedFromRecord` normalizes those legacy records.
  sourceRepoRoot: z.string().min(1).optional(),
  sourceBranch: z.string().min(1).optional(),
  sourceBaseCommit: z.string().min(1).optional(),
  baseBranch: z.string().min(1),
  baseCommit: z.string().min(1),
  executionBaseCommit: z.string().min(1).optional(),
  provisionedAt: z.string().datetime()
});

export type ProvisionedRepoRecord = z.infer<typeof ProvisionedRepoRecordSchema>;

/**
 * Stable filesystem identity of the captured repository's git common dir.
 * Device + inode/file-id survives path spelling changes and detects a
 * different repository recreated at the same path.
 */
export const RunTargetPhysicalIdentitySchema = z.object({
  version: z.literal(1),
  device: z.string().regex(/^\d+$/u),
  file: z.string().regex(/^\d+$/u)
}).strict();

export type RunTargetPhysicalIdentity = z.infer<typeof RunTargetPhysicalIdentitySchema>;

/**
 * B-008 (CF-19): the run's target repository, captured ONCE at creation and
 * immutable afterwards. Planning, grounding, execution, integration, final
 * artifact and delivery read THIS — never the mutable workspace record.
 * `executionRepoPath`/`executionBaseCommit` are filled exactly once at
 * provision time.
 */
export const RunTargetContextSchema = z.object({
  sourceRealPath: z.string().min(1),
  gitCommonDir: z.string().min(1),
  /**
   * Optional only for loading pre-physical-identity RunRecords. Productive
   * capture writes it; verification fails closed when legacy evidence cannot
   * prove that the filesystem object is still the captured repository.
   */
  physicalIdentity: RunTargetPhysicalIdentitySchema.optional(),
  sourceBranch: z.string().min(1),
  sourceBaseCommit: z.string().min(1),
  remoteUrl: z.string().optional(),
  /** Identity of physical repo + base state. */
  fingerprint: z.string().min(1),
  capturedAt: z.string().datetime(),
  executionRepoPath: z.string().optional(),
  executionBaseCommit: z.string().optional()
});

export type RunTargetContext = z.infer<typeof RunTargetContextSchema>;

export const RUN_STATUS_VALUES = [
  "created",
  "generating",
  "paused",
  "needs_review",
  "approved",
  "running",
  "completed",
  // Terminal success reached with human-accepted leaf/integration failures
  // (P2b): final-apply still runs and the result is delivered, but the state is
  // kept distinct so the UI never claims a fully-clean run.
  "completed_with_accepted",
  "partial",
  "unverified",
  "needs_delivery",
  "failed_artifact",
  "failed_delivery",
  // Cancellation in progress (B-005): the lease is invalidated and the kill
  // was issued, but at least one process tree is not yet verified dead. Only
  // a kill report with allDead=true moves the run on to `interrupted`.
  "cancelling",
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

/**
 * How much the run runs unattended:
 * - supervised: human approves the plan and answers every gate/question.
 * - semi: plan is auto-approved; execution gates and blocking decisions still pause.
 * - autonomous: plan auto-approved AND gates/clarifying questions auto-resolve to
 *   their recommended/default option; only hard failures stop the run.
 */
export const AutonomySchema = z.enum(["supervised", "semi", "autonomous"]);
export type Autonomy = z.infer<typeof AutonomySchema>;

export const RunDecompositionMetadataSchema = z.object({
  provider: z.union([
    z.literal("anthropic"),
    z.literal("claude-code"),
    z.literal("codex-cli"),
    // "gemini"/"codex" retained so RunRecords persisted before the Claude Code
    // swap still load.
    z.literal("gemini"),
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

export const RunValidationSummarySchema = z.object({
  status: z.enum(["passed", "failed", "unverified"]),
  command: z.string().optional(),
  ranAt: z.string().datetime().optional()
});

export type RunValidationSummary = z.infer<typeof RunValidationSummarySchema>;

export const FinalArtifactManifestSchema = z.object({
  version: z.literal(1),
  manifestId: z.string().uuid(),
  runId: z.string().min(1),
  sourceTargetFingerprint: z.string().min(1),
  sourceBranch: z.string().min(1),
  sourceBaseSha: z.string().min(1),
  executionBaseSha: z.string().min(1),
  finalSha: z.string().min(1),
  finalRef: z.string().min(1).optional(),
  addedFiles: z.array(z.string().min(1)),
  modifiedFiles: z.array(z.string().min(1)),
  deletedFiles: z.array(z.string().min(1)),
  patch: z.string(),
  validationCommands: z.array(z.object({ command: z.string().min(1), args: z.array(z.string()) })),
  validationResults: z.array(z.object({ passed: z.boolean(), output: z.string(), exitCode: z.number().int() })),
  verificationDisposition: z.enum(["verified", "unverified", "failed"]),
  omittedTasks: z.array(z.string().min(1)),
  acceptedFailures: z.array(z.string().min(1)),
  acceptedConflicts: z.array(z.string().min(1)),
  repairEvidence: z.array(z.record(z.unknown())),
  artifactDisposition: z.enum(["ready", "partial", "failed"]),
  deliveryDisposition: z.enum(["needs_delivery", "delivered", "failed"]),
  createdAt: z.string().datetime()
});
export type FinalArtifactManifest = z.infer<typeof FinalArtifactManifestSchema>;

export const RunOperationKindSchema = z.enum([
  "planning",
  "execution",
  "replan",
  "delivery",
  "fork",
  "purge"
]);

export const RunOperationLeaseSchema = z.object({
  operationId: z.string().uuid(),
  kind: RunOperationKindSchema,
  fencingToken: z.number().int().positive(),
  acquiredAt: z.string().datetime(),
  heartbeatAt: z.string().datetime()
});

export type RunOperationKind = z.infer<typeof RunOperationKindSchema>;
export type RunOperationLease = z.infer<typeof RunOperationLeaseSchema>;

/**
 * Durable graph-storage contract. In this representation the planning graph is
 * the immutable decomposer output and `patches` is the only semantic edit log.
 *
 * The field is intentionally optional on RunRecord: records written before the
 * marker existed need compatibility inspection before patches may be replayed.
 */
export const IMMUTABLE_BASE_PATCH_LOG_STORAGE = {
  version: 1,
  mode: "immutable_base_patch_log"
} as const;

export const PlanGraphStorageSchema = z.object({
  version: z.literal(1),
  mode: z.literal("immutable_base_patch_log")
}).strict();

export type PlanGraphStorage = z.infer<typeof PlanGraphStorageSchema>;

export const RunArchitectureVersionSchema = z.object({
  planning: z.enum(["v1", "v2"]),
  execution: z.enum(["v1", "v2"]),
  integration: z.enum(["v1", "v2"])
}).strict();

export type RunArchitectureVersion = z.infer<typeof RunArchitectureVersionSchema>;

export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  architectureVersion: RunArchitectureVersionSchema.optional(),
  workspaceId: z.string().min(1),
  granularity: GranularityModeSchema,
  model: z.string().min(1),
  planningModel: z.string().min(1).optional(),
  planningExecutorId: z.enum(EXECUTOR_IDS).optional(),
  defaultExecutionSelection: ExecutorSelectionSchema.optional(),
  defaultRepairSelection: ExecutorSelectionSchema.optional(),
  /**
   * Canonical per-stage selections (U2A-2). Authoritative when present; the
   * legacy fields above are kept as a compatibility mirror (dual-write) so old
   * readers and persisted runs keep working. The resolver in executor-selection.ts
   * is the single authority that reconciles canonical ↔ legacy.
   */
  planningSelection: StageSelectionSchema.optional(),
  executionSelection: StageSelectionSchema.optional(),
  repairSelection: StageSelectionSchema.optional(),
  /** Unattendedness policy. Absent (old records) is treated as "supervised". */
  autonomy: AutonomySchema.optional(),
  userPrompt: z.string().max(RUN_USER_PROMPT_MAX_LENGTH),
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
  /** Monotonic fencing epoch for long-running background operations. */
  // Optional for records and typed fixtures created before operation fencing.
  // Every claimed operation persists the field before it can write.
  mutationFence: z.number().int().nonnegative().optional(),
  /** Current operation owner. A newer fencingToken invalidates every older writer. */
  activeOperation: RunOperationLeaseSchema.optional(),
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
  /** Semantic revision of the executable plan. Legacy records start at revision 1. */
  planRevision: z.number().int().positive().default(1),
  /** Revision covered by the current approval. */
  approvedPlanRevision: z.number().int().positive().optional(),
  planApprovalOverride: z.object({
    revision: z.number().int().positive(),
    actor: z.string().min(1),
    acknowledgedErrors: z.array(z.string().min(1)).min(1),
    at: z.string().datetime()
  }).optional(),
  startedAt: z.string().datetime().optional(),
  /** Absolute origin for executionConfig.maxWallClockMs; never reset by resume/restart. */
  executionStartedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  /** B-007: logical removal — hidden from the default list, metadata intact. */
  archivedAt: z.string().datetime().optional(),
  /** Updated by the runner every few seconds while planning or executing. */
  heartbeatAt: z.string().datetime().optional(),
  // Opaque payloads produced by the planning and execution pipelines. The full
  // nested shape is not re-validated here to keep apps/web decoupled from the
  // internal schemas of @manyhands/decomposer and @manyhands/execution-core.
  planning: z.unknown().optional(),
  /** Explicit storage semantics for `planning.decomposition.graph` + `patches`. */
  planGraphStorage: PlanGraphStorageSchema.optional(),
  execution: z.unknown().optional(),
  decomposition: RunDecompositionMetadataSchema.optional(),
  /** Target repo for real execution. */
  repoSpec: RepoSpecSchema.optional(),
  /** B-008: target repository captured at creation; immutable afterwards. */
  targetContext: RunTargetContextSchema.optional(),
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
  finalArtifactManifest: FinalArtifactManifestSchema.optional(),
  executionOutcome: z.enum(["succeeded", "partial", "failed"]).optional(),
  artifactOutcome: z.enum(["ready", "partial", "unverified", "failed"]).optional(),
  deliveryOutcome: z.enum(["needs_delivery", "delivered", "failed"]).optional(),
  baseCommit: z.string().min(1).optional(),
  integrationCommitSha: z.string().min(1).optional(),
  /** Optional per-run overrides; defaults applied from execution-core at runtime. */
  executionConfig: ExecutionConfigInputSchema.optional(),
  /** Effective values are persisted before any planning subprocess or index dispatch. */
  planningBudget: PlanningBudgetInputSchema.optional(),
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
      gate: z.union([
        z.literal("leaf_validation_failed"),
        z.literal("merge_conflict"),
        z.literal("budget_exceeded")
      ]),
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
      integrationStatus: z.string().optional(),
      /** Why the integration failed (merge_conflict | code_validation | infra | internal). */
      failureClass: z.string().optional(),
      /** Parent validation exit code when the failure came from validation. */
      validationExitCode: z.number().int().optional(),
      /** Budget gate (U5): reported spend at suspension time. */
      spentTokens: z.number().nonnegative().optional(),
      spentUsd: z.number().nonnegative().optional(),
      pendingTasks: z.array(z.string().min(1)).optional()
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
      questionAnswers: z.record(z.string()),
      /** The answer is durable; a restart may safely re-dispatch this replan. */
      resumeRequestedAt: z.string().datetime().optional()
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
  /** Run-level validation verdict, surfaced so `completed` never implies an unrun check. */
  validation: RunValidationSummarySchema.optional(),
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
  architectureVersion: z.object({ planning: z.enum(["v1", "v2"]) }).strict().optional(),
  granularity: GranularityModeSchema,
  model: z.string().min(1),
  planningModel: z.string().min(1).optional(),
  planningExecutorId: z.enum(EXECUTOR_IDS).optional(),
  defaultExecutionSelection: ExecutorSelectionSchema.optional(),
  defaultRepairSelection: ExecutorSelectionSchema.optional(),
  /** Canonical per-stage selections (U2A-2). Preferred over the legacy fields above. */
  planningSelection: StageSelectionSchema.optional(),
  executionSelection: StageSelectionSchema.optional(),
  repairSelection: StageSelectionSchema.optional(),
  executionConfig: RunCreateExecutionConfigInputSchema.optional(),
  autonomy: AutonomySchema.optional(),
  userPrompt: z.string().trim().max(RUN_USER_PROMPT_MAX_LENGTH).default(""),
  /** Target repo for real execution. */
  repoSpec: RepoSpecSchema.optional()
});

export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;
