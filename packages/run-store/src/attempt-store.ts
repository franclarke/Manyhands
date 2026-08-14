import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { AttemptRecordSchema, type AttemptRecord } from "@manyhands/run-coordinator";
import { atomicWriteFile } from "./durable-file.js";
import { acquireDurableLock } from "./durable-lock.js";

export class ImmutableAttemptConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ImmutableAttemptConflictError"; }
}

export class InvalidAttemptTransitionError extends Error {
  constructor(attemptId: string, from: AttemptRecord["status"], to: AttemptRecord["status"]) {
    super(`Attempt ${attemptId} cannot transition from ${from} to ${to}.`);
    this.name = "InvalidAttemptTransitionError";
  }
}

type AttemptPatch = Partial<AttemptRecord> | AttemptRecord;
type AttemptPatchFunction = (current: Readonly<AttemptRecord>) => AttemptPatch;

const ALLOWED_TRANSITIONS: Readonly<Record<AttemptRecord["status"], readonly AttemptRecord["status"][]>> = {
  created: ["created", "running", "failed", "stale"],
  running: ["running", "finished", "failed", "stale"],
  finished: ["finished", "adopted", "stale"],
  stale: ["stale"],
  adopted: ["adopted"],
  failed: ["failed"]
};

export class JsonlAttemptStore {
  private readonly directory: string;
  private readonly chains = new Map<string, Promise<unknown>>();
  constructor(options: { directory?: string } = {}) { this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2"); }
  async list(runId: string): Promise<AttemptRecord[]> {
    try { return (await readFile(this.filePath(runId), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => AttemptRecordSchema.parse(JSON.parse(line))); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error; }
  }
  async create(raw: Omit<AttemptRecord, "schemaVersion" | "status"> & Partial<Pick<AttemptRecord, "schemaVersion" | "status">>): Promise<AttemptRecord> {
    const attempt = AttemptRecordSchema.parse({ schemaVersion: 1, status: "created", ...raw });
    return this.withLock(async () => {
      const current = await this.list(attempt.runId);
      const existing = current.find((item) => item.attemptId === attempt.attemptId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) === JSON.stringify(attempt)) return existing;
        throw new ImmutableAttemptConflictError(`Attempt ${attempt.attemptId} already exists with different evidence.`);
      }
      const active = current.find((item) =>
        item.inputFingerprint === attempt.inputFingerprint &&
        isActiveAttempt(item)
      );
      if (active !== undefined) {
        throw new ImmutableAttemptConflictError(
          `Attempt ${attempt.attemptId} already has an active attempt for InputFingerprint ${attempt.inputFingerprint}: ${active.attemptId}.`
        );
      }
      if (attempt.retryOfAttemptId !== undefined && !current.some((item) => item.attemptId === attempt.retryOfAttemptId)) throw new ImmutableAttemptConflictError(`Retry predecessor ${attempt.retryOfAttemptId} does not exist.`);
      await this.write(attempt.runId, [...current, attempt]);
      return attempt;
    });
  }

  async update(attemptId: string, patch: AttemptPatchFunction): Promise<AttemptRecord>;
  async update(runId: string, attemptId: string, patch: AttemptPatchFunction): Promise<AttemptRecord>;
  async update(
    runIdOrAttemptId: string,
    attemptIdOrPatch: string | AttemptPatchFunction,
    possiblePatch?: AttemptPatchFunction
  ): Promise<AttemptRecord> {
    const explicitRunId = typeof attemptIdOrPatch === "string" ? runIdOrAttemptId : undefined;
    const attemptId = typeof attemptIdOrPatch === "string" ? attemptIdOrPatch : runIdOrAttemptId;
    const patch = typeof attemptIdOrPatch === "function" ? attemptIdOrPatch : possiblePatch;
    if (patch === undefined) throw new TypeError("JsonlAttemptStore.update requires a patch function.");

    return this.withLock(async () => {
      const runId = explicitRunId ?? await this.findRunId(attemptId);
      const current = await this.list(runId);
      const index = current.findIndex((item) => item.attemptId === attemptId);
      if (index < 0) throw new Error(`Attempt ${attemptId} does not exist.`);
      const previous = current[index]!;
      const candidate = AttemptRecordSchema.parse({ ...previous, ...patch(Object.freeze({ ...previous })) });
      assertImmutableIdentity(previous, candidate);
      if (!(ALLOWED_TRANSITIONS[previous.status] ?? []).includes(candidate.status)) {
        throw new InvalidAttemptTransitionError(attemptId, previous.status, candidate.status);
      }
      if (candidate.status === "finished" && candidate.outputDigest === undefined) {
        throw new ImmutableAttemptConflictError(`Finished attempt ${attemptId} requires an outputDigest.`);
      }
      if (JSON.stringify(previous) === JSON.stringify(candidate)) return previous;
      current[index] = candidate;
      await this.write(runId, current);
      return candidate;
    });
  }

  private filePath(runId: string): string { return path.join(this.directory, `${runId.replace(/[^A-Za-z0-9._-]/gu, "_")}.attempts.v2.jsonl`); }

  private async findRunId(attemptId: string): Promise<string> {
    let files: string[];
    try {
      files = await readdir(this.directory);
    } catch (error) {
      if (isNotFound(error)) throw new Error(`Attempt ${attemptId} does not exist.`);
      throw error;
    }
    let found: string | undefined;
    for (const file of files.filter((candidate) => candidate.endsWith(".attempts.v2.jsonl"))) {
      const records = await this.readPath(path.join(this.directory, file));
      const match = records.find((record) => record.attemptId === attemptId);
      if (match !== undefined) {
        if (found !== undefined && found !== match.runId) {
          throw new ImmutableAttemptConflictError(`Attempt id ${attemptId} is ambiguous across runs.`);
        }
        found = match.runId;
      }
    }
    if (found === undefined) throw new Error(`Attempt ${attemptId} does not exist.`);
    return found;
  }

  private async readPath(filePath: string): Promise<AttemptRecord[]> {
    return (await readFile(filePath, "utf8"))
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => AttemptRecordSchema.parse(JSON.parse(line)));
  }

  private async write(runId: string, attempts: readonly AttemptRecord[]): Promise<void> {
    await atomicWriteFile(
      this.filePath(runId),
      `${attempts.map((item) => JSON.stringify(item)).join("\n")}\n`
    );
  }

  private withLock<T>(operation: () => Promise<T>): Promise<T> {
    const key = this.directory;
    const previous = this.chains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const release = await acquireDurableLock(path.join(this.directory, ".attempts.lock"));
      try {
        return await operation();
      } finally {
        await release();
      }
    });
    this.chains.set(key, current);
    return current.finally(() => { if (this.chains.get(key) === current) this.chains.delete(key); });
  }
}

function isActiveAttempt(attempt: AttemptRecord): boolean {
  return attempt.status === "created" || attempt.status === "running" || attempt.status === "finished";
}

function assertImmutableIdentity(previous: AttemptRecord, candidate: AttemptRecord): void {
  const immutable: Array<keyof AttemptRecord> = [
    "schemaVersion",
    "attemptId",
    "runId",
    "nodeId",
    "inputFingerprint",
    "retryOfAttemptId",
    "createdAt"
  ];
  for (const key of immutable) {
    if (previous[key] !== candidate[key]) {
      throw new ImmutableAttemptConflictError(`Attempt ${previous.attemptId} cannot change immutable field ${String(key)}.`);
    }
  }
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
