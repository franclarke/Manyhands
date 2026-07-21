import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson } from "../workspaces/atomic-write";
import { RunNotFoundError, RunValidationError } from "./errors";
import { resolveRunsDirectory } from "./runs-directory";
import {
  RUN_FILE_VERSION,
  RunFileSchema,
  RunRecordSchema,
  type RunFile,
  type RunRecord
} from "./schema";

export interface RunListFilter {
  workspaceId?: string;
  workspaceIds?: readonly string[];
  includeArchived?: boolean;
  limit?: number;
}

export interface RunRepository {
  list(filter?: RunListFilter): Promise<RunRecord[]>;
  /**
   * Reference-integrity query. Unlike the productive list view, this fails
   * closed when a record that may reference the requested workspace cannot be
   * read or validated.
   */
  listStrict(filter?: RunListFilter): Promise<RunRecord[]>;
  get(runId: string): Promise<RunRecord>;
  save(run: RunRecord): Promise<RunRecord>;
  /**
   * Atomic read-modify-write: re-reads the latest record INSIDE the per-id write
   * lock, applies `mutator`, and persists. Use this for background writers that run
   * concurrently with the main pipeline (heartbeat, live planning nodes) so a stale
   * `{ ...current }` snapshot can never clobber a field it didn't touch (e.g. drop
   * `planning` written by the planning save). A plain `save` re-reads OUTSIDE the
   * lock and is therefore subject to lost updates.
   */
  update(runId: string, mutator: (current: RunRecord) => RunRecord): Promise<RunRecord>;
  delete(runId: string): Promise<void>;
}

export interface JsonRunRecordStoreOptions {
  directory: string;
  clock?: () => string;
}

export interface RunRecordInspection {
  runId: string;
  fileName: string;
  status: "ok" | "missing" | "corrupt";
  reason?: string;
  run?: RunRecord;
  updatedAt?: string;
}

export interface CorruptRunRecordListOptions {
  /** Override used by tests and offline tooling; production resolves the durable runs directory. */
  directory?: string;
  /**
   * Maximum changed/unindexed records to parse during this call. `0` is the
   * read-only hot path: it reads the durable diagnostics index but never opens
   * a RunRecord. The default is deliberately bounded.
   */
  inspectionBudget?: number;
}

export class JsonRunRecordStore implements RunRepository {
  private readonly directory: string;
  private readonly clock: () => string;
  private writeChains = new Map<string, Promise<unknown>>();

  constructor(options: JsonRunRecordStoreOptions) {
    this.directory = options.directory;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async list(filter: RunListFilter = {}): Promise<RunRecord[]> {
    await this.ensureDirectory();
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") return [];
      throw error;
    }
    // Order candidate files by mtime (newest first) WITHOUT reading them, then
    // read lazily and stop once we have `limit` matching records. `mtime` is set
    // by the same atomic write that bumps `updatedAt`, so it is a faithful proxy
    // for recency. This keeps a "recent runs" query O(limit) reads instead of
    // parsing every run file on disk: the layout sidebar runs `list({ limit })`
    // on every navigation, and a single multi-MB run record would otherwise be
    // re-read and re-parsed each time (and, in dev, re-serialised into the page).
    const candidates: Array<{ path: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const filePath = path.join(this.directory, entry);
      try {
        const stats = await stat(filePath);
        candidates.push({ path: filePath, mtimeMs: stats.mtimeMs });
      } catch {
        // A file removed between readdir and stat is simply skipped.
      }
    }
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);

