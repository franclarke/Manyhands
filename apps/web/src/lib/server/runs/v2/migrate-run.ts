import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ExecutionConfigSchema } from "@manyhands/execution-core";
import { foldRun, type RunEventInput } from "@manyhands/run-coordinator";
import { JsonlRunEventStore, RunSnapshotStore } from "@manyhands/run-store";

import type { RunRecord } from "../schema";

const ACTIVE_LEGACY_STATUSES = new Set([
  "created",
  "planning",
  "planned",
  "approved",
  "running",
  "executing",
  "integrating",
  "cancelling",
  "delivering"
]);

export type LegacyMigrationDisposition =
  | "already_v2"
  | "dry_run"
  | "migrated"
  | "blocked_active"
  | "blocked_target_identity"
  | "blocked_invalid";

export interface LegacyMigrationReport {
  filePath: string;
  runId?: string;
  disposition: LegacyMigrationDisposition;
  sourceHash?: string;
  warnings: string[];
  backupPath?: string;
}

export interface MigrateLegacyRunOptions {
  filePath: string;
  apply?: boolean;
  approvedBy?: string;
  backupDirectory?: string;
  importedAt?: string;
}

/**
 * Imports only the durable identity and operator context of a V1 run. Legacy
 * success flags, validation output and final manifests are deliberately not
 * promoted to V2 evidence; the imported run is interrupted and must be
 * explicitly restarted, replanned and revalidated.
 */
export async function migrateLegacyRunFile(options: MigrateLegacyRunOptions): Promise<LegacyMigrationReport> {
  const filePath = path.resolve(options.filePath);
  let raw: string;
  let parsed: unknown;
  try {
    raw = await readFile(filePath, "utf8");
    parsed = JSON.parse(raw);
  } catch (error) {
    return { filePath, disposition: "blocked_invalid", warnings: [describe(error)] };
  }
  if (isV2Envelope(parsed)) {
    return { filePath, runId: parsed.run.runId, disposition: "already_v2", warnings: [] };
  }
  const legacy = unwrapLegacyRecord(parsed);
  if (legacy === undefined) {
    return { filePath, disposition: "blocked_invalid", warnings: ["The file is not a recognizable V1 run record."] };
  }
  const sourceHash = hash(stableJson(legacy));
  const runId = stringField(legacy, "runId");
  const status = stringField(legacy, "status");
  if (runId === undefined || status === undefined) {
    return {
      filePath,
      ...(runId !== undefined ? { runId } : {}),
      disposition: "blocked_invalid",
      sourceHash,
      warnings: ["V1 runId and status are required."]
    };
  }
  if (ACTIVE_LEGACY_STATUSES.has(status) || recordField(legacy, "activeOperation") !== undefined) {
    return {
      filePath,
      runId,
      disposition: "blocked_active",
      sourceHash,
      warnings: ["Active V1 runs cannot be migrated. Stop or interrupt the legacy operation first."]
    };
  }
  const target = recordField(legacy, "targetContext");
  const physicalIdentity = target === undefined ? undefined : recordField(target, "physicalIdentity");
  if (!validPhysicalIdentity(physicalIdentity)) {
    return {
      filePath,
      runId,
      disposition: "blocked_target_identity",
      sourceHash,
      warnings: ["The V1 run did not capture a verifiable physical repository identity. Create a new run against the intended target."]
    };
  }
  const warnings = [
    "Legacy execution and artifact outcomes were not imported as V2 evidence.",
    "The imported run requires replanning and exact-candidate revalidation before delivery."
  ];
  if (options.apply !== true) return { filePath, runId, disposition: "dry_run", sourceHash, warnings };
  const approvedBy = options.approvedBy?.trim();
  if (approvedBy === undefined || approvedBy.length === 0) throw new Error("Applying a V1 migration requires --approved-by.");
  if (options.backupDirectory === undefined || options.backupDirectory.trim().length === 0) {
    throw new Error("Applying a V1 migration requires an explicit backup directory.");
  }
  const importedAt = options.importedAt ?? new Date().toISOString();
  const backupDirectory = path.resolve(options.backupDirectory);
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = path.join(backupDirectory, path.basename(filePath));
  await ensureBackup(filePath, backupPath, raw);

  const targetContext = target!;
  const record = buildV2Record(legacy, targetContext, physicalIdentity, importedAt);
  const runsDirectory = path.dirname(filePath);
  const events = new JsonlRunEventStore({ directory: runsDirectory });
  const authority = { operationId: randomUUID(), fencingToken: Math.max(Date.now(), numberField(legacy, "mutationFence") ?? 0) + 1 };
  await events.advanceFence(runId, authority);
  const existingEvents = await events.load(runId);
  if (existingEvents.length === 0) {
    const inputs: RunEventInput[] = [
      { eventId: `migration:${runId}:created`, occurredAt: importedAt, type: "run.created", payload: { goal: record.userPrompt } },
      {
        eventId: `migration:${runId}:imported`,
        occurredAt: importedAt,
        type: "legacy.run_imported",
        payload: { sourceHash, importerVersion: 1, approvedBy, sourceStatus: status, disposition: "requires_revalidation", warnings }
      }
    ];
    await events.appendFenced(runId, 0, authority, inputs);
  } else {
    const imported = existingEvents.find((event) => event.type === "legacy.run_imported");
    if (existingEvents.length !== 2 || imported?.type !== "legacy.run_imported" || imported.payload.sourceHash !== sourceHash) {
      throw new Error(`Run ${runId} already has a non-matching V2 event history.`);
    }
  }
  const durableEvents = await events.load(runId);
  const projection = foldRun(durableEvents);
  await new RunSnapshotStore({ directory: runsDirectory, events }).write(
    runId,
    authority,
    projection,
    durableEvents.length,
    durableEvents.at(-1)!.eventId
  );
  record.projection = { eventSequence: projection.sequence, lifecycle: projection.lifecycle, updatedAt: importedAt };
  record.mutationFence = authority.fencingToken;
  await atomicWrite(filePath, `${JSON.stringify({ version: 2, run: record }, null, 2)}\n`);
  const auditPath = path.join(backupDirectory, `${safeName(runId)}.migration-v2.json`);
  await atomicWrite(auditPath, `${JSON.stringify({ schemaVersion: 1, runId, sourceHash, approvedBy, importedAt, sourceStatus: status, disposition: "requires_revalidation", warnings, backupPath }, null, 2)}\n`);
  return { filePath, runId, disposition: "migrated", sourceHash, warnings, backupPath };
}

