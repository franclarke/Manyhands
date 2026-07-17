import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  RunEventSchema,
  foldRun,
  type RunEvent,
  type RunEventInput,
  type RunEventJournalPort
} from "@manyhands/run-coordinator";
import {
  CorruptRunEventLogError,
  SequenceConflictError,
  StaleFencingTokenError,
  type FencedRunEventStore,
  type FencingAuthority,
  type RunEventLogInspection
} from "./event-store.js";

interface DurableEventEnvelope {
  schemaVersion: 2;
  event: RunEvent;
  checksum: string;
}

interface FenceRecord extends FencingAuthority {
  schemaVersion: 1;
}

const writeChains = new Map<string, Promise<unknown>>();
const RENAME_RETRIES = 5;
const LOCK_STALE_AFTER_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;

export class JsonlRunEventStore implements FencedRunEventStore {
  readonly directory: string;

  constructor(options: { directory?: string } = {}) {
    this.directory = path.resolve(options.directory ?? ".manyhands/runs-v2");
  }

  eventLogPath(runId: string): string {
    return path.join(this.directory, `${safeName(runId)}.events.v2.jsonl`);
  }

  fencePath(runId: string): string {
    return path.join(this.directory, `${safeName(runId)}.fence.v2.json`);
  }

  async load(runId: string): Promise<RunEvent[]> {
    const inspection = await this.inspect(runId);
    if (inspection.status === "corrupt") {
      throw new CorruptRunEventLogError(runId, inspection.reason ?? "invalid durable record");
    }
    return inspection.events;
  }

  async inspect(runId: string): Promise<RunEventLogInspection> {
    let raw: string;
    try {
      raw = await readFile(this.eventLogPath(runId), "utf8");
    } catch (error) {
      if (isNotFound(error)) return { events: [], status: "ok" };
      throw error;
    }
    return inspectRawLog(runId, raw);
  }

  async advanceFence(runId: string, authority: FencingAuthority): Promise<void> {
    validateAuthority(authority);
    await this.withLock(runId, async () => {
      const current = await this.readFence(runId);
      if (current !== null) {
        const idempotent = current.operationId === authority.operationId && current.fencingToken === authority.fencingToken;
        if (idempotent) return;
        if (authority.fencingToken <= current.fencingToken) throw new StaleFencingTokenError(runId, authority);
      }
      await atomicWriteJson(this.fencePath(runId), { schemaVersion: 1, ...authority } satisfies FenceRecord);
    });
  }

  async assertAuthority(runId: string, authority: FencingAuthority): Promise<void> {
    validateAuthority(authority);
    const current = await this.readFence(runId);
    if (current === null || current.operationId !== authority.operationId || current.fencingToken !== authority.fencingToken) {
      throw new StaleFencingTokenError(runId, authority);
    }
  }

  async appendFenced(
    runId: string,
    expectedSequence: number,
    authority: FencingAuthority,
    inputs: RunEventInput[]
  ): Promise<RunEvent[]> {
    if (!Number.isInteger(expectedSequence) || expectedSequence < 0) throw new Error("expectedSequence must be a non-negative integer.");
    if (inputs.length === 0) return [];
    return this.withFencedWrite(runId, authority, async () => {
      const inspection = await this.inspect(runId);
      if (inspection.status === "corrupt") throw new CorruptRunEventLogError(runId, inspection.reason ?? "invalid durable record");

      const existingById = new Map(inspection.events.map((event) => [event.eventId, event]));
      const duplicates = inputs.map((input) => existingById.get(input.eventId));
      if (duplicates.every((event) => event !== undefined)) {
        const events = duplicates as RunEvent[];
        events.forEach((event, index) => assertSameInput(event, inputs[index]!));
        return events;
      }
      if (duplicates.some((event) => event !== undefined)) throw new Error("An append batch cannot mix retried and new eventIds.");
      if (inspection.events.length !== expectedSequence) throw new SequenceConflictError(expectedSequence, inspection.events.length);

      const appended = inputs.map((input, index) => RunEventSchema.parse({
        ...input,
        runId,
        sequence: expectedSequence + index + 1
      }));
      foldRun([...inspection.events, ...appended]);
      await writeDurableEvents(this.eventLogPath(runId), [...inspection.events, ...appended]);
      return appended;
    });
  }

  async withFencedWrite<T>(runId: string, authority: FencingAuthority, operation: () => Promise<T>): Promise<T> {
    return this.withLock(runId, async () => {
      await this.assertAuthority(runId, authority);
      const result = await operation();
      await this.assertAuthority(runId, authority);
      return result;
    });
  }

  bind(authority: FencingAuthority): RunEventJournalPort {
    return {
      load: (runId) => this.load(runId),
      append: (runId, expectedSequence, events) => this.appendFenced(runId, expectedSequence, authority, events)
    };
  }

