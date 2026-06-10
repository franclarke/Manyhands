import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";

// ── Agent result status ─────────────────────────────────────────

export const AgentResultStatusSchema = z.union([
  z.literal("success"),
  z.literal("empty_diff"),
  z.literal("scope_violation"),
  z.literal("validation_failed"),
  z.literal("executor_error"),
  z.literal("timeout"),
  z.literal("agent_committed_unexpectedly"),
  z.literal("internal_error")
]);

export type AgentResultStatus = z.infer<typeof AgentResultStatusSchema>;

// ── Worktree tracking ───────────────────────────────────────────

export const WorktreeKindSchema = z.union([
  z.literal("leaf"),
  z.literal("integration")
]);

export type WorktreeKind = z.infer<typeof WorktreeKindSchema>;

export const WorktreeStatusSchema = z.union([
  z.literal("pending"),
  z.literal("active"),
  z.literal("committed"),
  z.literal("cleaned"),
  z.literal("error")
]);

export type WorktreeStatus = z.infer<typeof WorktreeStatusSchema>;

export const WorktreeRecordSchema = z.object({
  taskId: EntityIdSchema,
  runId: EntityIdSchema,
  kind: WorktreeKindSchema,
  path: NonEmptyStringSchema,
  branch: NonEmptyStringSchema,
  baseCommit: NonEmptyStringSchema,
  status: WorktreeStatusSchema,
  createdAt: IsoTimestampSchema,
  cleanedAt: IsoTimestampSchema.optional()
});

export type WorktreeRecord = z.infer<typeof WorktreeRecordSchema>;

// ── Scope & validation results ──────────────────────────────────

export const ScopeCheckResultSchema = z.object({
  passed: z.boolean(),
  // Hard violations: files matching a forbidden glob. These are terminal — they
  // fail the leaf/repair (deny wins, ADR-0023).
  violations: z.array(NonEmptyStringSchema).default([]),
  // Advisory: files outside the allow-list but not forbidden. The allow-list is
  // an LLM-guessed hint for a layout that may not exist yet, so an out-of-scope
  // file is recorded for visibility but does NOT fail the run. Real collisions
  // surface at cherry-pick, where the composer repairs.
  outOfScope: z.array(NonEmptyStringSchema).default([])
});

export type ScopeCheckResult = z.infer<typeof ScopeCheckResultSchema>;

export const ValidationRunResultSchema = z.object({
  passed: z.boolean(),
  output: z.string(),
  exitCode: z.number().int()
});

export type ValidationRunResult = z.infer<typeof ValidationRunResultSchema>;

// ── Agent execution result ──────────────────────────────────────

export const AgentExecutionResultSchema = z.object({
  taskId: EntityIdSchema,
  status: AgentResultStatusSchema,
  baseHead: NonEmptyStringSchema,
  currentHead: NonEmptyStringSchema,
  agentCommittedUnexpectedly: z.boolean(),
  diff: z.string(),
  changedFiles: z.array(NonEmptyStringSchema).default([]),
  commitSha: NonEmptyStringSchema.optional(),
  scopeCheck: ScopeCheckResultSchema,
  validationResult: ValidationRunResultSchema.optional(),
  executorExitCode: z.number().int(),
  executorDurationMs: z.number().int().nonnegative(),
  executorTimedOut: z.boolean(),
  // Truncated tails of the executor's stdout/stderr, kept as the actionable cause
  // when a run fails (e.g. Gemini quota/auth errors). git diff is still the source
  // of truth for what changed (D5); these are diagnostics surfaced to the UI.
  stderrTail: z.string().optional(),
  stdoutTail: z.string().optional(),
  /** Provider-agnostic classification of an executor failure (timeout/auth/quota/...). */
  failureKind: z
    .union([
      z.literal("timeout"),
      z.literal("aborted"),
      z.literal("binary_missing"),
      z.literal("auth"),
      z.literal("quota"),
      z.literal("model_not_found"),
      z.literal("unknown")
    ])
    .optional(),
  /** Actionable hint matching failureKind, surfaced in traces and the UI. */
  failureHint: z.string().optional(),
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
  usageSource: z.union([
    z.literal("reported"),
    z.literal("estimated"),
    z.literal("unavailable")
  ]).optional()
});

export type AgentExecutionResult = z.infer<typeof AgentExecutionResultSchema>;

// ── Integration ─────────────────────────────────────────────────

export const IntegrationStatusSchema = z.union([
  z.literal("success"),
  z.literal("cherry_pick_conflict"),
  z.literal("executor_repair_success"),
  z.literal("executor_repair_failed"),
  z.literal("validation_failed"),
  z.literal("child_failed"),
  z.literal("internal_error")
]);

export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

export const ConflictDetailSchema = z.object({
  files: z.array(NonEmptyStringSchema),
  cherryPickOutput: z.string()
});

export type ConflictDetail = z.infer<typeof ConflictDetailSchema>;

/**
 * Deterministic compatibility signal computed before cherry-pick. Surfaces
 * likely textual conflicts and unfulfilled seams so the single repair attempt
 * is spent with a precise diagnosis instead of guessing from the diff text.
 */
