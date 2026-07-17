import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { StaticConflictSignalsSchema, TaskPairRiskMatrixSchema } from "@manyhands/conflict-risk";
import { AgentRunResultSchema, AgentTaskContractSchema } from "@manyhands/contracts";
import { DecompositionModeSchema, FeatureRequestSchema } from "@manyhands/decomposer";
import { RepositoryIndexSummarySchema } from "@manyhands/repository-index";
import { BlockedTaskSchema, ExecutionBatchSchema } from "@manyhands/scheduler";
import { EntityIdSchema, IsoTimestampSchema, nowIso } from "@manyhands/shared";
import { TaskGraphSchema } from "@manyhands/task-graph";
import {
  InMemoryTraceStore,
  TraceEventSchema,
  type TraceEvent,
  type TraceEventInput,
  type TraceEventType,
  type TraceStore
} from "@manyhands/trace-store";
import { z } from "zod";


export const RUN_SNAPSHOT_SCHEMA_VERSION = "manyhands.run-snapshot.v1";
export const DEFAULT_RUN_STORE_DIRECTORY = ".manyhands/runs";

/**
 * Per-leaf scope-validation outcome. Inlined here (previously sourced from
 * @manyhands/scope-validation, now removed) so the snapshot schema can still
 * round-trip legacy Lab-mode runs that included these entries. New runs use
 * `ScopeCheckResult` from @manyhands/execution-core instead.
 */
export const ScopeValidationResultSchema = z.object({
  taskId: EntityIdSchema,
  passed: z.boolean(),
  violations: z.array(z.string()).default([])
});

export type ScopeValidationResult = z.infer<typeof ScopeValidationResultSchema>;

