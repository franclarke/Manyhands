import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "../workspaces/atomic-write";

export const PLAN_MUTATION_STATUSES = [
  "prepared",
  "graph_prepared",
  "record_persisted",
  "checkpoint_reset",
  "events_persisted",
  "completed",
  "failed"
] as const;

export type PlanMutationStatus = (typeof PLAN_MUTATION_STATUSES)[number];

const PlanMutationOperationSchema = z.object({
  schemaVersion: z.literal(1),
  operationId: z.string().min(1),
  version: z.number().int().nonnegative(),
  runId: z.string().min(1),
  kind: z.enum(["replan", "amendment"]),
  expectedRunVersion: z.number().int().nonnegative(),
  sourcePlanRevision: z.number().int().positive(),
  targetPlanRevision: z.number().int().positive(),
  targetFingerprint: z.string().min(1).optional(),
  graphHash: z.string().min(1),
  /** Prepared strict-valid graph retained to make post-CAS recovery inspectable. */
  preparedGraph: z.unknown().optional(),
  status: z.enum(PLAN_MUTATION_STATUSES),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  error: z.string().min(1).optional()
});

export type PlanMutationOperation = z.infer<typeof PlanMutationOperationSchema>;

const FileSchema = z.object({ version: z.literal(1), operations: z.array(PlanMutationOperationSchema) });

export class PlanMutationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanMutationConflictError";
  }
}

export class JsonPlanMutationJournal {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly now: () => string;

  constructor(private readonly options: { directory: string; clock?: () => string }) {
    this.now = options.clock ?? (() => new Date().toISOString());
  }

  async reserve(input: Omit<PlanMutationOperation, "schemaVersion" | "version" | "status" | "createdAt" | "updatedAt">): Promise<PlanMutationOperation> {
    return this.withRunLock(input.runId, async () => {
      const file = await this.read();
      const existing = file.operations.find((operation) => operation.operationId === input.operationId);
      if (existing !== undefined) {
        if (existing.runId !== input.runId || existing.graphHash !== input.graphHash) {
          throw new PlanMutationConflictError(`Operation ${input.operationId} does not match its durable reservation.`);
        }
        return existing;
      }
      const now = this.now();
      const operation = PlanMutationOperationSchema.parse({
        schemaVersion: 1,
        version: 0,
        status: "prepared",
        createdAt: now,
        updatedAt: now,
        ...input
      });
      await this.write({ version: 1, operations: [...file.operations, operation] });
      return operation;
    });
  }

  async get(operationId: string): Promise<PlanMutationOperation | undefined> {
    return (await this.read()).operations.find((operation) => operation.operationId === operationId);
  }

  async pending(runId: string): Promise<PlanMutationOperation[]> {
    return (await this.read()).operations.filter(
      (operation) => operation.runId === runId && operation.status !== "completed" && operation.status !== "failed"
    );
  }

  /** Explicit purge only: remove this run's durable operations, never another run's. */
  async removeForRun(runId: string): Promise<number> {
    return this.withRunLock(runId, async () => {
      const file = await this.read();
      const operations = file.operations.filter((operation) => operation.runId !== runId);
      const removed = file.operations.length - operations.length;
      if (removed > 0) await this.write({ version: 1, operations });
      return removed;
    });
  }

  async transition(
    operationId: string,
    input: { expectedVersion: number; status: PlanMutationStatus; error?: string }
  ): Promise<PlanMutationOperation> {
    const current = await this.get(operationId);
    if (current === undefined) throw new PlanMutationConflictError(`Unknown plan mutation ${operationId}.`);
    return this.withRunLock(current.runId, async () => {
      const file = await this.read();
      const index = file.operations.findIndex((operation) => operation.operationId === operationId);
      const latest = file.operations[index];
      if (latest === undefined) throw new PlanMutationConflictError(`Unknown plan mutation ${operationId}.`);
      if (latest.version !== input.expectedVersion) {
        throw new PlanMutationConflictError(`Plan mutation ${operationId} version ${input.expectedVersion} is stale.`);
      }
      if (latest.status === input.status && (latest.status === "completed" || latest.status === "failed")) return latest;
      if (!canAdvance(latest.status, input.status)) {
        throw new PlanMutationConflictError(`Plan mutation cannot transition ${latest.status} -> ${input.status}.`);
      }
      const next = PlanMutationOperationSchema.parse({
        ...latest,
        version: latest.version + 1,
        status: input.status,
        updatedAt: this.now(),
        ...(input.error !== undefined ? { error: input.error } : {})
      });
      const operations = [...file.operations];
      operations[index] = next;
      await this.write({ version: 1, operations });
      return next;
    });
  }

  private async read(): Promise<z.infer<typeof FileSchema>> {
    try {
      return FileSchema.parse(JSON.parse(await readFile(this.filePath(), "utf8")));
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
        return { version: 1, operations: [] };
      }
      throw error;
    }
  }

  private async write(file: z.infer<typeof FileSchema>): Promise<void> {
    await mkdir(this.options.directory, { recursive: true });
    await atomicWriteJson(this.filePath(), file);
  }

  private filePath(): string {
    return path.join(this.options.directory, "plan-mutations.json");
  }

  private withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const next = previous.then(
      () => this.withFilesystemLock(runId, operation),
      () => this.withFilesystemLock(runId, operation)
    );
    this.chains.set(runId, next.catch(() => undefined));
    return next;
  }

  private async withFilesystemLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const locks = path.join(this.options.directory, ".mutation-locks");
    const lock = path.join(locks, safeName(runId));
    await mkdir(locks, { recursive: true });
    const deadline = Date.now() + 15_000;
    while (true) {
      try {
        await mkdir(lock);
        await writeFile(path.join(lock, "owner"), `${process.pid}\n${Date.now()}`, "utf8");
        break;
      } catch (error) {
        if (!isErrno(error) || error.code !== "EEXIST") throw error;
        const info = await stat(lock).catch(() => undefined);
        if (info !== undefined && Date.now() - info.mtimeMs > 30_000) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) throw new PlanMutationConflictError(`Timed out locking plan mutations for ${runId}.`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      return await operation();
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
}

const ORDER: Record<PlanMutationStatus, number> = {
  prepared: 0,
  graph_prepared: 1,
  record_persisted: 2,
  checkpoint_reset: 3,
  events_persisted: 4,
  completed: 5,
  failed: 99
};

function canAdvance(from: PlanMutationStatus, to: PlanMutationStatus): boolean {
  if (from === "completed" || from === "failed") return false;
  return to === "failed" || ORDER[to] > ORDER[from];
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