export const PreMergeFindingSchema = z.object({
  severity: z.union([z.literal("warning"), z.literal("info")]),
  code: z.string(),
  message: z.string(),
  files: z.array(z.string()).default([])
});

export type PreMergeFinding = z.infer<typeof PreMergeFindingSchema>;

export const IntegrationResultSchema = z.object({
  compositeTaskId: EntityIdSchema,
  status: IntegrationStatusSchema,
  childResults: z.array(AgentExecutionResultSchema),
  integrationCommitSha: NonEmptyStringSchema.optional(),
  conflictDetails: ConflictDetailSchema.optional(),
  repairAttempted: z.boolean(),
  repairResult: AgentExecutionResultSchema.optional(),
  /** Deterministic pre-merge compatibility findings (Fase 3.1). */
  preMergeFindings: z.array(PreMergeFindingSchema).default([]),
  /** Parent validation outcome, persisted for diagnostics/UI (Fase 3.3). */
  parentValidation: ValidationRunResultSchema.optional()
});

export type IntegrationResult = z.infer<typeof IntegrationResultSchema>;

// ── Agent executor options ──────────────────────────────────────



export const ExecutorOutputStreamSchema = z.union([
  z.literal("stdout"),
  z.literal("stderr")
]);

export type ExecutorOutputStream = z.infer<typeof ExecutorOutputStreamSchema>;

export const ExecutorOutputChunkSchema = z.object({
  stream: ExecutorOutputStreamSchema,
  chunk: z.string()
});

export type ExecutorOutputChunk = z.infer<typeof ExecutorOutputChunkSchema>;

export const AgentExecutorOptionsSchema = z.object({
  cwd: NonEmptyStringSchema,
  instructionFilePath: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  timeoutMs: z.number().int().positive(),
  bypassApprovals: z.boolean(),
  env: z.record(z.string()).optional(),
  /** Run-level cancellation: aborts the spawned process tree. Not serialized. */
  signal: z.instanceof(AbortSignal).optional(),
  /** Live stdout/stderr diagnostics from the executor process. Not serialized. */
  onOutput: z.custom<(chunk: ExecutorOutputChunk) => void>((value) => typeof value === "function").optional(),
  /**
   * Send-to-user channel: structured progress reports the agent emits over the
   * MH_STATUS stdout protocol while it works. Not serialized.
   */
  onAgentStatus: z
    .custom<(status: import("./executor/status-channel").AgentStatusUpdate) => void>(
      (value) => typeof value === "function"
    )
    .optional()
});

export type AgentExecutorOptions = z.infer<typeof AgentExecutorOptionsSchema>;

// ── Execution config ────────────────────────────────────────────

export const UnexpectedCommitPolicySchema = z.union([
  z.literal("reject"),
  z.literal("accept")
]);

export type UnexpectedCommitPolicy = z.infer<typeof UnexpectedCommitPolicySchema>;

export const ExecutionConfigSchema = z.object({
  maxParallel: z.number().int().positive().default(6),
  leafTimeoutMs: z.number().int().positive().default(300_000),
  integrationTimeoutMs: z.number().int().positive().default(600_000),
  unexpectedCommitPolicy: UnexpectedCommitPolicySchema.default("reject"),
  /**
   * Executor selection mode: "complexity" routes each node to an executor tier
   * by its complexity score (degrading to whatever CLIs are installed);
   * "fixed" always uses the run-level selection.
   */
  routing: z.union([z.literal("complexity"), z.literal("fixed")]).default("complexity"),
  /** Optional wall-clock ceiling for the whole run; the orchestrator interrupts past it. */
  maxWallClockMs: z.number().int().positive().optional()
});

export type ExecutionConfig = z.infer<typeof ExecutionConfigSchema>;

// ── Granularity vector (experiment metrics) ─────────────────────

export const GranularityVectorSchema = z.object({
  // Pre-execution (DAG structure)
  depth: z.number().int().nonnegative(),
  leafCount: z.number().int().nonnegative(),
  compositeCount: z.number().int().nonnegative(),
  avgLeafDepth: z.number().nonnegative(),
  maxLeafDepth: z.number().int().nonnegative(),
  dependencyCount: z.number().int().nonnegative(),
  avgAcceptanceCriteriaPerLeaf: z.number().nonnegative(),
  estimatedTokensPerLeaf: z.number().int().nonnegative().optional(),

  // Post-execution (results)
  integrationSuccessRate: z.number().min(0).max(1),
  leafSuccessRate: z.number().min(0).max(1),
  conflictRate: z.number().min(0).max(1),
  totalDurationMs: z.number().int().nonnegative(),
  totalCostUsd: z.number().nonnegative().optional(),
  testsPassedRate: z.number().min(0).max(1).optional(),
  linesChanged: z.number().int().nonnegative(),
  unexpectedCommitCount: z.number().int().nonnegative(),
  scopeViolationCount: z.number().int().nonnegative()
});

export type GranularityVector = z.infer<typeof GranularityVectorSchema>;
