import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema, ReasoningEffortSchema } from "@manyhands/shared";
import { z } from "zod";
import type { AgentStatusUpdate } from "./executor/status-channel";

// ── Agent result status ─────────────────────────────────────────

export const AgentResultStatusSchema = z.union([
  z.literal("success"),
  z.literal("empty_diff"),
  z.literal("scope_violation"),
  z.literal("scope_gated"),
  z.literal("validation_failed"),
  z.literal("executor_error"),
  z.literal("timeout"),
  z.literal("agent_committed_unexpectedly"),
  z.literal("internal_error")
]);

export type AgentResultStatus = z.infer<typeof AgentResultStatusSchema>;

export const AgentResultDispositionSchema = z.enum(["changed", "already_satisfied", "failed", "gated"]);
export type AgentResultDisposition = z.infer<typeof AgentResultDispositionSchema>;

export const ScopePolicySchema = z.enum(["advisory", "gate", "strict"]);
export type ScopePolicy = z.infer<typeof ScopePolicySchema>;

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
  /** Durable B-015 identity for this physical node execution. */
  attemptId: z.string().uuid().optional(),
  status: AgentResultStatusSchema,
  baseHead: NonEmptyStringSchema,
  currentHead: NonEmptyStringSchema,
  agentCommittedUnexpectedly: z.boolean(),
  diff: z.string(),
  changedFiles: z.array(NonEmptyStringSchema).default([]),
  commitSha: NonEmptyStringSchema.optional(),
  /** Explicit only for orchestrator-created composite handoff merge commits. */
  cherryPickMainline: z.literal(1).optional(),
  /**
   * True when the leaf exited cleanly with an empty diff because the grounding
   * baseline already satisfied its contract (e.g. a barrel/re-export the skeleton
   * scaffolder produced in full). Such a leaf is a no-op success: nothing to
   * commit and nothing for integration to cherry-pick. Distinguished from a plain
   * empty-diff failure where the agent did no real work (status `empty_diff`).
   */
  noOp: z.boolean().optional(),
  disposition: AgentResultDispositionSchema.optional(),
  baselineEvidence: z.object({
    expectedPaths: z.array(NonEmptyStringSchema),
    verifiedPaths: z.array(NonEmptyStringSchema),
    validation: ValidationRunResultSchema.optional()
  }).optional(),
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
  tokensTotal: z.number().int().nonnegative().optional(),
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
  z.literal("internal_error"),
  // Transient tombstone: only ever lives inside a conflict-gate Command
  // update; the state reducer consumes it by DELETING the entry so the
  // composite re-enters the integration frontier. Never persisted.
  z.literal("retry_pending")
]);

export type IntegrationStatus = z.infer<typeof IntegrationStatusSchema>;

/**
 * Why an integration failure happened, derived from the result — drives gate
 * copy and option ordering. "infra" means the environment broke (validation
 * command's binary missing/rejected/timed out), NOT the merged code: exit 127
 * (spawn/binary not found), 126 (command rejected as unsafe), 124 (timeout).
 */
export type IntegrationFailureClass = "merge_conflict" | "code_validation" | "infra" | "internal";

const INFRA_VALIDATION_EXIT_CODES = new Set([124, 126, 127]);

export function classifyIntegrationFailure(result: {
  status: IntegrationStatus;
  parentValidation?: { exitCode: number } | undefined;
}): IntegrationFailureClass {
  switch (result.status) {
    case "cherry_pick_conflict":
    case "executor_repair_failed":
      return "merge_conflict";
    case "validation_failed":
      return result.parentValidation !== undefined &&
        INFRA_VALIDATION_EXIT_CODES.has(result.parentValidation.exitCode)
        ? "infra"
        : "code_validation";
    default:
      return "internal";
  }
}

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

export const IntegrationFailureCodeSchema = z.union([
  z.literal("child_failed"),
  z.literal("missing_child_commit"),
  z.literal("invalid_child_commit"),
  z.literal("cherry_pick_conflict"),
  z.literal("repair_failed"),
  z.literal("validation_failed"),
  z.literal("internal_error")
]);

export type IntegrationFailureCode = z.infer<typeof IntegrationFailureCodeSchema>;

export const AppliedChildCommitSchema = z.object({
  childTaskId: EntityIdSchema,
  /** Commit supplied by the child branch. */
  commitSha: NonEmptyStringSchema,
  /** Physical commit created/adopted on the parent integration lineage. */
  resultSha: NonEmptyStringSchema.optional(),
  preSha: NonEmptyStringSchema.optional(),
  application: z.enum(["already_ancestor", "already_satisfied", "cherry_picked", "manifest_materialized", "repaired"]).optional(),
  order: z.number().int().nonnegative()
});

export type AppliedChildCommit = z.infer<typeof AppliedChildCommitSchema>;

export const OmittedChildCommitSchema = z.object({
  childTaskId: EntityIdSchema,
  reason: IntegrationFailureCodeSchema,
  status: AgentResultStatusSchema.optional(),
  commitSha: NonEmptyStringSchema.optional()
});