    const workspaceIds = filter.workspaceIds === undefined ? undefined : new Set(filter.workspaceIds);
    const includeArchived = filter.includeArchived ?? true;
    const records: RunRecord[] = [];
    for (const candidate of candidates) {
      if (filter.limit !== undefined && records.length >= filter.limit) break;
      try {
        const record = await this.readFile(candidate.path);
        if (filter.workspaceId !== undefined && record.workspaceId !== filter.workspaceId) {
          continue;
        }
        if (workspaceIds !== undefined && !workspaceIds.has(record.workspaceId)) continue;
        if (!includeArchived && record.archivedAt !== undefined) continue;
        records.push(record);
      } catch {
        // Skip unreadable / invalid files silently; surfacing every malformed run
        // would punish users in dev. They can still be inspected via GET /api/runs/:id.
      }
    }
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return filter.limit !== undefined ? records.slice(0, filter.limit) : records;
  }

  async listStrict(filter: RunListFilter = {}): Promise<RunRecord[]> {
    try {
      await this.ensureDirectory();
    } catch (error) {
      throw strictReferenceInspectionError(this.directory, error);
    }
    let entries: string[];
    try {
      entries = await readdir(this.directory);
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") return [];
      throw strictReferenceInspectionError(this.directory, error);
    }

    const workspaceIds = filter.workspaceIds === undefined ? undefined : new Set(filter.workspaceIds);
    const referenceWorkspaceIds = new Set(workspaceIds ?? []);
    if (filter.workspaceId !== undefined) referenceWorkspaceIds.add(filter.workspaceId);
    const includeArchived = filter.includeArchived ?? true;
    const records: RunRecord[] = [];
    for (const entry of entries.filter(isPrimaryRunRecordFile).sort()) {
      const filePath = path.join(this.directory, entry);
      if (referenceWorkspaceIds.size > 0) {
        let referencedWorkspaceId: string;
        try {
          referencedWorkspaceId = await readWorkspaceIdForReference(filePath);
        } catch (error) {
          throw strictReferenceInspectionError(this.directory, error, entry);
        }
        if (!referenceWorkspaceIds.has(referencedWorkspaceId)) continue;
      }
      let record: RunRecord;
      try {
        record = await this.readFile(filePath);
      } catch (error) {
        throw strictReferenceInspectionError(this.directory, error, entry);
      }
      if (filter.workspaceId !== undefined && record.workspaceId !== filter.workspaceId) continue;
      if (workspaceIds !== undefined && !workspaceIds.has(record.workspaceId)) continue;
      if (!includeArchived && record.archivedAt !== undefined) continue;
      records.push(record);
      if (filter.limit !== undefined && records.length >= filter.limit) break;
    }
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return records;
  }

  async get(runId: string): Promise<RunRecord> {
    try {
      return await this.readFile(this.filePathFor(runId));
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") {
        throw new RunNotFoundError(runId);
      }
      throw error;
    }
  }

  async save(run: RunRecord): Promise<RunRecord> {
    return this.withLock(run.runId, async () => {
      // `version` is repository-owned: monotonic per persisted write, taken from
      // the record on disk (not the caller's possibly stale snapshot) so it never
      // regresses even under last-wins saves.
      const diskRecord = await this.get(run.runId).then(
        (current) => current,
        () => undefined
      );
      const parsed = RunRecordSchema.parse({
        ...run,
        version: Math.max(diskRecord?.version ?? 0, run.version ?? 0) + 1,
        mutationFence: Math.max(diskRecord?.mutationFence ?? 0, run.mutationFence ?? 0),
        updatedAt: this.clock()
      });
      const file: RunFile = { version: RUN_FILE_VERSION, run: parsed };
      await atomicWriteJson(this.filePathFor(parsed.runId), file);
      return parsed;
    });
  }

  async update(runId: string, mutator: (current: RunRecord) => RunRecord): Promise<RunRecord> {
    return this.withLock(runId, async () => {
      // get() reads without taking the lock, so re-reading here is safe (no
      // re-entrancy) and yields the record left by whichever write ran before us.
      const current = await this.get(runId);
      const mutated = mutator(current);
      const parsed = RunRecordSchema.parse({
        ...mutated,
        version: current.version + 1,
        mutationFence: Math.max(current.mutationFence ?? 0, mutated.mutationFence ?? 0),
        updatedAt: this.clock()
      });
      const file: RunFile = { version: RUN_FILE_VERSION, run: parsed };
      await atomicWriteJson(this.filePathFor(parsed.runId), file);
      return parsed;
    });
  }

  async delete(runId: string): Promise<void> {
    await this.withLock(runId, async () => {
      const { rm } = await import("node:fs/promises");
      try {
        await rm(this.filePathFor(runId));
      } catch (error) {
        if (isErrno(error) && error.code === "ENOENT") {
          throw new RunNotFoundError(runId);
        }
        throw error;
      }
    });
  }

  private filePathFor(runId: string): string {
    return path.join(this.directory, `${safeFileName(runId)}.json`);
  }

  private async readFile(filePath: string): Promise<RunRecord> {
    const raw = await readRawWithRetry(filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new RunValidationError(`Run file at ${filePath} is not valid JSON`);
    }
    const result = RunFileSchema.safeParse(parsed);
    if (!result.success) {
      throw new RunValidationError(
        `Run file at ${filePath} failed validation: ${result.error.issues[0]?.message ?? "unknown"}`
      );
    }
    if (result.data.version !== RUN_FILE_VERSION) {
      throw new RunValidationError(`Unsupported run file version: ${result.data.version}`);
    }
    return result.data.run;
  }

  private withLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(runId) ?? Promise.resolve();
    const next = previous.then(
      () => this.withFileMutationLock(runId, fn),
      () => this.withFileMutationLock(runId, fn)
    );
    this.writeChains.set(runId, next.catch(() => undefined));
    return next;
  }

  /**
   * The in-memory chain orders calls in one repository instance. Next dev
   * reloads and multiple server processes can own independent instances, so a
   * short-lived filesystem mutex also protects the read-modify-write section.
   * It is deliberately separate from the long-lived repository execution
   * lease: this lock only surrounds one RunRecord mutation.
   */
  private async withFileMutationLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    await this.ensureDirectory();
    const locksDirectory = path.join(this.directory, ".mutation-locks");
    await mkdir(locksDirectory, { recursive: true });
    const lockPath = path.join(locksDirectory, `${safeFileName(runId)}.lock`);
    const token = randomUUID();
    const deadline = Date.now() + MUTATION_LOCK_ACQUIRE_TIMEOUT_MS;

    while (true) {
      try {
        await mkdir(lockPath);
        await writeFile(
          path.join(lockPath, "owner.json"),
          JSON.stringify({ token, pid: process.pid, acquiredAtMs: Date.now() }),
          "utf8"
        );
        break;
      } catch (error) {
        if (!isErrno(error) || error.code !== "EEXIST") throw error;
        if (await tryQuarantineStaleMutationLock(lockPath)) continue;
        if (Date.now() >= deadline) {
          throw new RunValidationError(`Timed out acquiring mutation lock for run ${runId}`);
        }
        await delay(MUTATION_LOCK_RETRY_MS);
      }
    }

    try {
      return await fn();
    } finally {
      await releaseOwnedMutationLock(lockPath, token);
    }
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }
}

