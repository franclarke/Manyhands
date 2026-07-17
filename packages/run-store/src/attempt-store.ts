import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { AttemptRecordSchema, type AttemptRecord } from "@manyhands/run-coordinator";

export class ImmutableAttemptConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ImmutableAttemptConflictError"; }
}

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
    return this.withLock(attempt.runId, async () => {
      const current = await this.list(attempt.runId);
      const existing = current.find((item) => item.attemptId === attempt.attemptId);
      if (existing !== undefined) {
        if (JSON.stringify(existing) === JSON.stringify(attempt)) return existing;
        throw new ImmutableAttemptConflictError(`Attempt ${attempt.attemptId} already exists with different evidence.`);
      }
      if (attempt.retryOfAttemptId !== undefined && !current.some((item) => item.attemptId === attempt.retryOfAttemptId)) throw new ImmutableAttemptConflictError(`Retry predecessor ${attempt.retryOfAttemptId} does not exist.`);
      await mkdir(this.directory, { recursive: true });
      const filePath = this.filePath(attempt.runId);
      const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, `${[...current, attempt].map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8");
      await rename(temporary, filePath);
      return attempt;
    });
  }
  private filePath(runId: string): string { return path.join(this.directory, `${runId.replace(/[^A-Za-z0-9._-]/gu, "_")}.attempts.v2.jsonl`); }
  private withLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(runId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.chains.set(runId, current);
    return current.finally(() => { if (this.chains.get(runId) === current) this.chains.delete(runId); });
  }
}
