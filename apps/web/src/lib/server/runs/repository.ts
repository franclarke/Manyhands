import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJson } from "../workspaces/atomic-write";
import { resolveRepoRoot } from "../repo-root";
import { RunNotFoundError, RunValidationError } from "./errors";
import {
  RUN_FILE_VERSION,
  RunFileSchema,
  RunRecordSchema,
  type RunFile,
  type RunRecord
} from "./schema";

export interface RunListFilter {
  workspaceId?: string;
  limit?: number;
}

export interface RunRepository {
  list(filter?: RunListFilter): Promise<RunRecord[]>;
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

    const records: RunRecord[] = [];
    for (const candidate of candidates) {
      if (filter.limit !== undefined && records.length >= filter.limit) break;
      try {
        const record = await this.readFile(candidate.path);
        if (filter.workspaceId !== undefined && record.workspaceId !== filter.workspaceId) {
          continue;
        }
        records.push(record);
      } catch {
        // Skip unreadable / invalid files silently; surfacing every malformed run
        // would punish users in dev. They can still be inspected via GET /api/runs/:id.
      }
    }
    records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return filter.limit !== undefined ? records.slice(0, filter.limit) : records;
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

export function resolveRunsDirectory(): string {
  const override = process.env.MANYHANDS_RUNS_DIR;
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.resolve(resolveRepoRoot(), ".manyhands", "runs");
}
