import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { IntegrationResult } from "../types";
import type { IntegrationManifest } from "./manifest";

export type IntegrationOperationState =
  | "prepared"
  | "child_pending"
  | "cherry_pick_started"
  | "child_applied"
  | "conflict_detected"
  | "repair_started"
  | "repair_finished"
  | "validation_started"
  | "validation_failed"
  | "validation_finished"
  | "integration_commit_recorded"
  | "result_persisted"
  | "completed"
  | "gated"
  | "failed"
  | "cancelled";

export interface IntegrationOperationChild {
  taskId: string;
  commitSha: string;
  state: "pending" | "started" | "applied" | "conflict" | "repaired";
  /** Parent HEAD persisted before the cherry-pick side effect. */
  startedFromSha?: string;
  resultSha?: string;
  application?: "already_ancestor" | "already_satisfied" | "cherry_picked" | "manifest_materialized" | "repaired";
}

export interface IntegrationOperation {
  schemaVersion: 1 | 2;
  /** Monotonic compare-and-swap revision for every durable transition. */
  version?: number;
  integrationOperationId: string;
  runId: string;
  parentNodeId: string;
  attemptId?: string;
  requestManifestId?: string;
  resultManifestId?: string;
  operationId?: string;
  fencingToken?: number;
  worktreePath: string;
  baseSha: string;
  children: IntegrationOperationChild[];
  state: IntegrationOperationState;
  currentChildId?: string;
  finalSha?: string;
  cherryPickMainline?: 1;
  disposition?: string;
  /** Exact validated result receipt for idempotent recovery. */
  result?: IntegrationResult;
  /** Complete V2 integration manifest persisted before the operation is closed. */
  resultManifest?: IntegrationManifest;
  /** Repair receipt persisted before revalidation so a crash cannot spend it twice. */
  repairAttempt?: IntegrationManifest["repairAttempt"];
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface IntegrationOperationJournal {
  open(input: Omit<IntegrationOperation, "schemaVersion" | "version" | "integrationOperationId" | "state" | "createdAt" | "updatedAt"> & { allowTakeover?: boolean }): Promise<IntegrationOperation>;
  update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation>;
}

export class IntegrationOperationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationOperationConflictError";
  }
}

export class IntegrationOperationLeaseError extends IntegrationOperationConflictError {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationOperationLeaseError";
  }
}

/** Small, durable operation journal. It deliberately captures Git evidence, not executor output. */
export class JsonIntegrationOperationJournal implements IntegrationOperationJournal {
  private readonly writeChains = new Map<string, Promise<unknown>>();

  constructor(private readonly directory: string, private readonly now: () => string = () => new Date().toISOString()) {}

