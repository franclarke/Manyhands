import { EXECUTOR_IDS, ExecutionConfigSchema, ReasoningEffortSchema } from "@manyhands/execution-core";
import { GRANULARITY_CONDITIONS, WorkBreakdownSchema } from "@manyhands/decomposer";
import { RunLifecycleSchema } from "@manyhands/run-coordinator";
import { z } from "zod";

import { RUN_USER_PROMPT_MAX_LENGTH } from "@/lib/run-limits";

export const RUN_FILE_VERSION = 2;

export const GranularityConditionSchema = z.enum(GRANULARITY_CONDITIONS);
const StoredGranularityConditionSchema = z.enum(["A", "B", "C", "C1", "C2"]);

export const ExperimentalPlanningCandidateSchema = z.object({
  sourceHash: z.string().min(1),
  repositorySnapshotId: z.string().min(1),
  goal: z.string().trim().min(1),
  acceptanceCriteria: z.array(z.string().trim().min(1)),
  breakdown: WorkBreakdownSchema
}).strict();

export const StageSelectionSchema = z.object({
  executorId: z.enum(EXECUTOR_IDS),
  model: z.string().min(1),
  effort: ReasoningEffortSchema.optional()
}).strict();

export type StageSelectionInput = z.infer<typeof StageSelectionSchema>;

export const RunTargetPhysicalIdentitySchema = z.object({
  version: z.literal(1),
  device: z.string().regex(/^\d+$/u),
  file: z.string().regex(/^\d+$/u)
}).strict();

export type RunTargetPhysicalIdentity = z.infer<typeof RunTargetPhysicalIdentitySchema>;

export const RunTargetContextSchema = z.object({
  sourceRealPath: z.string().min(1),
  gitCommonDir: z.string().min(1),
  physicalIdentity: RunTargetPhysicalIdentitySchema,
  sourceBranch: z.string().min(1),
  sourceBaseCommit: z.string().min(1),
  remoteUrl: z.string().optional(),
  fingerprint: z.string().min(1),
  capturedAt: z.string().datetime()
}).strict();

export type RunTargetContext = z.infer<typeof RunTargetContextSchema>;

export const RunOperationKindSchema = z.enum([
  "planning",
  "execution",
  "delivery",
  "control",
  "purge"
]);

export const RunOperationLeaseSchema = z.object({
  operationId: z.string().uuid(),
  kind: RunOperationKindSchema,
  fencingToken: z.number().int().positive(),
  acquiredAt: z.string().datetime(),
  heartbeatAt: z.string().datetime()
}).strict();

export type RunOperationKind = z.infer<typeof RunOperationKindSchema>;
export type RunOperationLease = z.infer<typeof RunOperationLeaseSchema>;

export const RunTakeoverReceiptSchema = z.object({
  processReceiptId: z.string().min(1),
  supersededOperationId: z.string().uuid(),
  supersededFencingToken: z.number().int().positive(),
  operationId: z.string().uuid(),
  fencingToken: z.number().int().positive(),
  allDead: z.literal(true),
  repositoryQuiescent: z.literal(true).optional(),
  processCount: z.number().int().nonnegative(),
  verifiedAt: z.string().datetime()
}).strict();

export type RunTakeoverReceipt = z.infer<typeof RunTakeoverReceiptSchema>;

/** Disposable materialized cursor. The V2 journal remains the authority. */
export const RunProjectionCacheSchema = z.object({
  eventSequence: z.number().int().nonnegative(),
  lifecycle: RunLifecycleSchema,
  graphId: z.string().min(1).optional(),
  graphRevision: z.number().int().positive().optional(),
  approvedGraphRevision: z.number().int().positive().optional(),
  repositorySnapshotId: z.string().min(1).optional(),
  finalManifestId: z.string().min(1).optional(),
  finalCommit: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  updatedAt: z.string().datetime()
}).strict();

export type RunProjectionCache = z.infer<typeof RunProjectionCacheSchema>;

export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  userPrompt: z.string().trim().min(1).max(RUN_USER_PROMPT_MAX_LENGTH),
  title: z.string().min(1).max(160),
  planningSelection: StageSelectionSchema,
  executionSelection: StageSelectionSchema,
  repairSelection: StageSelectionSchema,
  executionConfig: ExecutionConfigSchema,
  /**
   * Granularity condition for the comparative study. Absent means the
   * productive adaptive policy; a run that names one is self-describing about
   * the policy that shaped its plan.
   */
  granularityCondition: StoredGranularityConditionSchema.optional(),
  experimentalCandidate: ExperimentalPlanningCandidateSchema.optional(),
  targetContext: RunTargetContextSchema,
  projection: RunProjectionCacheSchema,
  version: z.number().int().nonnegative().default(0),
  mutationFence: z.number().int().nonnegative().optional(),
  activeOperation: RunOperationLeaseSchema.optional(),
  lastTakeoverReceipt: RunTakeoverReceiptSchema.optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().optional(),
  heartbeatAt: z.string().datetime().optional()
}).strict();

export type RunRecord = z.infer<typeof RunRecordSchema>;
export type RunStatus = z.infer<typeof RunLifecycleSchema>;
export const RUN_STATUS_VALUES = RunLifecycleSchema.options;

export const RunFileSchema = z.object({
  version: z.literal(RUN_FILE_VERSION),
  run: RunRecordSchema
}).strict();

export type RunFile = z.infer<typeof RunFileSchema>;

export const RunCreateRequestSchema = z.object({
  workspaceId: z.string().min(1),
  userPrompt: z.string().trim().min(1).max(RUN_USER_PROMPT_MAX_LENGTH),
  planningSelection: StageSelectionSchema.optional(),
  executionSelection: StageSelectionSchema.optional(),
  repairSelection: StageSelectionSchema.optional(),
  granularityCondition: GranularityConditionSchema.optional(),
  experimentalCandidate: ExperimentalPlanningCandidateSchema.optional(),
  executionConfig: ExecutionConfigSchema.partial().omit({ routing: true }).strict().optional()
}).strict();

export type RunCreateRequest = z.infer<typeof RunCreateRequestSchema>;