export type OmittedChildCommit = z.infer<typeof OmittedChildCommitSchema>;

export const IntegrationRepairAttemptSchema = z.object({
  childTaskId: EntityIdSchema,
  pass: z.number().int().positive(),
  status: z.union([z.literal("started"), z.literal("syntax_rejected"), z.literal("committed"), z.literal("failed")]),
  files: z.array(NonEmptyStringSchema).default([])
});

export type IntegrationRepairAttempt = z.infer<typeof IntegrationRepairAttemptSchema>;

export const IntegrationResultSchema = z.object({
  compositeTaskId: EntityIdSchema,
  /** Durable B-015 identity for this integration attempt. */
  attemptId: z.string().uuid().optional(),
  status: IntegrationStatusSchema,
  childResults: z.array(AgentExecutionResultSchema),
  integrationCommitSha: NonEmptyStringSchema.optional(),
  /** Mainline required to consume an orchestrator-created handoff merge. */
  cherryPickMainline: z.literal(1).optional(),
  conflictDetails: ConflictDetailSchema.optional(),
  repairAttempted: z.boolean(),
  repairResult: AgentExecutionResultSchema.optional(),
  /** Deterministic pre-merge compatibility findings (Fase 3.1). */
  preMergeFindings: z.array(PreMergeFindingSchema).default([]),
  /** Parent validation outcome, persisted for diagnostics/UI (Fase 3.3). */
  parentValidation: ValidationRunResultSchema.optional(),
  /** Stable machine-readable failure reason; status stays backward-compatible. */
  failureCode: IntegrationFailureCodeSchema.optional(),
  /** Child commits cherry-picked or repaired into the integration worktree, in order. */
  appliedCommits: z.array(AppliedChildCommitSchema).optional(),
  /** Child commits intentionally not applied because integration failed before them. */
  omittedChildCommits: z.array(OmittedChildCommitSchema).optional(),
  /** Worktree where parent validation ran; proves validation used the integration tree. */
  validationWorktreePath: NonEmptyStringSchema.optional(),
  /** Compact record of repair passes for replay/debugging. */
  repairAttempts: z.array(IntegrationRepairAttemptSchema).optional()
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
  /** A complete sandbox/broker environment replaces the legacy host allowlist. */
  isolatedEnvironment: z.boolean().optional(),
  /** Explicit Codex native Windows implementation for a brokered workspace attempt. */
  windowsSandbox: z.enum(["elevated", "unelevated"]).optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  /** Run-level cancellation: aborts the spawned process tree. Not serialized. */
  signal: z.instanceof(AbortSignal).optional(),
  /**
   * Owner key (the runId) under which the live subprocess is registered, so
   * cancellation can force-kill and verify everything still running (INV-2).
   */
  processOwnerId: z.string().min(1).optional(),
  /** Durable task-attempt identity attached to ProcessSupervisor metadata. */
  attemptId: z.string().uuid().optional(),
  /** Live stdout/stderr diagnostics from the executor process. Not serialized. */
  onOutput: z.custom<(chunk: ExecutorOutputChunk) => void>((value) => typeof value === "function").optional(),
  /**
   * Send-to-user channel: structured progress reports the agent emits over the
   * MH_STATUS stdout protocol while it works. Not serialized.
   */
  onAgentStatus: z
    .custom<(status: AgentStatusUpdate) => void>(
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
  scopePolicy: ScopePolicySchema.default("strict"),
  leafTimeoutMs: z.number().int().positive().default(600_000),
  integrationTimeoutMs: z.number().int().positive().default(600_000),
  /** Maximum diagnostic bytes retained per supervised subprocess stream. */
  maxOutputBytes: z.number().int().positive().default(65_536),
  /** Upper bound for declared validation commands at each validation boundary. */
  maxValidationCommands: z.number().int().positive().default(20),
  /** Dependency-install deadline, kept explicit alongside executor/validation timeouts. */
  installTimeoutMs: z.number().int().positive().default(300_000),
  /** Maximum planner calls for a run; comparative cells set this to one. */
  maxPlanningAttempts: z.number().int().positive().optional(),
  reasoningEffort: ReasoningEffortSchema.optional(),
  unexpectedCommitPolicy: UnexpectedCommitPolicySchema.default("reject"),
  /**
   * Executor selection mode: "complexity" routes each node to an executor tier
   * by its complexity score (degrading to whatever CLIs are installed);
   * "fixed" always uses the run-level selection.
   */
  routing: z.union([z.literal("complexity"), z.literal("fixed")]).default("fixed"),
  /**
   * Token budget for the whole run (reported usage across leaves + repairs).
   * Checked BETWEEN waves: exceeding it suspends on the budget gate (U5).
   */
  maxTokensTotal: z.number().int().positive().optional(),
  /** Cost budget in USD; same between-waves semantics as maxTokensTotal. */
  maxCostUsd: z.number().positive().optional(),
  /** Optional per-run cap for automatic recovery retries; absent preserves class-specific policy defaults. */
  automaticRetryBudget: z.number().int().nonnegative().optional(),
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
