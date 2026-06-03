import { ExecutionConfigSchema } from "@manyhands/execution-core";
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
  state: z.union([z.literal("pending"), z.literal("active"), z.literal("complete")]),
  decision: z.union([z.literal("atomic"), z.literal("decompose"), z.literal("question")]).optional(),
  childCount: z.number().int().nonnegative().optional(),
  childIds: z.array(z.string().min(1)).optional()
});

export type PlanningLiveNode = z.infer<typeof PlanningLiveNodeSchema>;

export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  granularity: GranularityModeSchema,
  model: z.string().min(1),
  userPrompt: z.string().max(4000),
  title: z.string().min(1).max(160),
  /** LLM-generated one-paragraph description. Falls back to userPrompt in the UI. */
  summary: z.string().max(400).optional(),
  status: RunStatusSchema,
  pausedDuring: z.union([z.literal("generating"), z.literal("running")]).optional(),
  /** Phase from which the run was interrupted (server restart, stale heartbeat). */
  interruptedDuring: z.union([z.literal("generating"), z.literal("running")]).optional(),
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
  finalCommitSha: z.string().min(1).optional(),
  appliedToRepoPath: z.string().min(1).optional(),
  appliedAt: z.string().datetime().optional(),
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
  /** Progressive recursive-planning nodes persisted while the final graph is still being generated. */
  livePlanningNodes: z.array(PlanningLiveNodeSchema).optional(),
  questionAnswers: z.record(z.string()).optional(),
  planningStepCache: z.record(z.any()).optional()
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
  userPrompt: z.string().trim().max(4000).default(""),
  /** Target repo for real execution. */
  repoSpec: RepoSpecSchema.optional()
});

export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;