function strictReferenceInspectionError(target: string, error: unknown, entry?: string): RunValidationError {
  const detail = error instanceof Error ? error.message : String(error);
  if (entry !== undefined) {
    const runId = entry.slice(0, -".json".length);
    return new RunValidationError(
      `Cannot safely inspect run record "${entry}" while checking workspace references: ${detail}. ` +
        `Inspect /api/runs/${encodeURIComponent(runId)}/diagnostics and repair or explicitly remove ` +
        "that run before retrying; no workspace data was deleted."
    );
  }
  return new RunValidationError(
    `Cannot safely inspect run records at "${target}" while checking workspace references: ${detail}. ` +
      "Restore read access and retry; no workspace data was deleted."
  );
}

/**
 * Read a file as UTF-8, retrying briefly on the transient fs errors a concurrent
 * atomic write can surface on Windows: an `atomicWriteJson` rename can momentarily
 * make the target unreadable (ENOENT) or locked (EBUSY/EPERM/EACCES) while a write
 * lands during heavy planning. A genuinely missing run still throws ENOENT after the
 * short retry budget, so callers still get RunNotFoundError quickly.
 */
const TRANSIENT_READ_CODES = new Set(["ENOENT", "EBUSY", "EPERM", "EACCES"]);

async function readRawWithRetry(filePath: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await readFile(filePath, { encoding: "utf8" });
    } catch (error) {
      const code = (error as NodeErrnoException).code;
      if (attempt === 3 || code === undefined || !TRANSIENT_READ_CODES.has(code)) {
        throw error;
      }
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw lastError;
}