  private async readFence(runId: string): Promise<FenceRecord | null> {
    try {
      const value = JSON.parse(await readFile(this.fencePath(runId), "utf8")) as Partial<FenceRecord>;
      if (value.schemaVersion !== 1 || typeof value.operationId !== "string" || !Number.isInteger(value.fencingToken) || (value.fencingToken ?? 0) <= 0) {
        throw new Error(`Invalid fencing record for run ${runId}.`);
      }
      return value as FenceRecord;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async withLock<T>(runId: string, operation: () => Promise<T>): Promise<T> {
    const key = `${this.directory}:${runId}`;
    const previous = writeChains.get(key) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const release = await acquireDurableLock(`${this.eventLogPath(runId)}.lock`);
      try {
        return await operation();
      } finally {
        await release();
      }
    });
    writeChains.set(key, current);
    try {
      return await current;
    } finally {
      if (writeChains.get(key) === current) writeChains.delete(key);
    }
  }
}

async function acquireDurableLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath, { recursive: false });
      await writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
      return () => rm(lockPath, { recursive: true, force: true });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > LOCK_STALE_AFTER_MS) {
          await rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (inspectionError) {
        if (isNotFound(inspectionError)) continue;
        throw inspectionError;
      }
      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) throw new Error(`Timed out waiting for durable run-store lock ${lockPath}.`);
      await delay(10);
    }
  }
}

function inspectRawLog(runId: string, raw: string): RunEventLogInspection {
  if (raw.length === 0) return { events: [], status: "ok" };
  const complete = raw.endsWith("\n");
  const lines = raw.split("\n");
  if (complete) lines.pop();
  const events: RunEvent[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) return corrupt(events, `blank record at line ${index + 1}`);
    try {
      const rawEnvelope = JSON.parse(line) as Partial<DurableEventEnvelope>;
      if (rawEnvelope.schemaVersion !== 2 || rawEnvelope.event === undefined || typeof rawEnvelope.checksum !== "string") {
        return corrupt(events, `invalid envelope at line ${index + 1}`);
      }
      const event = RunEventSchema.parse(rawEnvelope.event);
      if (event.runId !== runId) return corrupt(events, `record at line ${index + 1} belongs to ${event.runId}`);
      if (event.sequence !== index + 1) return corrupt(events, `expected sequence ${index + 1}, received ${event.sequence}`);
      if (rawEnvelope.checksum !== checksumFor(event)) return corrupt(events, `checksum mismatch at line ${index + 1}`);
      events.push(event);
    } catch (error) {
      const isTrailingPartial = !complete && index === lines.length - 1;
      if (isTrailingPartial) return { events, status: "degraded", reason: "incomplete trailing record" };
      return corrupt(events, `invalid record at line ${index + 1}: ${errorMessage(error)}`);
    }
  }
  try {
    if (events.length > 0) foldRun(events);
    return { events, status: "ok" };
  } catch (error) {
    return corrupt(events, `invalid domain history: ${errorMessage(error)}`);
  }
}

function corrupt(events: RunEvent[], reason: string): RunEventLogInspection {
  return { events, status: "corrupt", reason };
}

async function writeDurableEvents(filePath: string, events: readonly RunEvent[]): Promise<void> {
  const contents = events.map((event) => JSON.stringify({ schemaVersion: 2, event, checksum: checksumFor(event) } satisfies DurableEventEnvelope)).join("\n");
  await atomicWrite(filePath, `${contents}\n`);
}

function checksumFor(event: RunEvent): string {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function assertSameInput(event: RunEvent, input: RunEventInput): void {
  const durableInput = { eventId: event.eventId, occurredAt: event.occurredAt, type: event.type, payload: event.payload };
  if (JSON.stringify(durableInput) !== JSON.stringify(input)) throw new Error(`Event id ${input.eventId} was already used with different content.`);
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  let lastError: unknown;
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt += 1) {
    try {
      await rename(temporary, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableRename(error) || attempt === RENAME_RETRIES - 1) throw error;
    }
  }
  throw lastError;
}

function validateAuthority(authority: FencingAuthority): void {
  if (authority.operationId.trim().length === 0 || !Number.isInteger(authority.fencingToken) || authority.fencingToken <= 0) {
    throw new Error("A fencing authority requires an operationId and a positive integer token.");
  }
}

function safeName(runId: string): string {
  return runId.replace(/[^A-Za-z0-9._-]/gu, "_");
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isRetryableRename(error: unknown): boolean {
  return error instanceof Error && "code" in error && ["EPERM", "EACCES", "EBUSY"].includes(String(error.code));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