  async open(input: Omit<IntegrationOperation, "schemaVersion" | "version" | "integrationOperationId" | "state" | "createdAt" | "updatedAt"> & { allowTakeover?: boolean }): Promise<IntegrationOperation> {
    const { allowTakeover = false, ...operationInput } = input;
    const path = this.pathFor(operationInput.runId, operationInput.parentNodeId, operationInput.attemptId);
    return this.withMutationLock(path, async () => {
      await mkdir(this.directory, { recursive: true });
      const existing = await this.read(path);
      if (existing !== undefined) {
        assertSameOperation(existing, operationInput);
        if (existing.operationId !== operationInput.operationId || existing.fencingToken !== operationInput.fencingToken) {
          if (!allowTakeover) {
            throw new IntegrationOperationLeaseError(`Integration journal is fenced by operation ${existing.operationId ?? "legacy"}/${existing.fencingToken ?? 0}.`);
          }
          if (existing.state !== "completed") {
            const takenOver: IntegrationOperation = {
              ...existing,
              ...(operationInput.operationId !== undefined ? { operationId: operationInput.operationId } : {}),
              ...(operationInput.fencingToken !== undefined ? { fencingToken: operationInput.fencingToken } : {}),
              version: (existing.version ?? 0) + 1,
              updatedAt: this.now()
            };
            await this.write(path, takenOver);
            return takenOver;
          }
        }
        if (
          existing.schemaVersion === 1 &&
          existing.state === "prepared" &&
          existing.children.every((child) => child.state === "pending") &&
          existing.finalSha === undefined
        ) {
          const migrated: IntegrationOperation = {
            ...existing,
            schemaVersion: 2,
            version: (existing.version ?? 0) + 1,
            updatedAt: this.now()
          };
          await this.write(path, migrated);
          return migrated;
        }
        return existing;
      }
      const timestamp = this.now();
      const operation: IntegrationOperation = {
        ...operationInput,
        schemaVersion: 2,
        version: 1,
        integrationOperationId: randomUUID(),
        state: "prepared",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      await this.write(path, operation);
      return operation;
    });
  }

  async update(operation: IntegrationOperation, patch: Partial<IntegrationOperation>): Promise<IntegrationOperation> {
    const path = this.pathFor(operation.runId, operation.parentNodeId, operation.attemptId);
    return this.withMutationLock(path, async () => {
      const current = await this.read(path);
      if (current === undefined) {
        throw new IntegrationOperationConflictError(
          `Integration operation ${operation.integrationOperationId} no longer exists.`
        );
      }
      if (current.integrationOperationId !== operation.integrationOperationId) {
        throw new IntegrationOperationConflictError("Integration operation identity changed during update.");
      }
      assertSameLease(current, operation);
      if ((current.version ?? 0) !== (operation.version ?? 0)) {
        throw new IntegrationOperationConflictError(
          `Integration operation ${operation.integrationOperationId} version ${operation.version ?? 0} is stale; ` +
            `current version is ${current.version ?? 0}.`
        );
      }
      assertPatchDoesNotRewriteIdentity(current, patch);
      const next: IntegrationOperation = {
        ...current,
        ...patch,
        version: (current.version ?? 0) + 1,
        updatedAt: this.now()
      };
      await this.write(path, next);
      return next;
    });
  }

  private pathFor(runId: string, parentNodeId: string, attemptId?: string): string {
    return join(this.directory, `${safeLockName(runId)}-${safeLockName(parentNodeId)}-${safeLockName(attemptId ?? "legacy")}.json`);
  }
  private async read(path: string): Promise<IntegrationOperation | undefined> {
    try { return JSON.parse(await readFile(path, "utf8")) as IntegrationOperation; } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  private async write(path: string, value: IntegrationOperation): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value), "utf8");
    await rename(temp, path);
  }

  private withMutationLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeChains.get(path) ?? Promise.resolve();
    const next = previous.then(
      () => this.withFilesystemLock(path, operation),
      () => this.withFilesystemLock(path, operation)
    );
    this.writeChains.set(path, next.catch(() => undefined));
    return next;
  }

  private async withFilesystemLock<T>(journalPath: string, operation: () => Promise<T>): Promise<T> {
    const locks = join(this.directory, ".mutation-locks");
    const lock = join(locks, safeLockName(journalPath));
    await mkdir(locks, { recursive: true });
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        await mkdir(lock);
        await writeFile(join(lock, "owner"), `${process.pid}\n${Date.now()}`, "utf8");
        break;
      } catch (error) {
        if (!isErrno(error) || error.code !== "EEXIST") throw error;
        const info = await stat(lock).catch(() => undefined);
        if (info !== undefined && Date.now() - info.mtimeMs > 30_000) {
          await rm(lock, { recursive: true, force: true });
          continue;
        }
        if (Date.now() >= deadline) {
          throw new IntegrationOperationConflictError(`Timed out locking integration journal ${journalPath}.`);
        }
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

function assertSameOperation(
  existing: IntegrationOperation,
  input: Omit<IntegrationOperation, "schemaVersion" | "version" | "integrationOperationId" | "state" | "createdAt" | "updatedAt">
): void {
  if (
    existing.worktreePath !== input.worktreePath ||
    existing.baseSha !== input.baseSha ||
    existing.requestManifestId !== input.requestManifestId ||
    JSON.stringify(existing.children.map(({ taskId, commitSha }) => ({ taskId, commitSha }))) !==
      JSON.stringify(input.children.map(({ taskId, commitSha }) => ({ taskId, commitSha })))
  ) {
    throw new IntegrationOperationConflictError("Integration operation inputs changed during resume.");
  }
}

function assertSameLease(
  current: Pick<IntegrationOperation, "operationId" | "fencingToken">,
  candidate: Pick<IntegrationOperation, "operationId" | "fencingToken">
): void {
  if (current.operationId !== candidate.operationId || current.fencingToken !== candidate.fencingToken) {
    throw new IntegrationOperationLeaseError(
      `Integration journal is fenced by operation ${current.operationId ?? "legacy"}/${current.fencingToken ?? 0}.`
    );
  }
}

function assertPatchDoesNotRewriteIdentity(
  current: IntegrationOperation,
  patch: Partial<IntegrationOperation>
): void {
  const immutable = [
    "schemaVersion",
    "version",
    "integrationOperationId",
    "runId",
    "parentNodeId",
    "attemptId",
    "requestManifestId",
    "operationId",
    "fencingToken",
    "worktreePath",
    "baseSha",
    "createdAt"
  ] as const;
  for (const key of immutable) {
    if (key in patch && patch[key] !== current[key]) {
      throw new IntegrationOperationConflictError(`Integration operation field ${key} is immutable.`);
    }
  }
}

function safeLockName(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9._-]+/gu, "_");
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 80)}-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function isErrno(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
