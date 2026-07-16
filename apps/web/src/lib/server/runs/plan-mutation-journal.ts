import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "../workspaces/atomic-write";

export const PLAN_MUTATION_STATUSES = [
  "prepared",
  "graph_prepared",
  "record_persisted",
  "worktrees_cleaned",
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
  patchId: z.string().min(1).optional(),
  amendmentId: z.string().min(1).optional(),
  decisionId: z.string().min(1).optional(),
  runOperationId: z.string().uuid().optional(),
  invalidatedTaskIds: z.array(z.string().min(1)).optional(),
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
  private chain: Promise<unknown> = Promise.resolve();
  private readonly now: () => string;

  constructor(private readonly options: { directory: string; clock?: () => string }) {
    this.now = options.clock ?? (() => new Date().toISOString());
  }

  async reserve(input: Omit<PlanMutationOperation, "schemaVersion" | "version" | "status" | "createdAt" | "updatedAt">): Promise<PlanMutationOperation> {
    return this.withJournalLock(async () => {
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
    return this.withJournalLock(async () => {
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
    return this.withJournalLock(async () => {
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

  private withJournalLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.chain;
    const next = previous.then(
      () => this.withFilesystemLock(operation),
      () => this.withFilesystemLock(operation)
    );
    this.chain = next.catch(() => undefined);
    return next;
  }

  /**
   * The journal is one shared JSON file, so its mutex must be global too.  A
   * per-run lock lets two different runs read the same generation and publish
   * competing full-file replacements.  The token makes stale takeover/release
   * fencing-safe: an old owner can never remove a successor's lock.
   */
  private async withFilesystemLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = path.join(this.options.directory, ".plan-mutations.lock");
    await mkdir(this.options.directory, { recursive: true });
    const deadline = Date.now() + 15_000;
    const token = randomUUID();
    while (true) {
      try {
        await mkdir(lock);
        await writeFile(
          path.join(lock, "owner.json"),
          JSON.stringify({ token, pid: process.pid, acquiredAtMs: Date.now() }),
          "utf8"
        );
        break;
      } catch (error) {
        if (!isErrno(error) || error.code !== "EEXIST") throw error;
        const info = await stat(lock).catch(() => undefined);
        if (info !== undefined && Date.now() - info.mtimeMs > 30_000) {
          const quarantine = `${lock}.stale-${randomUUID()}`;
          try {
            await rename(lock, quarantine);
            await rm(quarantine, { recursive: true, force: true });
          } catch (takeoverError) {
            if (!isErrno(takeoverError) || takeoverError.code !== "ENOENT") throw takeoverError;
          }
          continue;
        }
        if (Date.now() >= deadline) throw new PlanMutationConflictError("Timed out locking the plan mutation journal.");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    try {
      return await operation();
    } finally {
      await releaseFilesystemLock(lock, token);
    }
  }
}

const ORDER: Record<PlanMutationStatus, number> = {
  prepared: 0,
  graph_prepared: 1,
  record_persisted: 2,
  worktrees_cleaned: 3,
  checkpoint_reset: 4,
  events_persisted: 5,
  completed: 6,
  failed: 99
};

function canAdvance(from: PlanMutationStatus, to: PlanMutationStatus): boolean {
  if (from === "completed" || from === "failed") return false;
  return to === "failed" || ORDER[to] > ORDER[from];
}

export function planMutationStatusAtLeast(
  current: PlanMutationStatus,
  expected: PlanMutationStatus
): boolean {
  return ORDER[current] >= ORDER[expected];
}

async function releaseFilesystemLock(lock: string, token: string): Promise<void> {
  try {
    const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8")) as { token?: unknown };
    if (owner.token !== token) return;
    const quarantine = `${lock}.released-${token}`;
    await rename(lock, quarantine);
    await rm(quarantine, { recursive: true, force: true });
  } catch (error) {
    if (isErrno(error) && error.code === "ENOENT") return;
    throw error;
  }
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
