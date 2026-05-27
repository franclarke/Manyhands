import { mkdir, readFile, readdir } from "node:fs/promises";
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
    const records: RunRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const record = await this.readFile(path.join(this.directory, entry));
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
      const parsed = RunRecordSchema.parse({
        ...run,
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
    const raw = await readFile(filePath, { encoding: "utf8" });
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
    const next = previous.then(fn, fn);
    this.writeChains.set(runId, next.catch(() => undefined));
    return next;
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
  }
}

function safeFileName(runId: string): string {
  return runId.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

interface NodeErrnoException {
  code?: string;
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
