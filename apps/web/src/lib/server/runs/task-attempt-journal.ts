import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { atomicWriteJson } from "../workspaces/atomic-write";
import { RunMutationConflictError } from "./errors";

const AttemptIdSchema = z.string().uuid();
const ShaSchema = z.string().regex(/^[0-9a-f]{40}$/i);

export const TASK_ATTEMPT_STATES = [
  "prepared",
  "invocation_reserved",
  "executor_running",
  "executor_finished",
  "diff_captured",
  "scope_evaluated",
  "validation_finished",
  "commit_created",
  "result_persisted",
  "adopted",
  "discarded",
  "cancelled",
  "failed",
  "recovery_required"
] as const;

export const TaskAttemptStateSchema = z.enum(TASK_ATTEMPT_STATES);
export type TaskAttemptState = z.infer<typeof TaskAttemptStateSchema>;

export const TASK_ATTEMPT_EVENT_TYPES: Partial<Record<TaskAttemptState, string>> = {
  prepared: "task.attempt.prepared",
  invocation_reserved: "task.attempt.invocation_reserved",
  executor_running: "task.attempt.executor_started",
  executor_finished: "task.attempt.executor_finished",
  diff_captured: "task.attempt.diff_captured",
  scope_evaluated: "task.attempt.scope_evaluated",
  validation_finished: "task.attempt.validation_finished",
  commit_created: "task.attempt.commit_created",
  result_persisted: "task.attempt.result_persisted",
  adopted: "task.attempt.adopted",
  discarded: "task.attempt.discarded",
  recovery_required: "task.attempt.recovery_required",
  cancelled: "task.attempt.cancelled"
};

export const TaskAttemptKindSchema = z.enum(["scheduled", "manual", "integrator", "repair"]);
export type TaskAttemptKind = z.infer<typeof TaskAttemptKindSchema>;

const AttemptProcessSchema = z.object({
  ownerId: z.string().min(1),
  pid: z.number().int().positive().optional(),
  registeredAt: z.string().datetime(),
  exitedAt: z.string().datetime().optional()
});

const AttemptExecutorSchema = z.object({
  executorId: z.string().min(1),
  provider: z.string().min(1).optional(),
  model: z.string().min(1)
});

export const TaskAttemptSchema = z.object({
  schemaVersion: z.literal(1),
  attemptId: AttemptIdSchema,
  version: z.number().int().nonnegative(),
  runId: z.string().min(1),
  nodeId: z.string().min(1),
  operationId: z.string().min(1),
  fencingToken: z.number().int().positive(),
  waveId: z.string().min(1).optional(),
  kind: TaskAttemptKindSchema,
  baseCommit: ShaSchema,
  worktreePath: z.string().min(1).optional(),
  targetFingerprint: z.string().min(1).optional(),
  contractHash: z.string().min(1).optional(),
  promptHash: z.string().min(1).optional(),
  executorConfigHash: z.string().min(1).optional(),
  executor: AttemptExecutorSchema,
  idempotencyKey: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  state: TaskAttemptStateSchema,
  process: AttemptProcessSchema.optional(),
  executorResult: z
    .object({ exitCode: z.number().int(), timedOut: z.boolean(), durationMs: z.number().int().nonnegative() })
    .optional(),
  diffIdentity: z
    .object({ baseHead: z.string().min(1), currentHead: z.string().min(1), hash: z.string().min(1), files: z.array(z.string()) })
    .optional(),
  scopeResult: z.record(z.unknown()).optional(),
  validationResult: z.record(z.unknown()).optional(),
  commitSha: ShaSchema.optional(),
  nodeDisposition: z.string().min(1).optional(),
  adoptionReason: z.string().min(1).optional(),
  discardReason: z.string().min(1).optional(),
  error: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional()
});

export type TaskAttempt = z.infer<typeof TaskAttemptSchema>;

const TaskAttemptFileSchema = z.object({
  version: z.literal(1),
  attempts: z.array(TaskAttemptSchema),
  updatedAt: z.string().datetime()
});

type TaskAttemptFile = z.infer<typeof TaskAttemptFileSchema>;
export type AttemptLease = { operationId: string; fencingToken: number };

export class TaskAttemptConflictError extends RunMutationConflictError {
  constructor(message: string) {
    super(message, "running", 0);
    this.name = "TaskAttemptConflictError";
  }
}

export class TaskAttemptLeaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskAttemptLeaseError";
  }
}

export interface TaskAttemptJournalOptions {
  directory: string;
  clock?: () => string;
}

export interface ReserveTaskAttemptInput {
  runId: string;
  nodeId: string;
  operationId: string;
  fencingToken: number;
  waveId?: string;
  kind: TaskAttemptKind;
  baseCommit: string;
  worktreePath?: string;
  targetFingerprint?: string;
  contractHash?: string;
  promptHash?: string;
  executorConfigHash?: string;
  executor: { executorId: string; provider?: string; model: string };
  idempotencyKey?: string;
}

