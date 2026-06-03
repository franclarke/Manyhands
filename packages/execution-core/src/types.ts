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
  violations: z.array(NonEmptyStringSchema).default([])
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
  tokensIn: z.number().int().nonnegative().optional(),
  tokensOut: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional()
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

export const IntegrationResultSchema = z.object({
  compositeTaskId: EntityIdSchema,
  status: IntegrationStatusSchema,
  childResults: z.array(AgentExecutionResultSchema),
  integrationCommitSha: NonEmptyStringSchema.optional(),
  conflictDetails: ConflictDetailSchema.optional(),
  repairAttempted: z.boolean(),
  repairResult: AgentExecutionResultSchema.optional()
});

export type IntegrationResult = z.infer<typeof IntegrationResultSchema>;

// ── Agent executor options ──────────────────────────────────────

// Retained from the Codex era for interface symmetry. With the Gemini CLI there
// is no `workspace-write`/`danger-full-access` OS sandbox; the executor maps this
// to Gemini's approval mode and the real confinement comes from the isolated git
// worktree plus the ScopeChecker (see GeminiCliExecutor / ADR on the swap).
export const SandboxModeSchema = z.union([
  z.literal("workspace-write"),
  z.literal("danger-full-access")
]);

export type SandboxMode = z.infer<typeof SandboxModeSchema>;

export const AgentExecutorOptionsSchema = z.object({
  cwd: NonEmptyStringSchema,
  instructionFilePath: NonEmptyStringSchema,
  model: NonEmptyStringSchema,
  timeoutMs: z.number().int().positive(),
  sandboxMode: SandboxModeSchema,
  bypassApprovals: z.boolean(),
  env: z.record(z.string()).optional()
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
  sandboxMode: SandboxModeSchema.default("workspace-write"),
  unexpectedCommitPolicy: UnexpectedCommitPolicySchema.default("reject")
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