function safeFileName(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isPrimaryRunRecordFile(entry: string): boolean {
  return entry.endsWith(".json") && !entry.endsWith(".snapshot.v2.json") && !entry.endsWith(".fence.v2.json");
}

async function readWorkspaceIdForReference(filePath: string): Promise<string> {
  const raw = await readRawWithRetry(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RunValidationError(`Run file at ${filePath} is not valid JSON`);
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    !("run" in parsed) ||
    typeof parsed.run !== "object" || parsed.run === null || Array.isArray(parsed.run) ||
    !("workspaceId" in parsed.run) ||
    typeof parsed.run.workspaceId !== "string" || parsed.run.workspaceId.length === 0
  ) {
    throw new RunValidationError(`Run file at ${filePath} does not declare a workspaceId`);
  }
  return parsed.run.workspaceId;
}

/** Inspect one record without hiding validation/corruption failures. */
export async function inspectRunRecordFile(
  runId: string,
  directory = resolveRunsDirectory()
): Promise<RunRecordInspection> {
  const fileName = `${safeFileName(runId)}.json`;
  const filePath = path.join(directory, fileName);
  let updatedAt: string | undefined;
  try {
    updatedAt = new Date((await stat(filePath)).mtimeMs).toISOString();
    const raw = await readRawWithRetry(filePath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { runId, fileName, status: "corrupt", reason: "invalid JSON", ...(updatedAt ? { updatedAt } : {}) };
    }
    const result = RunFileSchema.safeParse(parsed);
    if (!result.success) {
      return {
        runId,
        fileName,
        status: "corrupt",
        reason: result.error.issues[0]?.message ?? "schema validation failed",
        ...(updatedAt ? { updatedAt } : {})
      };
    }
    if (result.data.version !== RUN_FILE_VERSION) {
      return {
        runId,
        fileName,
        status: "corrupt",
        reason: `unsupported run file version ${result.data.version}`,
        ...(updatedAt ? { updatedAt } : {})
      };
    }
    return { runId: result.data.run.runId, fileName, status: "ok", run: result.data.run, updatedAt };
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return { runId, fileName, status: "missing" };
    return {
      runId,
      fileName,
      status: "corrupt",
      reason: error instanceof Error ? error.message : String(error),
      ...(updatedAt ? { updatedAt } : {})
    };
  }
}

interface RunRecordDiagnosticsIndexEntry {
  fileName: string;
  runId: string;
  mtimeMs: number;
  size: number;
  status: "ok" | "corrupt";
  reason?: string;
  updatedAt?: string;
}

interface RunRecordDiagnosticsIndexFile {
  version: 1;
  entries: Record<string, RunRecordDiagnosticsIndexEntry>;
}

const RUN_RECORD_DIAGNOSTICS_INDEX_VERSION = 1;
const DEFAULT_DIAGNOSTICS_INSPECTION_BUDGET = 16;
const diagnosticsIndexChains = new Map<string, Promise<unknown>>();

/**
 * Durable, incremental corruption inventory. Normal polling can pass a zero
 * budget and never parse a RunRecord; layout/operator refreshes inspect only a
 * bounded batch of new or changed files. Stable files are represented by
 * mtime/size metadata in a small side index, so multi-megabyte records are not
 * reparsed on every navigation while malformed records remain discoverable.
 */
export async function listCorruptRunRecords(
  options: CorruptRunRecordListOptions = {}
): Promise<RunRecordInspection[]> {
  const directory = options.directory ?? resolveRunsDirectory();
  const inspectionBudget = normalizeInspectionBudget(options.inspectionBudget);

  if (inspectionBudget === 0) {
    return corruptInspectionsFromIndex(await readRunRecordDiagnosticsIndex(directory));
  }

  return withDiagnosticsIndexLock(directory, async () => {
    const index = await readRunRecordDiagnosticsIndex(directory);
    const diskEntries = await readdir(directory).catch((error) => {
      if (isErrno(error) && error.code === "ENOENT") return [] as string[];
      throw error;
    });
    const candidates: Array<{ fileName: string; mtimeMs: number; size: number }> = [];
    for (const fileName of diskEntries) {
      if (!fileName.endsWith(".json")) continue;
      const info = await stat(path.join(directory, fileName)).catch(() => undefined);
      if (info !== undefined && info.isFile()) {
        candidates.push({ fileName, mtimeMs: info.mtimeMs, size: info.size });
      }
    }

    const liveFiles = new Set(candidates.map((entry) => entry.fileName));
    let changed = false;
    for (const indexedFileName of Object.keys(index.entries)) {
      if (!liveFiles.has(indexedFileName)) {
        delete index.entries[indexedFileName];
        changed = true;
      }
    }

    const stale = candidates
      .filter((candidate) => {
        const current = index.entries[candidate.fileName];
        return current === undefined || current.mtimeMs !== candidate.mtimeMs || current.size !== candidate.size;
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs || left.fileName.localeCompare(right.fileName));

    for (const candidate of stale.slice(0, inspectionBudget)) {
      const fallbackRunId = candidate.fileName.slice(0, -".json".length);
      const inspection = await inspectRunRecordFile(fallbackRunId, directory);
      index.entries[candidate.fileName] = {
        fileName: candidate.fileName,
        runId: inspection.runId,
        mtimeMs: candidate.mtimeMs,
        size: candidate.size,
        status: inspection.status === "corrupt" ? "corrupt" : "ok",
        ...(inspection.reason !== undefined ? { reason: inspection.reason } : {}),
        ...(inspection.updatedAt !== undefined ? { updatedAt: inspection.updatedAt } : {})
      };
      changed = true;
    }

    if (changed) {
      await atomicWriteJson(runRecordDiagnosticsIndexPath(directory), index);
    }
    return corruptInspectionsFromIndex(index);
  });
}

function normalizeInspectionBudget(value: number | undefined): number {
  if (value === undefined) return DEFAULT_DIAGNOSTICS_INSPECTION_BUDGET;
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(value));
}

function emptyRunRecordDiagnosticsIndex(): RunRecordDiagnosticsIndexFile {
  return { version: RUN_RECORD_DIAGNOSTICS_INDEX_VERSION, entries: {} };
}

async function readRunRecordDiagnosticsIndex(directory: string): Promise<RunRecordDiagnosticsIndexFile> {
  try {
    const parsed = JSON.parse(await readFile(runRecordDiagnosticsIndexPath(directory), "utf8")) as unknown;
    if (!isRunRecordDiagnosticsIndexFile(parsed)) return emptyRunRecordDiagnosticsIndex();
    return parsed;
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return emptyRunRecordDiagnosticsIndex();
    // The diagnostics cache is derived state. A torn/legacy cache is rebuilt in
    // bounded batches and must never take down the productive run list.
    return emptyRunRecordDiagnosticsIndex();
  }
}

function isRunRecordDiagnosticsIndexFile(value: unknown): value is RunRecordDiagnosticsIndexFile {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RunRecordDiagnosticsIndexFile>;
  if (candidate.version !== RUN_RECORD_DIAGNOSTICS_INDEX_VERSION) return false;
  if (typeof candidate.entries !== "object" || candidate.entries === null) return false;
  return Object.entries(candidate.entries).every(([fileName, raw]) => {
    if (typeof raw !== "object" || raw === null) return false;
    const entry = raw as Partial<RunRecordDiagnosticsIndexEntry>;
    return (
      entry.fileName === fileName &&
      typeof entry.runId === "string" &&
      typeof entry.mtimeMs === "number" &&
      Number.isFinite(entry.mtimeMs) &&
      typeof entry.size === "number" &&
      Number.isFinite(entry.size) &&
      (entry.status === "ok" || entry.status === "corrupt") &&
      (entry.reason === undefined || typeof entry.reason === "string") &&
      (entry.updatedAt === undefined || typeof entry.updatedAt === "string")
    );
  });
}

function corruptInspectionsFromIndex(index: RunRecordDiagnosticsIndexFile): RunRecordInspection[] {
  return Object.values(index.entries)
    .filter((entry) => entry.status === "corrupt")
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))
    .map((entry) => ({
      runId: entry.runId,
      fileName: entry.fileName,
      status: "corrupt" as const,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.updatedAt !== undefined ? { updatedAt: entry.updatedAt } : {})
    }));
}