export interface TaskAttemptTransitionInput {
  expectedVersion: number;
  lease: AttemptLease;
  state: TaskAttemptState;
  process?: TaskAttempt["process"];
  executorResult?: TaskAttempt["executorResult"];
  diffIdentity?: TaskAttempt["diffIdentity"];
  scopeResult?: Record<string, unknown>;
  validationResult?: Record<string, unknown>;
  commitSha?: string;
  nodeDisposition?: string;
  error?: TaskAttempt["error"];
}

export class JsonTaskAttemptJournal {
  private readonly directory: string;
  private readonly clock: () => string;
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(options: TaskAttemptJournalOptions) {
    this.directory = options.directory;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  async list(runId: string): Promise<TaskAttempt[]> {
    const file = await this.readFile(runId);
    return file.attempts;
  }

  async get(attemptId: string): Promise<TaskAttempt | undefined> {
    const files = await this.readAllFiles();
    return files.flatMap((file) => file.attempts).find((attempt) => attempt.attemptId === attemptId);
  }

  async findReusable(runId: string, nodeId: string): Promise<TaskAttempt[]> {
    return (await this.list(runId)).filter(
      (attempt) => attempt.nodeId === nodeId && !TERMINAL_STATES.has(attempt.state)
    );
  }

  async reserve(input: ReserveTaskAttemptInput): Promise<TaskAttempt> {
    return this.withRunLock(input.runId, async () => {
      const file = await this.readFile(input.runId);
      const existing = input.idempotencyKey === undefined
        ? undefined
        : file.attempts.find((attempt) => attempt.idempotencyKey === input.idempotencyKey);
      if (existing !== undefined) {
        assertLease(existing, input);
        return existing;
      }
      const now = this.clock();
      const attempt = TaskAttemptSchema.parse({
        schemaVersion: 1,
        attemptId: randomUUID(),
        version: 0,
        ...input,
        createdAt: now,
        updatedAt: now,
        state: "prepared"
      });
      await this.writeFile(input.runId, { ...file, attempts: [...file.attempts, attempt], updatedAt: now });
      return attempt;
    });
  }

  async transition(attemptId: string, input: TaskAttemptTransitionInput): Promise<TaskAttempt> {
    const current = await this.get(attemptId);
    if (current === undefined) throw new TaskAttemptConflictError(`Unknown task attempt ${attemptId}.`);
    return this.withRunLock(current.runId, async () => {
      const file = await this.readFile(current.runId);
      const index = file.attempts.findIndex((attempt) => attempt.attemptId === attemptId);
      if (index < 0) throw new TaskAttemptConflictError(`Unknown task attempt ${attemptId}.`);
      const latest = file.attempts[index]!;
      if (latest.version !== input.expectedVersion) {
        throw new TaskAttemptConflictError(`Attempt ${attemptId} version ${input.expectedVersion} is stale; current is ${latest.version}.`);
      }
      assertLease(latest, input.lease);
      if (latest.state === input.state && TERMINAL_STATES.has(latest.state)) return latest;
      assertTransition(latest.state, input.state);
      const now = this.clock();
      const next = TaskAttemptSchema.parse({
        ...latest,
        version: latest.version + 1,
        updatedAt: now,
        state: input.state,
        ...(input.process !== undefined ? { process: input.process } : {}),
        ...(input.executorResult !== undefined ? { executorResult: input.executorResult } : {}),
        ...(input.diffIdentity !== undefined ? { diffIdentity: input.diffIdentity } : {}),
        ...(input.scopeResult !== undefined ? { scopeResult: input.scopeResult } : {}),
        ...(input.validationResult !== undefined ? { validationResult: input.validationResult } : {}),
        ...(input.commitSha !== undefined ? { commitSha: input.commitSha } : {}),
        ...(input.nodeDisposition !== undefined ? { nodeDisposition: input.nodeDisposition } : {}),
        ...(input.error !== undefined ? { error: input.error } : {})
      });
      const attempts = [...file.attempts];
      attempts[index] = next;
      await this.writeFile(current.runId, { ...file, attempts, updatedAt: now });
      return next;
    });
  }

  async adopt(
    attemptId: string,
    input: {
      expectedVersion: number;
      lease: AttemptLease;
      reason: string;
      commitSha: string;
      verifyCommit?: () => Promise<boolean>;
    }
  ): Promise<TaskAttempt> {
    const current = await this.get(attemptId);
    if (current?.state === "adopted" && current.commitSha === input.commitSha) return current;
    if (!ShaSchema.safeParse(input.commitSha).success) {
      throw new TaskAttemptConflictError(`Cannot adopt attempt ${attemptId} without a valid commit SHA.`);
    }
    if (input.verifyCommit !== undefined && !(await input.verifyCommit())) {
      throw new TaskAttemptConflictError(`Commit ${input.commitSha} failed adoption verification.`);
    }
    return this.transition(attemptId, {
      expectedVersion: input.expectedVersion,
      lease: input.lease,
      state: "adopted",
      commitSha: input.commitSha,
      nodeDisposition: "adopted",
      error: undefined
    });
  }

  /** Transfer an ambiguous attempt to the current operation before adoption or discard. */
  async claimRecovery(
    attemptId: string,
    input: { expectedVersion: number; lease: AttemptLease; reason: string }
  ): Promise<TaskAttempt> {
    const current = await this.get(attemptId);
    if (current === undefined) throw new TaskAttemptConflictError(`Unknown task attempt ${attemptId}.`);
    return this.withRunLock(current.runId, async () => {
      const file = await this.readFile(current.runId);
      const index = file.attempts.findIndex((attempt) => attempt.attemptId === attemptId);
      if (index < 0) throw new TaskAttemptConflictError(`Unknown task attempt ${attemptId}.`);
      const latest = file.attempts[index]!;
      if (latest.version !== input.expectedVersion) {
        throw new TaskAttemptConflictError(`Attempt ${attemptId} version is stale.`);
      }
      if (input.lease.fencingToken <= latest.fencingToken) {
        throw new TaskAttemptLeaseError(`Recovery lease must advance fencing for attempt ${attemptId}.`);
      }
      const now = this.clock();
      const next = TaskAttemptSchema.parse({
        ...latest,
        version: latest.version + 1,
        operationId: input.lease.operationId,
        fencingToken: input.lease.fencingToken,
        state: "recovery_required",
        updatedAt: now,
        error: { code: "recovery_required", message: input.reason }
      });
      const attempts = [...file.attempts];
      attempts[index] = next;
      await this.writeFile(current.runId, { ...file, attempts, updatedAt: now });
      return next;
    });
  }

  async discard(
    attemptId: string,
    input: { expectedVersion: number; lease: AttemptLease; reason: string }
  ): Promise<TaskAttempt> {
    return this.transition(attemptId, {
      expectedVersion: input.expectedVersion,
      lease: input.lease,
      state: "discarded",
      nodeDisposition: "discarded",
      error: { code: "discarded", message: input.reason }
    });
  }

  private async readFile(runId: string): Promise<TaskAttemptFile> {
    const filePath = this.filePath(runId);
    try {
      return TaskAttemptFileSchema.parse(JSON.parse(await readFile(filePath, "utf8")));
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") {
        return { version: 1, attempts: [], updatedAt: this.clock() };
      }
      if (error instanceof SyntaxError) {
        throw new TaskAttemptConflictError(`Attempt journal for ${runId} is not valid JSON.`);
      }
      throw error;
    }
  }

