import { createHash } from "node:crypto";
import path from "node:path";
import { EntityIdSchema, IsoTimestampSchema, NonEmptyStringSchema } from "@manyhands/shared";
import { z } from "zod";
import {
  RepositoryCapabilitiesSchema,
  discoverRepositoryCapabilities,
  type RepositoryCapabilities
} from "./capabilities.js";

export const REPOSITORY_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const REPOSITORY_INDEX_SCHEMA_VERSION = 1 as const;

export const RepositorySnapshotDiagnosticSchema = z.object({
  code: NonEmptyStringSchema,
  severity: z.enum(["info", "warning", "error"]),
  message: NonEmptyStringSchema,
  filePath: NonEmptyStringSchema.optional()
}).strict();

export type RepositorySnapshotDiagnostic = z.infer<typeof RepositorySnapshotDiagnosticSchema>;

export interface RepositoryIndexLike {
  repositoryId: string;
  files: Array<{ path: string }>;
  diagnostics: Array<{
    severity: "info" | "warning" | "error";
    message: string;
    filePath?: string | undefined;
  }>;
}

export interface RepositorySnapshotRecord<TIndex extends RepositoryIndexLike = RepositoryIndexLike> {
  schemaVersion: typeof REPOSITORY_SNAPSHOT_SCHEMA_VERSION;
  snapshotId: string;
  repositoryId: string;
  rootPath: string;
  targetFingerprint: string;
  baseCommit: string;
  indexSchemaVersion: typeof REPOSITORY_INDEX_SCHEMA_VERSION;
  capturedAt: string;
  inspectionDisposition: "complete" | "partial" | "unavailable";
  capabilities: RepositoryCapabilities;
  diagnostics: RepositorySnapshotDiagnostic[];
  indexHash?: string;
  index?: TIndex;
}

export interface RepositorySnapshotBuilderInput {
  rootPath: string;
  repositoryId?: string;
  targetFingerprint: string;
  baseCommit: string;
  capturedAt?: string;
  limits?: Record<string, number>;
  signal?: AbortSignal;
}

export interface RepositorySnapshotBuildDependencies<TIndex extends RepositoryIndexLike> {
  index(input: {
    rootPath: string;
    repositoryId?: string;
    indexedAt?: string;
    limits?: Record<string, number>;
    signal?: AbortSignal;
  }): Promise<TIndex>;
  computeIndexHash(index: TIndex): string;
  now(): string;
}

export function createRepositorySnapshotSchema<TIndex extends z.ZodTypeAny>(indexSchema: TIndex) {
  return z.object({
    schemaVersion: z.literal(REPOSITORY_SNAPSHOT_SCHEMA_VERSION),
    snapshotId: NonEmptyStringSchema.regex(/^sha256:[a-f0-9]{64}$/u),
    repositoryId: EntityIdSchema,
    rootPath: NonEmptyStringSchema,
    targetFingerprint: NonEmptyStringSchema,
    baseCommit: NonEmptyStringSchema,
    indexSchemaVersion: z.literal(REPOSITORY_INDEX_SCHEMA_VERSION),
    capturedAt: IsoTimestampSchema,
    inspectionDisposition: z.enum(["complete", "partial", "unavailable"]),
    capabilities: RepositoryCapabilitiesSchema,
    diagnostics: z.array(RepositorySnapshotDiagnosticSchema),
    indexHash: NonEmptyStringSchema.optional(),
    index: indexSchema.optional()
  }).strict().superRefine((snapshot, context) => {
    const hasIndex = snapshot.index !== undefined && snapshot.indexHash !== undefined;
    if (snapshot.inspectionDisposition === "unavailable" && hasIndex) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["index"], message: "unavailable snapshot cannot contain an index" });
    }
    if (snapshot.inspectionDisposition !== "unavailable" && !hasIndex) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["index"], message: "complete or partial snapshot requires an index and hash" });
    }
  });
}

export async function buildRepositorySnapshotRecord<TIndex extends RepositoryIndexLike>(
  input: RepositorySnapshotBuilderInput,
  dependencies: RepositorySnapshotBuildDependencies<TIndex>
): Promise<RepositorySnapshotRecord<TIndex>> {
  const rootPath = path.resolve(input.rootPath);
  const capturedAt = input.capturedAt ?? dependencies.now();
  let index: TIndex | undefined;
  let indexHash: string | undefined;
  const diagnostics: RepositorySnapshotDiagnostic[] = [];

  try {
    index = await dependencies.index({
      rootPath,
      ...(input.repositoryId !== undefined ? { repositoryId: input.repositoryId } : {}),
      indexedAt: capturedAt,
      ...(input.limits !== undefined ? { limits: input.limits } : {}),
      ...(input.signal !== undefined ? { signal: input.signal } : {})
    });
    indexHash = dependencies.computeIndexHash(index);
    diagnostics.push(
      ...index.diagnostics.map((diagnostic) => ({
        code: "index_diagnostic",
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.filePath !== undefined ? { filePath: diagnostic.filePath } : {})
      }))
    );
  } catch (error) {
    diagnostics.push({
      code: "index_unavailable",
      severity: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  const capabilityResult = await discoverRepositoryCapabilities(rootPath, index);
  diagnostics.push(...capabilityResult.diagnostics);
  if (index !== undefined && capabilityResult.capabilities.languages.length === 0) {
    diagnostics.push({
      code: "no_supported_source_files",
      severity: "warning",
      message: "Repository contains no structurally indexed TypeScript or JavaScript source files."
    });
  }

  const inspectionDisposition = index === undefined
    ? "unavailable"
    : diagnostics.some((diagnostic) => diagnostic.severity !== "info")
      ? "partial"
      : "complete";
  const repositoryId = index?.repositoryId ?? input.repositoryId ?? repositoryIdFromPath(rootPath);
  const identity = {
    schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
    indexSchemaVersion: REPOSITORY_INDEX_SCHEMA_VERSION,
    repositoryId,
    targetFingerprint: input.targetFingerprint,
    baseCommit: input.baseCommit,
    inspectionDisposition,
    indexHash: indexHash ?? "unavailable",
    capabilities: capabilityResult.capabilities
  };

  return {
    schemaVersion: REPOSITORY_SNAPSHOT_SCHEMA_VERSION,
    snapshotId: `sha256:${stableHash(identity)}`,
    repositoryId,
    rootPath,
    targetFingerprint: input.targetFingerprint,
    baseCommit: input.baseCommit,
    indexSchemaVersion: REPOSITORY_INDEX_SCHEMA_VERSION,
    capturedAt,
    inspectionDisposition,
    capabilities: capabilityResult.capabilities,
    diagnostics,
    ...(indexHash !== undefined ? { indexHash } : {}),
    ...(index !== undefined ? { index } : {})
  };
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  return value;
}

function repositoryIdFromPath(rootPath: string): string {
  return path.basename(rootPath).replace(/[^A-Za-z0-9._:-]/gu, "-");
}