function runRecordDiagnosticsIndexPath(directory: string): string {
  return path.join(directory, ".diagnostics", "run-record-index.json");
}

function withDiagnosticsIndexLock<T>(directory: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(directory);
  const previous = diagnosticsIndexChains.get(key) ?? Promise.resolve();
  const next = previous.then(
    () => withDiagnosticsIndexFilesystemLock(directory, operation),
    () => withDiagnosticsIndexFilesystemLock(directory, operation)
  );
  diagnosticsIndexChains.set(key, next.catch(() => undefined));
  return next;
}

async function withDiagnosticsIndexFilesystemLock<T>(
  directory: string,
  operation: () => Promise<T>
): Promise<T> {
  await mkdir(directory, { recursive: true });
  const locksDirectory = path.join(directory, ".mutation-locks");
  await mkdir(locksDirectory, { recursive: true });
  const lockPath = path.join(locksDirectory, "run-record-diagnostics.lock");
  const token = randomUUID();
  const deadline = Date.now() + MUTATION_LOCK_ACQUIRE_TIMEOUT_MS;

  while (true) {
    try {
      await mkdir(lockPath);
      await writeFile(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ token, pid: process.pid, acquiredAtMs: Date.now() }),
        "utf8"
      );
      break;
    } catch (error) {
      if (!isErrno(error) || error.code !== "EEXIST") throw error;
      if (await tryQuarantineStaleMutationLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new RunValidationError("Timed out acquiring the run-record diagnostics index lock");
      }
      await delay(MUTATION_LOCK_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedMutationLock(lockPath, token);
  }
}