export const RunStatusSchema = z.union([
  z.literal("planned"),
  z.literal("executed"),
  z.literal("failed")
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunSnapshotMetadataSchema = z.object({
  schemaVersion: z.literal(RUN_SNAPSHOT_SCHEMA_VERSION),
  createdAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema.optional(),
  deterministic: z.boolean(),
  sourceFixture: z.string().min(1).optional(),
  datasetVersion: z.string().min(1).optional(),
  packageVersion: z.string().min(1).optional(),
  inputHash: z.string().min(1).optional(),
  outputHash: z.string().min(1).optional()
});

export type RunSnapshotMetadata = z.infer<typeof RunSnapshotMetadataSchema>;

export const RunSnapshotSchema = z.object({
  runId: EntityIdSchema,
  featureId: EntityIdSchema,
  status: RunStatusSchema,
  decompositionMode: DecompositionModeSchema,
  featureRequest: FeatureRequestSchema,
  graphSnapshot: TaskGraphSchema,
  contracts: z.array(AgentTaskContractSchema),
  riskPredictions: TaskPairRiskMatrixSchema,
  staticConflictSignals: StaticConflictSignalsSchema.default([]),
  repositoryIndexSummary: RepositoryIndexSummarySchema.optional(),
  repositoryIndexHash: z.string().min(1).optional(),
  scheduledBatches: z.array(ExecutionBatchSchema),
  blockedTasks: z.array(BlockedTaskSchema).default([]),
  agentRunResults: z.array(AgentRunResultSchema).default([]),
  scopeValidationResults: z.array(ScopeValidationResultSchema).default([]),
  traceEvents: z.array(TraceEventSchema),
  summary: z.unknown(),
  metadata: RunSnapshotMetadataSchema
});

export type RunSnapshot = z.infer<typeof RunSnapshotSchema>;

export const RunQueryFilterSchema = z.object({
  featureId: EntityIdSchema.optional(),
  status: RunStatusSchema.optional(),
  decompositionMode: DecompositionModeSchema.optional()
});

export type RunQueryFilter = z.infer<typeof RunQueryFilterSchema>;

export const RunListItemSchema = z.object({
  runId: EntityIdSchema,
  featureId: EntityIdSchema,
  status: RunStatusSchema,
  decompositionMode: DecompositionModeSchema,
  createdAt: IsoTimestampSchema,
  completedAt: IsoTimestampSchema.optional(),
  inputHash: z.string().min(1).optional(),
  outputHash: z.string().min(1).optional()
});

export type RunListItem = z.infer<typeof RunListItemSchema>;

export interface PersistentTraceStore extends TraceStore {
  saveRunSnapshot(snapshot: RunSnapshot): Promise<void>;
  getRunSnapshot(runId: string): Promise<RunSnapshot | null>;
  listRunSnapshots(filter?: RunQueryFilter): Promise<RunListItem[]>;
  exportRun(runId: string): Promise<RunSnapshot>;
  importRun(snapshot: RunSnapshot): Promise<void>;
}

export interface JsonRunStoreOptions {
  directory?: string;
  traceStore?: TraceStore;
}

export class JsonRunStore implements PersistentTraceStore {
  private readonly directory: string;
  private readonly traceStore: TraceStore;

  constructor(options: JsonRunStoreOptions = {}) {
    this.directory = path.resolve(options.directory ?? DEFAULT_RUN_STORE_DIRECTORY);
    this.traceStore = options.traceStore ?? new InMemoryTraceStore();
  }

  append(event: TraceEventInput): TraceEvent {
    return this.traceStore.append(event);
  }

  list(): TraceEvent[] {
    return this.traceStore.list();
  }

  findByType(type: TraceEventType): TraceEvent[] {
    return this.traceStore.findByType(type);
  }

  findByTask(taskId: string): TraceEvent[] {
    return this.traceStore.findByTask(taskId);
  }

  clear(): void {
    this.traceStore.clear();
  }

  async saveRunSnapshot(snapshot: RunSnapshot): Promise<void> {
    const parsed = withRunSnapshotHashes(snapshot);
    await mkdir(this.directory, { recursive: true });
    await writeRunSnapshotFile(parsed, this.filePathForRun(parsed.runId));
  }

  async getRunSnapshot(runId: string): Promise<RunSnapshot | null> {
    try {
      return await readRunSnapshotFile(this.filePathForRun(runId));
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  async listRunSnapshots(filter: RunQueryFilter = {}): Promise<RunListItem[]> {
    const parsedFilter = RunQueryFilterSchema.parse(filter);
    const files = await this.listRunFiles();
    const snapshots = await Promise.all(files.map((file) => readRunSnapshotFile(path.join(this.directory, file))));

    return snapshots
      .filter((snapshot) => matchesFilter(snapshot, parsedFilter))
      .map(runListItemFromSnapshot)
      .sort((left, right) => left.runId.localeCompare(right.runId));
  }

  async exportRun(runId: string): Promise<RunSnapshot> {
    const snapshot = await this.getRunSnapshot(runId);

    if (!snapshot) {
      throw new Error(`Run snapshot not found: ${runId}`);
    }

    return snapshot;
  }

  async importRun(snapshot: RunSnapshot): Promise<void> {
    await this.saveRunSnapshot(snapshot);
  }

  filePathForRun(runId: string): string {
    return path.join(this.directory, safeRunFileName(runId));
  }

  private async listRunFiles(): Promise<string[]> {
    try {
      return (await readdir(this.directory)).filter((file) => file.endsWith(".json"));
    } catch (error) {
      if (isNotFoundError(error)) {
        return [];
      }

      throw error;
    }
  }
}

export async function readRunSnapshotFile(filePath: string): Promise<RunSnapshot> {
  const raw = await readFile(filePath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return RunSnapshotSchema.parse(parsed);
}

export async function writeRunSnapshotFile(snapshot: RunSnapshot, filePath: string): Promise<void> {
  const parsed = withRunSnapshotHashes(snapshot);
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(path.resolve(filePath), `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

export function parseRunSnapshot(input: unknown): RunSnapshot {
  return RunSnapshotSchema.parse(input);
}

export function safeRunFileName(runId: string): string {
  const safeName = runId.replace(/[^A-Za-z0-9._-]/gu, "_");
  return `${safeName}.json`;
}

export function computeInputHash(input: {
  featureRequest: RunSnapshot["featureRequest"];
  decompositionMode: RunSnapshot["decompositionMode"];
}): string {
  return computeStableHash(input);
}

export function computeRunSnapshotOutputHash(snapshot: RunSnapshot): string {
  return computeStableHash(normalizeSnapshotForOutputHash(snapshot));
}

export function withRunSnapshotHashes(snapshot: RunSnapshot): RunSnapshot {
  const parsed = RunSnapshotSchema.parse(snapshot);
  const metadata = {
    ...parsed.metadata,
    inputHash: parsed.metadata.inputHash ?? computeInputHash({
      featureRequest: parsed.featureRequest,
      decompositionMode: parsed.decompositionMode
    })
  };
  const withInputHash = RunSnapshotSchema.parse({
    ...parsed,
    metadata
  });
  const outputHash = computeRunSnapshotOutputHash(withInputHash);

  return RunSnapshotSchema.parse({
    ...withInputHash,
    metadata: {
      ...withInputHash.metadata,
      outputHash
    }
  });
}

export function computeStableHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, canonicalize(entryValue)])
    );
  }

  return value;
}

function normalizeSnapshotForOutputHash(snapshot: RunSnapshot): unknown {
  const normalized = canonicalize(snapshot) as Record<string, unknown>;
  const metadata = { ...(normalized.metadata as Record<string, unknown>) };

  delete metadata.createdAt;
  delete metadata.completedAt;
  delete metadata.outputHash;
  normalized.metadata = metadata;
  normalized.traceEvents = (snapshot.traceEvents as TraceEvent[]).map((event) => {
    const rest: Record<string, unknown> = { ...event };
    delete rest.timestamp;
    return canonicalize(rest);
  });

  return normalized;
}

function runListItemFromSnapshot(snapshot: RunSnapshot): RunListItem {
  const item: RunListItem = {
    runId: snapshot.runId,
    featureId: snapshot.featureId,
    status: snapshot.status,
    decompositionMode: snapshot.decompositionMode,
    createdAt: snapshot.metadata.createdAt
  };

  if (snapshot.metadata.completedAt !== undefined) {
    item.completedAt = snapshot.metadata.completedAt;
  }

  if (snapshot.metadata.inputHash !== undefined) {
    item.inputHash = snapshot.metadata.inputHash;
  }

  if (snapshot.metadata.outputHash !== undefined) {
    item.outputHash = snapshot.metadata.outputHash;
  }

  return RunListItemSchema.parse(item);
}

function matchesFilter(snapshot: RunSnapshot, filter: RunQueryFilter): boolean {
  return (
    (filter.featureId === undefined || snapshot.featureId === filter.featureId) &&
    (filter.status === undefined || snapshot.status === filter.status) &&
    (filter.decompositionMode === undefined || snapshot.decompositionMode === filter.decompositionMode)
  );
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export function makeRunSnapshotMetadata(input: {
  deterministic: boolean;
  sourceFixture?: string;
  createdAt?: string;
  completedAt?: string;
  datasetVersion?: string;
  packageVersion?: string;
}): RunSnapshotMetadata {
  const metadata: RunSnapshotMetadata = {
    schemaVersion: RUN_SNAPSHOT_SCHEMA_VERSION,
    createdAt: input.createdAt ?? nowIso(),
    deterministic: input.deterministic
  };

  if (input.completedAt !== undefined) {
    metadata.completedAt = input.completedAt;
  }

  if (input.sourceFixture !== undefined) {
    metadata.sourceFixture = input.sourceFixture;
  }

  if (input.datasetVersion !== undefined) {
    metadata.datasetVersion = input.datasetVersion;
  }

  if (input.packageVersion !== undefined) {
    metadata.packageVersion = input.packageVersion;
  }

  return RunSnapshotMetadataSchema.parse(metadata);
}