function buildV2Record(
  legacy: Record<string, unknown>,
  target: Record<string, unknown>,
  physicalIdentity: Record<string, unknown>,
  importedAt: string
): RunRecord {
  const runId = stringField(legacy, "runId")!;
  const userPrompt = stringField(legacy, "userPrompt") ?? stringField(legacy, "title") ?? "Imported V1 run";
  const model = stringField(legacy, "model") ?? "claude-sonnet-4-5";
  const stage = { executorId: "claude-code-cli" as const, model };
  return {
    runId,
    workspaceId: stringField(legacy, "workspaceId") ?? "legacy-import",
    userPrompt,
    title: (stringField(legacy, "title") ?? userPrompt).slice(0, 160),
    planningSelection: stage,
    executionSelection: stage,
    repairSelection: stage,
    executionConfig: ExecutionConfigSchema.parse({}),
    targetContext: {
      sourceRealPath: requiredString(target, "sourceRealPath"),
      gitCommonDir: requiredString(target, "gitCommonDir"),
      physicalIdentity: {
        version: 1,
        device: requiredString(physicalIdentity, "device"),
        file: requiredString(physicalIdentity, "file")
      },
      sourceBranch: requiredString(target, "sourceBranch"),
      sourceBaseCommit: requiredString(target, "sourceBaseCommit"),
      ...(stringField(target, "remoteUrl") !== undefined ? { remoteUrl: stringField(target, "remoteUrl") } : {}),
      fingerprint: requiredString(target, "fingerprint"),
      capturedAt: requiredString(target, "capturedAt")
    },
    projection: { eventSequence: 2, lifecycle: "interrupted", updatedAt: importedAt },
    version: (numberField(legacy, "version") ?? 0) + 1,
    mutationFence: numberField(legacy, "mutationFence") ?? 0,
    createdAt: stringField(legacy, "createdAt") ?? importedAt,
    updatedAt: importedAt
  };
}

async function ensureBackup(sourcePath: string, backupPath: string, sourceRaw: string): Promise<void> {
  try {
    await copyFile(sourcePath, backupPath, constants.COPYFILE_EXCL);
  } catch (error) {
    if (!isCode(error, "EEXIST")) throw error;
    if ((await readFile(backupPath, "utf8")) !== sourceRaw) throw new Error(`Backup ${backupPath} already exists with different content.`);
  }
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  try {
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function unwrapLegacyRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (isRecord(value.run) && value.version === 1) return value.run;
  return typeof value.runId === "string" ? value : undefined;
}

function isV2Envelope(value: unknown): value is { version: 2; run: { runId: string } } {
  return isRecord(value) && value.version === 2 && isRecord(value.run) && typeof value.run.runId === "string";
}

function validPhysicalIdentity(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return value?.version === 1 && typeof value.device === "string" && /^\d+$/u.test(value.device) && typeof value.file === "string" && /^\d+$/u.test(value.file);
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  return isRecord(value[key]) ? value[key] : undefined;
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" && value[key].length > 0 ? value[key] : undefined;
}

function requiredString(value: Record<string, unknown>, key: string): string {
  const found = stringField(value, key);
  if (found === undefined) throw new Error(`Legacy targetContext.${key} is required.`);
  return found;
}

function numberField(value: Record<string, unknown>, key: string): number | undefined {
  return typeof value[key] === "number" && Number.isInteger(value[key]) && value[key] >= 0 ? value[key] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