  private async readAllFiles(): Promise<TaskAttemptFile[]> {
    let files: string[];
    try {
      files = await import("node:fs/promises").then(({ readdir }) => readdir(this.directory));
    } catch (error) {
      if (isErrno(error) && error.code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(
      files.filter((file) => file.endsWith(".json")).map((file) => this.readFile(file.slice(0, -5)))
    );
  }

  private async writeFile(runId: string, file: TaskAttemptFile): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await atomicWriteJson(this.filePath(runId), file);
  }

  private filePath(runId: string): string {
    return path.join(this.directory, `${safeName(runId)}.json`);
  }

  private withRunLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(runId) ?? Promise.resolve();
    const next = previous.then(() => this.withFilesystemLock(runId, operation), () => this.withFilesystemLock(runId, operation));
    this.writeChains.set(runId, next.catch(() => undefined));
    return next;
  }

  private async withFilesystemLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const locks = path.join(this.directory, ".mutation-locks");
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
        if (Date.now() >= deadline) throw new TaskAttemptConflictError(`Timed out locking attempt journal for ${runId}.`);
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

const TERMINAL_STATES = new Set<TaskAttemptState>([
  "adopted",
  "discarded",
  "cancelled",
  "failed",
  "recovery_required",
  "result_persisted"
]);

const STATE_ORDER: Record<TaskAttemptState, number> = {
  prepared: 0,
  invocation_reserved: 1,
  executor_running: 2,
  executor_finished: 3,
  diff_captured: 4,
  scope_evaluated: 5,
  validation_finished: 6,
  commit_created: 7,
  result_persisted: 8,
  adopted: 9,
  discarded: 100,
  cancelled: 100,
  failed: 100,
  recovery_required: 100
};

function assertTransition(current: TaskAttemptState, next: TaskAttemptState): void {
  if (current === "recovery_required" && (next === "adopted" || next === "discarded")) return;
  if (TERMINAL_STATES.has(current)) {
    if (current === next) return;
    throw new TaskAttemptConflictError(`Attempt cannot transition from terminal state ${current} to ${next}.`);
  }
  if (next !== "failed" && next !== "cancelled" && next !== "discarded" && next !== "recovery_required" && STATE_ORDER[next] <= STATE_ORDER[current]) {
    throw new TaskAttemptConflictError(`Attempt state cannot move backwards from ${current} to ${next}.`);
  }
}

function assertLease(attempt: TaskAttempt, lease: AttemptLease): void {
  if (attempt.operationId !== lease.operationId || attempt.fencingToken !== lease.fencingToken) {
    throw new TaskAttemptLeaseError(
      `Attempt ${attempt.attemptId} is fenced by operation ${attempt.operationId}/${attempt.fencingToken}.`
    );
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