interface NodeErrnoException {
  code?: string;
}

const MUTATION_LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
const MUTATION_LOCK_RETRY_MS = 10;
const MUTATION_LOCK_STALE_MS = 30_000;

interface MutationLockOwner {
  token: string;
  pid: number;
  acquiredAtMs: number;
}

async function tryQuarantineStaleMutationLock(lockPath: string): Promise<boolean> {
  let stale = false;
  try {
    const owner = JSON.parse(
      await readFile(path.join(lockPath, "owner.json"), "utf8")
    ) as Partial<MutationLockOwner>;
    stale =
      typeof owner.pid !== "number" ||
      !isProcessAlive(owner.pid) ||
      typeof owner.acquiredAtMs !== "number" ||
      Date.now() - owner.acquiredAtMs > MUTATION_LOCK_STALE_MS;
  } catch {
    const info = await stat(lockPath).catch(() => null);
    stale = info !== null && Date.now() - info.mtimeMs > MUTATION_LOCK_STALE_MS;
  }
  if (!stale) return false;

  const quarantine = `${lockPath}.${randomUUID()}.stale`;
  try {
    await rename(lockPath, quarantine);
  } catch (error) {
    if (isErrno(error) && (error.code === "ENOENT" || error.code === "EEXIST")) return false;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true });
  return true;
}

async function releaseOwnedMutationLock(lockPath: string, token: string): Promise<void> {
  const owner = await readFile(path.join(lockPath, "owner.json"), "utf8")
    .then((raw) => JSON.parse(raw) as Partial<MutationLockOwner>)
    .catch(() => null);
  if (owner?.token !== token) return;
  const quarantine = `${lockPath}.${token}.released`;
  try {
    await renameWithTransientRetry(lockPath, quarantine);
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return;
    throw error;
  }
  await rm(quarantine, { recursive: true, force: true });
}

async function renameWithTransientRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const transient =
        isErrno(error) &&
        (error.code === "EPERM" || error.code === "EACCES" || error.code === "EBUSY");
      if (!transient || attempt === 9) throw error;
      await delay(MUTATION_LOCK_RETRY_MS * (attempt + 1));
    }
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isErrno(value: unknown): value is NodeErrnoException {
  return typeof value === "object" && value !== null && "code" in value;
}

export { resolveRunsDirectory };
